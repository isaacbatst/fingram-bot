import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PlanService } from '@/plan/plan.service';
import { VaultService } from '@/vault/vault.service';
import { VaultWebService } from '@/vault/vault-web.service';
import {
  CardInvoiceService,
  CardView,
  InvoiceView,
  PaymentView,
} from '@/vault/card-invoice.service';
import { derivedTransactionError, Vault } from '@/vault/domain/vault';
import { Category, CATEGORY_NAME_MAX_LENGTH } from '@/vault/domain/category';
import { TransactionDTO } from '@/vault/dto/transaction.dto,';
import { computeSpendingBreakdown } from './spending-breakdown';

const changePoints = z
  .array(
    z.object({
      month: z
        .number()
        .int()
        .min(0)
        .describe('Mês relativo ao início do plano (0 = mês de início)'),
      amount: z.number().describe('Valor em R$ a partir desse mês'),
    }),
  )
  .describe(
    'Change points: cada item vale do seu mês em diante, até o próximo item',
  );

const scheduledMovements = z
  .array(
    z.object({
      month: z
        .number()
        .int()
        .min(0)
        .describe('Mês relativo ao início do plano (0 = mês de início)'),
      amount: z.number().positive().describe('Valor em R$'),
      label: z.string().min(1).describe('Descrição, ex.: "Anual 2027"'),
      type: z
        .enum(['in', 'out'])
        .describe(
          'in = pagamento pontual que sai do disponível para a alocação (num Pagamento, substitui a parcela do mês salvo additionalToMonthly); out = saque de uma reserva, limitado ao saldo dela',
        ),
      destinationBoxId: z
        .string()
        .optional()
        .describe(
          'Só em out: outra reserva (ou financiamento, como amortização extra) do mesmo plano que recebe o valor. Sem destino, o valor volta para o disponível. Não aponte para um Pagamento: o valor contaria duas vezes',
        ),
      additionalToMonthly: z
        .boolean()
        .optional()
        .describe('Só em in: cobra também o aporte mensal naquele mês'),
    }),
  )
  .describe(
    'Movimentações pontuais da alocação. Para juntar dinheiro para um pagamento planejado (ex.: a anual de um Pagamento): crie uma reserva manual com o aporte nos meses anteriores e uma out sem destino no mês do pagamento, do mesmo valor. O pagamento continua no Pagamento; a saída devolve o dinheiro ao disponível e nada conta duas vezes. Não use reserva onCompletion para isso (a realização já conta como gasto) nem aporte negativo',
  );

const period = {
  month: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe('Mês do período de orçamento (1-12). Omita para o período atual'),
  year: z
    .number()
    .int()
    .optional()
    .describe('Ano do período de orçamento. Omita para o período atual'),
};

const dateRange = {
  from: z
    .string()
    .date()
    .optional()
    .describe('Início do intervalo (AAAA-MM-DD, inclusivo)'),
  to: z
    .string()
    .date()
    .optional()
    .describe('Fim do intervalo (AAAA-MM-DD, inclusivo)'),
};

/**
 * from/to as whole UTC days (dates are stored as UTC midnight). Either bound
 * may be omitted for an open-ended range.
 */
function parseDateRange(input: {
  from?: string;
  to?: string;
}): { startDate: Date; endDate: Date } | undefined | string {
  if (input.from === undefined && input.to === undefined) return undefined;
  const startDate = new Date(`${input.from ?? '1970-01-01'}T00:00:00.000Z`);
  const endDate = new Date(`${input.to ?? '9999-12-31'}T23:59:59.999Z`);
  if (startDate > endDate) return '"from" deve ser anterior ou igual a "to"';
  return { startDate, endDate };
}

const EXCLUSIVE_PERIOD_ERROR =
  'Use from/to ou month/year (ou allPeriods), não os dois';

function json(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function error(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Transaction as listTransactions and editTransaction return it. */
function toTransactionItem(t: TransactionDTO) {
  return {
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    type: t.type,
    amount: t.amount,
    description: t.description ?? '',
    category: t.category ? { id: t.category.id, name: t.category.name } : null,
    committed: t.isCommitted,
    estratoId: t.boxId || null,
    isTransfer: t.transferId !== null,
    transferId: t.transferId,
    transferToEstratoId: t.transferToBoxId,
    allocationId: t.allocationId ?? null,
    invoiceId: t.invoiceId ?? null,
    // 'part': parte de uma compra de cartão paga por um pagamento de fatura,
    // contada na data dele (purchaseDate/purchaseAmount são da compra);
    // 'remainder': não discriminado de um pagamento. Compras de cartão ainda
    // não pagas não aparecem aqui (ver getInvoice).
    invoiceRole: t.invoiceRole ?? null,
    purchaseId: t.purchaseId ?? null,
    purchaseDate: t.purchaseDate
      ? t.purchaseDate.toISOString().slice(0, 10)
      : null,
    purchaseAmount: t.purchaseAmount ?? null,
    paymentId: t.paymentId ?? null,
  };
}

/** Both sides of a transfer, as the transfer tools return it. */
function describeTransfer(vault: Vault, transferId: string) {
  const sides = [...vault.transactions.values()].filter(
    (t) => t.transferId === transferId,
  );
  const out = sides.find((t) => t.type === 'expense');
  const into = sides.find((t) => t.type === 'income');
  if (!out || !into) return null;
  return {
    transferId,
    amount: out.amount,
    date: out.date.toISOString().slice(0, 10),
    fromEstratoId: out.boxId,
    toEstratoId: into.boxId,
  };
}

/** Linhas derivadas da fatura apontam a tool certa (a compra ou o pagamento). */
function derivedError(
  t: Parameters<typeof derivedTransactionError>[0],
): string | null {
  const message = derivedTransactionError(t);
  if (!message) return null;
  return t.isInvoicePart
    ? `${message} Use editTransaction/deleteTransaction com esse id.`
    : `${message} Use updateInvoicePayment/deleteInvoicePayment, ou linkTransactionsToInvoice para ligar as compras que faltam.`;
}

function transferSideError(transferId: string, tool: string): string {
  return `Esta transação é um lado de uma transferência entre estratos (transferId ${transferId}). Use ${tool} para alterar a transferência inteira.`;
}

function resolvePeriod(input: {
  month?: number;
  year?: number;
}): { month: number; year: number } | undefined | string {
  if (input.month === undefined && input.year === undefined) return undefined;
  if (input.month === undefined || input.year === undefined) {
    return 'Informe mês e ano juntos, ou nenhum dos dois para o período atual';
  }
  return { month: input.month, year: input.year };
}

/**
 * Builds the MCP server exposed at /mcp for one vault. A new instance is made
 * per request (stateless transport); the vault comes from the OAuth access
 * token and is never a tool parameter, so a client can only reach the vault
 * the user authorized.
 */
@Injectable()
export class DunaMcpServerFactory {
  constructor(
    private readonly vaultService: VaultService,
    private readonly vaultWebService: VaultWebService,
    private readonly planService: PlanService,
    private readonly cardInvoiceService: CardInvoiceService,
  ) {}

  create(vaultId: string): McpServer {
    const server = new McpServer(
      { name: 'duna', title: 'Duna', version: '1.0.0' },
      {
        instructions: [
          'Duna é o app de finanças pessoais do usuário: controle do dia a dia (transações, categorias, orçamento por categoria) e plano financeiro de longo prazo (premissas de salário e custo de vida, alocações, projeção).',
          `Data de hoje: ${new Date().toISOString().slice(0, 10)}.`,
          'Valores monetários estão em reais (BRL). Ao responder, formate como R$ 1.234,56 e datas como "10 de novembro de 2025".',
          'Para registrar uma transação, busque as categorias com getCategories e use a mais provável; o usuário pode corrigir depois.',
          'Categorias são do usuário: prefira uma existente. Crie com createCategory só quando o usuário pedir ou nenhuma servir, e confirme o nome com ele antes. Para renomear ou ajustar a descrição, updateCategory.',
          'O orçamento é mensal, mas o período pode não começar no dia 1: use getBudgetSummary para saber as datas do período. O valor orçado é um por categoria e vale para todos os meses; para mudá-lo, setBudgets.',
          'Para totais e comparações (por categoria, por mês, por estrato), use getSpendingBreakdown em vez de somar listTransactions.',
          'Cartão de crédito: cartões são cadastrados (listCards) e cada fatura é um ciclo do cartão (listInvoices). Compras de cartão só contam no orçamento quando um pagamento de fatura as paga, na data do pagamento, em ordem de data de compra (uma compra pode ser dividida entre dois pagamentos: listTransactions mostra as partes com invoiceRole "part", purchaseDate e purchaseAmount). O que um pagamento paga além das compras conhecidas conta como "não discriminado" (invoiceRole "remainder") até as compras chegarem. Compras ainda não pagas ficam "a pagar" (getInvoice, listCards.payable) e o saldo disponível desconta isso (listEstratos.available). Quando o usuário contar que pagou a fatura, use addInvoicePayment.',
          'Para corrigir uma transação, use editTransaction com o id de listTransactions (só os campos enviados mudam); para recategorizar várias de uma vez, categorizeTransactions.',
          'Transferências entre estratos (isTransfer) são um par de lançamentos: altere ou remova com editTransfer/deleteTransfer, pelo transferId.',
        ].join('\n'),
      },
    );

    this.registerReadTools(server, vaultId);
    this.registerWriteTools(server, vaultId);
    this.registerInvoiceTools(server, vaultId);
    this.registerCategoryTools(server, vaultId);
    this.registerBudgetTools(server, vaultId);
    return server;
  }

  private registerBudgetTools(server: McpServer, vaultId: string) {
    server.registerTool(
      'setBudgets',
      {
        title: 'Definir orçamento',
        description:
          'Define o valor mensal do orçamento de categorias de despesa. O orçamento é um valor por categoria que vale para todos os meses (não há valor diferente por mês). Só as categorias enviadas mudam; 0 zera o orçamento da categoria. Retorna todos os orçamentos e, se houver plano, o teto de custo de vida.',
        inputSchema: {
          budgets: z
            .array(
              z.object({
                categoryId: z
                  .string()
                  .describe('ID da categoria (ver getCategories)'),
                amount: z
                  .number()
                  .min(0)
                  .describe('Valor mensal em R$ para a categoria'),
              }),
            )
            .min(1),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ budgets }) => {
        // VaultService.setBudgets skips unknown categories silently, so check
        // them all first: nothing is saved unless every item is valid.
        const categories = await this.vaultService.getCategories(vaultId);
        for (const { categoryId } of budgets) {
          const category = categories.find((c) => c.id === categoryId);
          if (!category) {
            return error(`Categoria não encontrada: ${categoryId}`);
          }
          if (category.transactionType === 'income') {
            return error(
              `A categoria "${category.name}" é de receita; o orçamento vale só para despesas`,
            );
          }
        }

        const [err, vault] = await this.vaultService.setBudgets({
          vaultId,
          budgets: budgets.map((b) => ({
            categoryCode: b.categoryId,
            amount: b.amount,
          })),
        });
        if (err !== null) return error(err);
        const [, ceiling] =
          await this.vaultWebService.getBudgetCeiling(vaultId);

        return json({
          budgets: [...vault.budgets.values()].map((b) => ({
            categoryId: b.category.id,
            categoryName: b.category.name,
            budgeted: round(b.amount),
          })),
          totalBudgeted: round(vault.totalBudgetedAmount()),
          planCeiling: ceiling
            ? {
                costOfLivingCeiling: round(ceiling.ceiling),
                buffer: round(ceiling.buffer),
                overBudget: ceiling.overBudget,
              }
            : null,
        });
      },
    );
  }

  private registerCategoryTools(server: McpServer, vaultId: string) {
    const toItem = (c: Category) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      transactionType: c.transactionType,
    });
    const transactionType = z
      .enum(['income', 'expense', 'both'])
      .describe('Se a categoria vale para receita, despesa ou ambos');
    const description = z
      .string()
      .max(500)
      .describe(
        'Palavras-chave do que entra nela (ex.: "ração, veterinário, pet shop"). A sugestão automática de categoria usa esse texto',
      );

    server.registerTool(
      'createCategory',
      {
        title: 'Criar categoria',
        description:
          'Cria uma categoria nova, só deste usuário. Recusa um nome igual ao de uma categoria existente (sem diferenciar maiúsculas, acentos e emoji). Retorna a categoria com o id, para usar em addTransaction, editTransaction e categorizeTransactions.',
        inputSchema: {
          name: z
            .string()
            .max(CATEGORY_NAME_MAX_LENGTH)
            .describe('Nome da categoria, ex.: "Pets"'),
          transactionType,
          description: description.optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (input) => {
        const [err, category] = await this.vaultService.createCategory({
          vaultId,
          ...input,
        });
        if (err !== null) return error(err);
        return json(toItem(category));
      },
    );

    server.registerTool(
      'updateCategory',
      {
        title: 'Editar categoria',
        description:
          'Renomeia uma categoria ou muda sua descrição ou tipo, pelo id (de getCategories). Só os campos enviados mudam; as transações e o orçamento da categoria continuam ligados a ela.',
        inputSchema: {
          categoryId: z
            .string()
            .describe('ID da categoria (ver getCategories)'),
          name: z
            .string()
            .max(CATEGORY_NAME_MAX_LENGTH)
            .optional()
            .describe('Novo nome'),
          description: description.optional(),
          transactionType: transactionType.optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ categoryId, ...fields }) => {
        const [err, category] = await this.vaultService.updateCategory({
          vaultId,
          categoryId,
          ...fields,
        });
        if (err !== null) return error(err);
        return json(toItem(category));
      },
    );
  }

  private registerInvoiceTools(server: McpServer, vaultId: string) {
    const day = (date: Date | null) =>
      date ? date.toISOString().slice(0, 10) : null;
    const toCardItem = (card: CardView) => ({
      id: card.id,
      name: card.name,
      closingDay: card.closingDay,
      dueDay: card.dueDay,
      payingEstratoId: card.boxId,
      accountKey: card.accountKey,
      payable: round(card.payable),
      currentInvoiceId: card.currentInvoiceId,
    });
    const toInvoiceItem = (invoice: InvoiceView) => ({
      id: invoice.id,
      cardId: invoice.cardId,
      cardName: invoice.cardName,
      periodStart: day(invoice.periodStart),
      closingDate: day(invoice.closingDate),
      dueDate: day(invoice.dueDate),
      status: invoice.status,
      purchasesTotal: round(invoice.purchasesTotal),
      carriedIn: round(invoice.carriedIn),
      total: round(invoice.total),
      paid: round(invoice.paid),
      remaining: round(invoice.remaining),
      overpaid: round(invoice.overpaid),
      carriedOut: round(invoice.carriedOut),
      unpaidPurchases: round(invoice.unpaidPurchases),
      notItemized: round(invoice.notItemized),
      purchaseCount: invoice.purchaseCount,
      paymentCount: invoice.paymentCount,
      statements: invoice.statements.map((s) => ({
        statementId: s.batchId,
        accountLabel: s.accountLabel,
        periodStart: day(s.periodStart),
        periodEnd: day(s.periodEnd),
        ledgerBalance: s.ledgerBalance,
      })),
    });
    const toPaymentItem = (payment: PaymentView) => ({
      id: payment.id,
      invoiceId: payment.invoiceId,
      date: day(payment.date),
      amount: payment.amount,
      estratoId: payment.boxId,
      imported: payment.imported,
      notItemized: round(payment.notItemized),
      notItemizedTransactionId: payment.notItemizedTransactionId,
      parts: payment.parts,
    });
    const readOnly = { readOnlyHint: true, openWorldHint: false };
    const write = (destructive: boolean, idempotent: boolean) => ({
      readOnlyHint: false,
      destructiveHint: destructive,
      idempotentHint: idempotent,
      openWorldHint: false,
    });
    const dayField = (label: string) =>
      z.string().date().optional().describe(`${label} (AAAA-MM-DD)`);
    const toDay = (value?: string) =>
      value ? new Date(`${value}T00:00:00.000Z`) : undefined;

    server.registerTool(
      'listCards',
      {
        title: 'Listar cartões',
        description:
          'Cartões de crédito cadastrados: dias de fechamento e vencimento, estrato pagador, quanto das compras ainda está a pagar (payable) e a fatura em aberto.',
        annotations: readOnly,
      },
      async () => {
        const [err, cards] = await this.cardInvoiceService.listCards(vaultId);
        if (err !== null) return error(err);
        return json(cards.map(toCardItem));
      },
    );

    server.registerTool(
      'createCard',
      {
        title: 'Cadastrar cartão',
        description:
          'Cadastra um cartão de crédito. O cartão não é estrato: as compras dele só contam quando um pagamento de fatura as paga. Um extrato de cartão importado de uma conta desconhecida já cria o cartão sozinho; use esta tool quando o usuário quiser cadastrar antes.',
        inputSchema: {
          name: z.string().min(1).describe('Nome do cartão (ex.: "Nubank")'),
          closingDay: z
            .number()
            .int()
            .min(1)
            .max(31)
            .describe('Dia do fechamento'),
          dueDay: z.number().int().min(1).max(31).describe('Dia do vencimento'),
          payingEstratoId: z
            .string()
            .optional()
            .describe(
              'Estrato de onde saem os pagamentos (padrão: o estrato padrão)',
            ),
        },
        annotations: write(false, false),
      },
      async (input) => {
        const [err, card] = await this.cardInvoiceService.createCard(vaultId, {
          name: input.name,
          closingDay: input.closingDay,
          dueDay: input.dueDay,
          boxId: input.payingEstratoId,
        });
        if (err !== null) return error(err);
        return json(toCardItem(card));
      },
    );

    server.registerTool(
      'updateCard',
      {
        title: 'Editar cartão',
        description:
          'Edita nome, dias de fechamento/vencimento ou estrato pagador de um cartão. Os dias novos valem para as faturas criadas daqui em diante; para corrigir uma fatura existente use updateInvoice. Só os campos enviados mudam.',
        inputSchema: {
          cardId: z.string().describe('ID do cartão (listCards)'),
          name: z.string().min(1).optional(),
          closingDay: z.number().int().min(1).max(31).optional(),
          dueDay: z.number().int().min(1).max(31).optional(),
          payingEstratoId: z.string().optional(),
        },
        annotations: write(false, true),
      },
      async ({ cardId, ...fields }) => {
        if (Object.values(fields).every((v) => v === undefined)) {
          return error('Informe ao menos um campo para alterar');
        }
        const [err, card] = await this.cardInvoiceService.updateCard(
          vaultId,
          cardId,
          {
            name: fields.name,
            closingDay: fields.closingDay,
            dueDay: fields.dueDay,
            boxId: fields.payingEstratoId,
          },
        );
        if (err !== null) return error(err);
        return json(toCardItem(card));
      },
    );

    server.registerTool(
      'listInvoices',
      {
        title: 'Listar faturas',
        description:
          'Faturas (ciclos) dos cartões, da mais nova para a mais antiga: período, fechamento, vencimento, total (compras + saldo transferido), pago, restante, pago a mais, compras ainda a pagar, não discriminado e status (open, closed, partial, paid, overpaid, overdue). Também lista extratos de cartão antigos ainda sem fatura (pendingStatements) — use previewInvoiceReprocess para convertê-los.',
        inputSchema: {
          cardId: z.string().optional().describe('Só as faturas deste cartão'),
        },
        annotations: readOnly,
      },
      async ({ cardId }) => {
        const [err, result] = await this.cardInvoiceService.listInvoices(
          vaultId,
          { cardId },
        );
        if (err !== null) return error(err);
        return json({
          invoices: result.invoices.map(toInvoiceItem),
          pendingStatements: result.pendingStatements.map((s) => ({
            statementId: s.batchId,
            accountLabel: s.accountLabel,
            periodStart: day(s.periodStart),
            periodEnd: day(s.periodEnd),
            purchaseCount: s.purchaseCount,
            total: s.total,
            cardId: s.cardId,
          })),
        });
      },
    );

    server.registerTool(
      'getInvoice',
      {
        title: 'Detalhar fatura',
        description:
          'Uma fatura com as compras (data da compra, quanto já foi pago e as partes: cada pedaço pago por um pagamento, na data dele) e os pagamentos (partes que cada um pagou e o não discriminado). Uma compra pode ser dividida entre dois pagamentos.',
        inputSchema: { invoiceId: z.string().describe('ID da fatura') },
        annotations: readOnly,
      },
      async ({ invoiceId }) => {
        const [err, detail] = await this.cardInvoiceService.getInvoice(
          vaultId,
          invoiceId,
        );
        if (err !== null) return error(err);
        return json({
          ...toInvoiceItem(detail.invoice),
          purchases: detail.purchases.map((p) => ({
            id: p.id,
            purchaseDate: day(p.date),
            description: p.description,
            amount: p.amount,
            type: p.type,
            categoryId: p.categoryId,
            paid: round(p.paid),
            unpaid: round(p.unpaid),
            fromStatement: p.fromStatement,
            parts: p.parts.map((part) => ({
              ...part,
              date: day(part.date),
            })),
          })),
          payments: detail.payments.map(toPaymentItem),
        });
      },
    );

    server.registerTool(
      'addInvoicePayment',
      {
        title: 'Registrar pagamento de fatura',
        description:
          'Registra um pagamento de fatura de cartão (inclusive antecipado). O pagamento não é gasto: na data dele passam a contar as compras do cartão que ele paga (em ordem de data de compra, dividindo uma compra se preciso) e o que sobrar como "não discriminado". Informe amount e date, ou transactionId de uma despesa comum já lançada que era, na verdade, o pagamento (ela é removida para não contar duas vezes). Sem invoiceId, a fatura é sugerida pela data dentro do cartão. Quando o extrato da conta trouxer o débito, ele é reconhecido como este pagamento (mesmo estrato e valor, até 7 dias). Recusa um pagamento igual já existente, a menos que allowDuplicate.',
        inputSchema: {
          cardId: z.string().optional().describe('Cartão (listCards)'),
          invoiceId: z
            .string()
            .optional()
            .describe(
              'Fatura paga (listInvoices). Omita para sugerir pela data',
            ),
          amount: z.number().positive().optional().describe('Valor em R$'),
          date: dayField('Data do pagamento'),
          estratoId: z
            .string()
            .optional()
            .describe(
              'Estrato de onde saiu o dinheiro (padrão: o pagador do cartão)',
            ),
          transactionId: z
            .string()
            .optional()
            .describe('Despesa já lançada que é o pagamento (vira pagamento)'),
          allowDuplicate: z.boolean().optional(),
        },
        annotations: write(false, false),
      },
      async (input) => {
        if (!input.cardId && !input.invoiceId) {
          return error('Informe cardId ou invoiceId');
        }
        const [err, result] = await this.cardInvoiceService.addPayment(
          vaultId,
          {
            cardId: input.cardId,
            invoiceId: input.invoiceId,
            amount: input.amount,
            date: toDay(input.date),
            boxId: input.estratoId,
            transactionId: input.transactionId,
            allowDuplicate: input.allowDuplicate,
          },
        );
        if (err !== null) return error(err);
        return json({
          payment: toPaymentItem(result.payment),
          invoice: toInvoiceItem(result.invoice),
        });
      },
    );

    server.registerTool(
      'updateInvoicePayment',
      {
        title: 'Editar pagamento de fatura',
        description:
          'Corrige valor, data, fatura ou estrato de um pagamento de fatura (id em getInvoice). As partes e o não discriminado são recalculados. Só os campos enviados mudam.',
        inputSchema: {
          paymentId: z.string().describe('ID do pagamento'),
          amount: z.number().positive().optional(),
          date: dayField('Nova data'),
          invoiceId: z.string().optional().describe('Mover para outra fatura'),
          estratoId: z.string().optional(),
        },
        annotations: write(false, true),
      },
      async ({ paymentId, ...fields }) => {
        if (Object.values(fields).every((v) => v === undefined)) {
          return error('Informe ao menos um campo para alterar');
        }
        const [err, result] = await this.cardInvoiceService.updatePayment(
          vaultId,
          paymentId,
          {
            amount: fields.amount,
            date: toDay(fields.date),
            invoiceId: fields.invoiceId,
            boxId: fields.estratoId,
          },
        );
        if (err !== null) return error(err);
        return json({
          payment: toPaymentItem(result.payment),
          invoice: toInvoiceItem(result.invoice),
        });
      },
    );

    server.registerTool(
      'deleteInvoicePayment',
      {
        title: 'Remover pagamento de fatura',
        description:
          'Remove um pagamento de fatura e tudo o que ele fazia contar (partes das compras e não discriminado). As compras que ele pagava voltam a ficar a pagar.',
        inputSchema: { paymentId: z.string().describe('ID do pagamento') },
        annotations: write(true, true),
      },
      async ({ paymentId }) => {
        const [err] = await this.cardInvoiceService.deletePayment(
          vaultId,
          paymentId,
        );
        if (err !== null) return error(err);
        return json({ deleted: paymentId });
      },
    );

    server.registerTool(
      'closeInvoice',
      {
        title: 'Fechar fatura',
        description:
          'Fecha uma fatura antes da data de fechamento (ou fecha na data informada). Compras novas do cartão passam a cair na próxima fatura.',
        inputSchema: {
          invoiceId: z.string().describe('ID da fatura'),
          closingDate: dayField('Data de fechamento'),
        },
        annotations: write(false, true),
      },
      async ({ invoiceId, closingDate }) => {
        const [err, invoice] = await this.cardInvoiceService.closeInvoice(
          vaultId,
          invoiceId,
          toDay(closingDate),
        );
        if (err !== null) return error(err);
        return json(toInvoiceItem(invoice));
      },
    );

    server.registerTool(
      'updateInvoice',
      {
        title: 'Editar fatura',
        description:
          'Corrige as datas de uma fatura (início do período, fechamento, vencimento) ou reabre uma fechada à mão (closed: false). As compras ficam na fatura em que estão; para mover compras use linkTransactionsToInvoice.',
        inputSchema: {
          invoiceId: z.string().describe('ID da fatura'),
          periodStart: dayField('Início do período'),
          closingDate: dayField('Fechamento'),
          dueDate: dayField('Vencimento'),
          closed: z.boolean().optional(),
        },
        annotations: write(false, true),
      },
      async ({ invoiceId, ...fields }) => {
        if (Object.values(fields).every((v) => v === undefined)) {
          return error('Informe ao menos um campo para alterar');
        }
        const [err, invoice] = await this.cardInvoiceService.updateInvoice(
          vaultId,
          invoiceId,
          {
            periodStart: toDay(fields.periodStart),
            closingDate: toDay(fields.closingDate),
            dueDate: toDay(fields.dueDate),
            closed: fields.closed,
          },
        );
        if (err !== null) return error(err);
        return json(toInvoiceItem(invoice));
      },
    );

    server.registerTool(
      'linkTransactionsToInvoice',
      {
        title: 'Ligar compras a uma fatura',
        description:
          'Faz de transações (ids de listTransactions) compras de cartão: numa fatura (invoiceId) ou no cartão (cardId, a fatura sai da data de cada compra). Uma compra de cartão deixa de contar na data dela e passa a contar quando um pagamento a paga; enquanto isso fica "a pagar". Mover de fatura não conta duas vezes. invoiceId: null desliga (a compra volta a contar na data dela). Cada id é tratado à parte; falhas voltam em "failed".',
        inputSchema: {
          ids: z
            .array(z.string())
            .min(1)
            .max(100)
            .describe('IDs das transações'),
          invoiceId: z
            .string()
            .nullable()
            .optional()
            .describe('Fatura de destino; null desliga'),
          cardId: z
            .string()
            .optional()
            .describe('Cartão: a fatura sai da data de cada compra'),
        },
        annotations: write(false, true),
      },
      async ({ ids, invoiceId, cardId }) => {
        if (invoiceId === undefined && !cardId) {
          return error('Informe invoiceId (ou null para desligar) ou cardId');
        }
        if (invoiceId && cardId)
          return error('Use invoiceId ou cardId, não os dois');
        const target = invoiceId ? { invoiceId } : cardId ? { cardId } : null;
        const [err, result] = await this.cardInvoiceService.linkTransactions(
          vaultId,
          ids,
          target,
        );
        if (err !== null) return error(err);
        const payload = {
          updated: result.updated,
          failed: result.failed,
          invoice: result.invoice ? toInvoiceItem(result.invoice) : null,
        };
        if (result.updated.length === 0)
          return { ...json(payload), isError: true };
        return json(payload);
      },
    );

    server.registerTool(
      'reconcileInvoice',
      {
        title: 'Conferir fatura com o extrato',
        description:
          'Confere uma fatura contra os extratos de cartão ligados a ela: linhas do arquivo que não são compras desta fatura (missing, com o motivo), compras lançadas à mão que o arquivo não tem (extra), pares suspeitos de duplicata (compra lançada à mão x compra importada, mesmo valor e data próxima) e se o saldo do arquivo bate com o total.',
        inputSchema: { invoiceId: z.string().describe('ID da fatura') },
        annotations: readOnly,
      },
      async ({ invoiceId }) => {
        const [err, view] = await this.cardInvoiceService.reconcileInvoice(
          vaultId,
          invoiceId,
        );
        if (err !== null) return error(err);
        return json(view);
      },
    );

    server.registerTool(
      'listSuspectedDuplicates',
      {
        title: 'Duplicatas suspeitas',
        description:
          'Pares de transação lançada à mão x compra importada de extrato de cartão com o mesmo valor e datas até 3 dias (confidence high quando a descrição também parece). Mostre ao usuário: se for a mesma compra, remova a lançada à mão com deleteTransaction; se não for, dispense o par com dismissDuplicate. Pares dispensados não voltam.',
        inputSchema: {
          invoiceId: z.string().optional().describe('Só pares desta fatura'),
        },
        annotations: readOnly,
      },
      async ({ invoiceId }) => {
        const [err, pairs] = await this.cardInvoiceService.listDuplicates(
          vaultId,
          { invoiceId },
        );
        if (err !== null) return error(err);
        return json(pairs);
      },
    );

    server.registerTool(
      'dismissDuplicate',
      {
        title: 'Não é duplicata',
        description:
          'Dispensa um par de listSuspectedDuplicates que o usuário confirmou não ser a mesma compra: o par deixa de ser sugerido (os dois lançamentos continuam). Só aceita um par que está sendo sugerido agora.',
        inputSchema: {
          manualTransactionId: z
            .string()
            .describe('manual.transactionId do par'),
          importedTransactionId: z
            .string()
            .describe('imported.transactionId do par'),
        },
        annotations: write(false, true),
      },
      async ({ manualTransactionId, importedTransactionId }) => {
        const [err] = await this.cardInvoiceService.dismissDuplicate({
          vaultId,
          manualTransactionId,
          importedTransactionId,
        });
        if (err !== null) return error(err);
        return json({
          dismissed: { manualTransactionId, importedTransactionId },
        });
      },
    );

    server.registerTool(
      'previewInvoiceReprocess',
      {
        title: 'Prévia: reprocessar histórico de cartão',
        description:
          'Mostra, sem gravar nada, o que reprocessar o histórico faria: extratos de cartão antigos ganham cartão e fatura e as compras passam a contar na data do pagamento; débitos "pagamento de fatura" ignorados (ou lançados como gasto) viram pagamentos. Devolve, por mês, o total de gastos atual e o novo. Mostre ao usuário antes de applyInvoiceReprocess.',
        annotations: readOnly,
      },
      async () => {
        const [err, report] =
          await this.cardInvoiceService.previewReprocess(vaultId);
        if (err !== null) return error(err);
        return json(report);
      },
    );

    server.registerTool(
      'applyInvoiceReprocess',
      {
        title: 'Reprocessar histórico de cartão',
        description:
          'Aplica o reprocessamento mostrado por previewInvoiceReprocess. Muda os meses em que as compras de cartão contam e remove despesas que eram, na verdade, pagamentos de fatura. Só com a confirmação do usuário depois de ver a prévia.',
        annotations: write(true, true),
      },
      async () => {
        const [err, report] =
          await this.cardInvoiceService.applyReprocess(vaultId);
        if (err !== null) return error(err);
        return json(report);
      },
    );
  }

  private registerReadTools(server: McpServer, vaultId: string) {
    server.registerTool(
      'getCategories',
      {
        title: 'Listar categorias',
        description:
          'Lista as categorias de transação do usuário (id, nome e se valem para receita, despesa ou ambos).',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const categories = await this.vaultService.getCategories(vaultId);
        return json(
          categories.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            transactionType: c.transactionType,
          })),
        );
      },
    );

    server.registerTool(
      'listTransactions',
      {
        title: 'Listar transações',
        description:
          'Lista transações, da mais recente para a mais antiga. Período: um mês de orçamento (month/year, padrão o atual), um intervalo de datas (from/to) ou todos (allPeriods). Filtros opcionais por categoria, estrato, tipo, faixa de valor e descrição. Paginado. Para totais, prefira getSpendingBreakdown.',
        inputSchema: {
          ...period,
          ...dateRange,
          allPeriods: z
            .boolean()
            .optional()
            .describe('Busca em todos os períodos'),
          categoryId: z.string().optional().describe('Filtra por categoria'),
          estratoId: z
            .string()
            .optional()
            .describe(
              'Filtra por estrato (conta/reserva, ver listEstratos). Inclui transferências que entram nele',
            ),
          type: z
            .enum(['income', 'expense'])
            .optional()
            .describe('Só receitas ou só despesas. Exclui transferências'),
          minAmount: z
            .number()
            .min(0)
            .optional()
            .describe('Valor mínimo em R$ (inclusivo)'),
          maxAmount: z
            .number()
            .min(0)
            .optional()
            .describe('Valor máximo em R$ (inclusivo)'),
          description: z
            .string()
            .optional()
            .describe('Filtra por trecho da descrição'),
          page: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Página (padrão 1)'),
          pageSize: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Itens por página (padrão 50)'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input) => {
        const date = resolvePeriod(input);
        if (typeof date === 'string') return error(date);
        const range = parseDateRange(input);
        if (typeof range === 'string') return error(range);
        if (range && (date || input.allPeriods)) {
          return error(EXCLUSIVE_PERIOD_ERROR);
        }
        if (
          input.minAmount !== undefined &&
          input.maxAmount !== undefined &&
          input.minAmount > input.maxAmount
        ) {
          return error('minAmount deve ser menor ou igual a maxAmount');
        }
        const [err, result] = await this.vaultService.getTransactions({
          vaultId,
          date,
          dateRange: range,
          ignorePeriod: input.allPeriods,
          categoryId: input.categoryId,
          boxId: input.estratoId,
          type: input.type,
          minAmount: input.minAmount,
          maxAmount: input.maxAmount,
          description: input.description,
          page: input.page ?? 1,
          pageSize: input.pageSize ?? 50,
        });
        if (err !== null) return error(err);
        return json({
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: result.totalPages,
          items: result.items.map(toTransactionItem),
        });
      },
    );

    server.registerTool(
      'listEstratos',
      {
        title: 'Listar estratos',
        description:
          'Lista os estratos do usuário (contas correntes e reservas) com saldo atual, meta, o que está a pagar nos cartões pagos por ele (cardPayable) e o saldo disponível (available = saldo − a pagar). Use o id para filtrar transações e gastos por estrato.',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const [err, boxes] = await this.vaultService.getBoxes(vaultId);
        if (err !== null) return error(err);
        const [balanceErr, available] =
          await this.cardInvoiceService.getAvailableBalance(vaultId);
        if (balanceErr !== null) return error(balanceErr);
        const byBox = new Map(available.estratos.map((e) => [e.boxId, e]));
        return json(
          boxes.map((b) => ({
            id: b.id,
            name: b.name,
            kind: b.type === 'saving' ? 'reserva' : 'corrente',
            isDefault: b.isDefault,
            balance: round(b.balance),
            cardPayable: round(byBox.get(b.id)?.cardPayable ?? 0),
            available: round(byBox.get(b.id)?.available ?? b.balance),
            goalAmount: b.goalAmount ?? null,
            goalProgressPercent:
              b.goalProgress === null ? null : round(b.goalProgress),
          })),
        );
      },
    );

    server.registerTool(
      'getSpendingBreakdown',
      {
        title: 'Totais por categoria e/ou mês',
        description:
          'Soma despesas (ou receitas) de um período, agrupadas por categoria, por mês de orçamento ou pelos dois. Calculado no servidor: use em vez de somar listTransactions. Transferências entre estratos não contam; pagamentos do plano aparecem num grupo próprio ("Pagamentos do plano"), como no orçamento do app.',
        inputSchema: {
          ...period,
          ...dateRange,
          groupBy: z
            .enum(['category', 'month', 'categoryAndMonth'])
            .optional()
            .describe('Agrupamento (padrão category)'),
          type: z
            .enum(['income', 'expense'])
            .optional()
            .describe('Despesas (padrão) ou receitas'),
          estratoId: z
            .string()
            .optional()
            .describe('Só transações deste estrato (ver listEstratos)'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input) => {
        const requested = resolvePeriod(input);
        if (typeof requested === 'string') return error(requested);
        const explicitRange = parseDateRange(input);
        if (typeof explicitRange === 'string') return error(explicitRange);
        if (explicitRange && requested) return error(EXCLUSIVE_PERIOD_ERROR);

        const [err, vault] = await this.vaultService.getVault({ vaultId });
        if (err !== null) return error(err);
        const range =
          explicitRange ??
          (() => {
            const p = requested ?? vault.getCurrentBudgetPeriod();
            return vault.getBudgetPeriod(p.month, p.year);
          })();
        const categories = await this.vaultService.getCategories(vaultId);

        const result = computeSpendingBreakdown({
          transactions: [...vault.transactions.values()].filter(
            (t) => t.countsInLedger,
          ),
          range,
          type: input.type ?? 'expense',
          groupBy: input.groupBy ?? 'category',
          boxId: input.estratoId,
          categoryNames: new Map(categories.map((c) => [c.id, c.name])),
          periodOf: (date) => vault.getCurrentBudgetPeriod(date),
        });

        return json({
          range: {
            from: range.startDate.toISOString().slice(0, 10),
            to: range.endDate.toISOString().slice(0, 10),
          },
          type: input.type ?? 'expense',
          ...result,
        });
      },
    );

    server.registerTool(
      'getBudgetSummary',
      {
        title: 'Resumo do orçamento',
        description:
          'Resumo de um período de orçamento: datas do período, receitas, gastos, saldo, orçado vs. gasto por categoria e, se houver plano, o teto de custo de vida que o plano prevê.',
        inputSchema: period,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input) => {
        const requested = resolvePeriod(input);
        if (typeof requested === 'string') return error(requested);
        const [err, vault] = await this.vaultService.getVault({ vaultId });
        if (err !== null) return error(err);

        const date = requested ?? vault.getCurrentBudgetPeriod();
        const { startDate, endDate } = vault.getBudgetPeriod(
          date.month,
          date.year,
        );
        const [, ceiling] =
          await this.vaultWebService.getBudgetCeiling(vaultId);

        return json({
          period: {
            month: date.month,
            year: date.year,
            startDate: startDate.toISOString().slice(0, 10),
            endDate: endDate.toISOString().slice(0, 10),
          },
          income: round(vault.totalIncomeAmount(date)),
          spent: round(vault.totalSpentAmount(date)),
          currentBalance: round(vault.getBalance()),
          budgets: vault.getBudgetsSummary(date.month, date.year).map((b) => ({
            categoryId: b.category.id,
            categoryName: b.category.name,
            budgeted: round(b.amount),
            spent: round(b.spent),
            remaining: round(b.amount - b.spent),
            percentageUsed: round(b.percentageUsed),
          })),
          planCeiling: ceiling
            ? {
                costOfLivingCeiling: round(ceiling.ceiling),
                totalBudgeted: round(ceiling.allocated),
                buffer: round(ceiling.buffer),
                overBudget: ceiling.overBudget,
              }
            : null,
        });
      },
    );

    server.registerTool(
      'listPlans',
      {
        title: 'Listar planos',
        description:
          'Lista os planos financeiros do usuário com suas premissas de salário e custo de vida.',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const plans = await this.planService.getByVaultId(vaultId);
        return json(
          plans.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            startDate: p.startDate.toISOString().slice(0, 10),
            salaryChangePoints: p.premises.salaryChangePoints,
            costOfLivingChangePoints: p.premises.costOfLivingChangePoints,
          })),
        );
      },
    );

    server.registerTool(
      'getPlan',
      {
        title: 'Detalhar plano',
        description:
          'Detalhes de um plano: premissas, marcos e alocações (reservas e pagamentos planejados).',
        inputSchema: { planId: z.string().describe('ID do plano') },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ planId }) => {
        const [err, data] = await this.planService.getById(planId, vaultId);
        if (err !== null) return error(err);
        return json({
          plan: {
            id: data.plan.id,
            name: data.plan.name,
            status: data.plan.status,
            startDate: data.plan.startDate.toISOString().slice(0, 10),
            premises: data.plan.premises,
            milestones: data.plan.milestones,
          },
          allocations: data.allocations.map((a) => ({
            id: a.id,
            label: a.label,
            target: a.target,
            monthlyAmount: a.monthlyAmount,
            realizationMode: a.realizationMode,
            yieldRate: a.yieldRate,
            financing: a.financing,
            scheduledMovements: a.scheduledMovements,
          })),
        });
      },
    );

    server.registerTool(
      'getProjection',
      {
        title: 'Projeção do plano',
        description:
          'Projeção mês a mês de um plano: receita, custo de vida, sobra, caixa, patrimônio total e saldo por alocação. Meses já vividos usam os dados reais.',
        inputSchema: {
          planId: z.string().describe('ID do plano'),
          months: z
            .number()
            .int()
            .min(1)
            .max(600)
            .optional()
            .describe('Meses a projetar (padrão 120)'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ planId, months }) => {
        const [err, projection] = await this.planService.getProjection(
          planId,
          vaultId,
          months ?? 120,
        );
        if (err !== null) return error(err);
        return json(
          projection.map((m) => ({
            month: m.month,
            date: m.date.toISOString().slice(0, 7),
            income: round(m.income),
            costOfLiving: round(m.costOfLiving),
            surplus: round(m.surplus),
            cash: round(m.cash),
            totalWealth: round(m.totalWealth),
            allocations: Object.fromEntries(
              Object.entries(m.allocations).map(([k, v]) => [k, round(v)]),
            ),
            isReal: m.isReal,
          })),
        );
      },
    );
  }

  private registerWriteTools(server: McpServer, vaultId: string) {
    server.registerTool(
      'addTransaction',
      {
        title: 'Registrar transação',
        description:
          'Registra uma receita ou despesa. Retorna o código da transação (usado para removê-la) e o saldo atualizado.',
        inputSchema: {
          amount: z
            .number()
            .positive()
            .describe('Valor em R$, sempre positivo'),
          type: z.enum(['income', 'expense']).describe('Receita ou despesa'),
          date: z.string().date().describe('Data no formato AAAA-MM-DD'),
          description: z.string().describe('Descrição curta'),
          categoryId: z
            .string()
            .optional()
            .describe('ID da categoria (ver getCategories)'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (input) => {
        const [err, result] = await this.vaultService.addTransactionToVault({
          vaultId,
          transaction: {
            amount: input.amount,
            type: input.type,
            // Same as the web form: a YYYY-MM-DD date is stored as UTC midnight.
            date: new Date(input.date),
            description: input.description,
            categoryId: input.categoryId,
            shouldCommit: true,
          },
          platform: 'web',
        });
        if (err !== null) return error(err);
        return json({
          id: result.transaction.id,
          amount: result.transaction.amount,
          type: result.transaction.type,
          date: result.transaction.date.toISOString().slice(0, 10),
          category: result.transaction.category?.name ?? null,
          currentBalance: round(result.vault.getBalance()),
        });
      },
    );

    server.registerTool(
      'deleteTransaction',
      {
        title: 'Remover transação',
        description:
          'Remove uma transação pelo id (retornado por addTransaction e listTransactions). Transferências entre estratos se removem com deleteTransfer.',
        inputSchema: {
          id: z.string().describe('ID da transação'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ id }) => {
        const [vaultErr, vault] = await this.vaultService.getVault({ vaultId });
        if (vaultErr !== null) return error(vaultErr);
        const current = vault.transactions.get(id);
        if (current?.transferId)
          return error(transferSideError(current.transferId, 'deleteTransfer'));
        const derived = current ? derivedError(current) : null;
        if (derived) return error(derived);
        const [err] = await this.vaultService.deleteTransaction({
          vaultId,
          transactionId: id,
        });
        if (err !== null) return error(err);
        return json({ deleted: id });
      },
    );

    this.registerTransactionEditTools(server, vaultId);

    server.registerTool(
      'updatePremises',
      {
        title: 'Atualizar premissas do plano',
        description:
          'Substitui os change points de salário e/ou de custo de vida de um plano. Envie só o que deve mudar; o que for enviado substitui a lista inteira.',
        inputSchema: {
          planId: z.string().describe('ID do plano'),
          salaryChangePoints: changePoints.optional(),
          costOfLivingChangePoints: changePoints.optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ planId, salaryChangePoints, costOfLivingChangePoints }) => {
        const [err, plan] = await this.planService.updatePremises(
          planId,
          vaultId,
          { salaryChangePoints, costOfLivingChangePoints },
        );
        if (err !== null) return error(err);
        return json({ planId: plan.id, premises: plan.premises });
      },
    );

    server.registerTool(
      'addAllocation',
      {
        title: 'Adicionar alocação',
        description:
          'Adiciona uma alocação ao plano: uma reserva (acumula até uma meta) ou um pagamento planejado mensal, com movimentações pontuais opcionais.',
        inputSchema: {
          planId: z.string().describe('ID do plano'),
          label: z.string().min(1).describe('Nome da alocação'),
          target: z
            .number()
            .min(0)
            .describe('Meta em R$ (0 se não houver meta)'),
          monthlyAmount: changePoints.describe('Aporte mensal (change points)'),
          realizationMode: z
            .enum(['immediate', 'manual', 'onCompletion', 'never'])
            .describe(
              'immediate = pagamento mensal; manual = reserva com saque manual; onCompletion = reserva sacada ao atingir a meta; never = reserva sem saque',
            ),
          yieldRate: z
            .number()
            .optional()
            .describe('Rendimento anual (0.12 = 12%). Só para reservas'),
          scheduledMovements: scheduledMovements.optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (input) => {
        const [err, allocation] = await this.planService.addAllocation(
          input.planId,
          vaultId,
          {
            label: input.label,
            target: input.target,
            monthlyAmount: input.monthlyAmount,
            realizationMode: input.realizationMode,
            yieldRate: input.yieldRate,
            scheduledMovements: input.scheduledMovements ?? [],
          },
        );
        if (err !== null) return error(err);
        return json({
          id: allocation.id,
          label: allocation.label,
          target: allocation.target,
          monthlyAmount: allocation.monthlyAmount,
          realizationMode: allocation.realizationMode,
          scheduledMovements: allocation.scheduledMovements,
        });
      },
    );

    server.registerTool(
      'updateAllocation',
      {
        title: 'Atualizar alocação',
        description:
          'Atualiza nome, meta, aporte mensal, rendimento ou movimentações pontuais de uma alocação. Envie só o que deve mudar; scheduledMovements substitui a lista inteira (leia a atual com getPlan).',
        inputSchema: {
          allocationId: z.string().describe('ID da alocação'),
          label: z.string().min(1).optional(),
          target: z.number().min(0).optional().describe('Meta em R$'),
          monthlyAmount: changePoints.optional(),
          yieldRate: z
            .number()
            .optional()
            .describe('Rendimento anual (0.12 = 12%)'),
          scheduledMovements: scheduledMovements.optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ allocationId, ...updates }) => {
        const [err, allocation] = await this.planService.updateAllocation(
          allocationId,
          vaultId,
          updates,
        );
        if (err !== null) return error(err);
        return json({
          id: allocation.id,
          label: allocation.label,
          target: allocation.target,
          monthlyAmount: allocation.monthlyAmount,
          yieldRate: allocation.yieldRate,
          scheduledMovements: allocation.scheduledMovements,
        });
      },
    );

    server.registerTool(
      'removeAllocation',
      {
        title: 'Remover alocação',
        description: 'Remove uma alocação do plano.',
        inputSchema: {
          allocationId: z.string().describe('ID da alocação'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ allocationId }) => {
        const [err] = await this.planService.removeAllocation(
          allocationId,
          vaultId,
        );
        if (err !== null) return error(err);
        return json({ removed: allocationId });
      },
    );
  }

  /** Category of this vault by id (ids of other vaults are not found). */
  private async findCategory(vaultId: string, categoryId: string) {
    const categories = await this.vaultService.getCategories(vaultId);
    return categories.find((c) => c.id === categoryId) ?? null;
  }

  private registerTransactionEditTools(server: McpServer, vaultId: string) {
    server.registerTool(
      'editTransaction',
      {
        title: 'Editar transação',
        description:
          'Edita uma transação pelo id (retornado por listTransactions e addTransaction). Só os campos enviados mudam. categoryId: null remove a categoria. Categoria e alocação do plano são exclusivas: vincular a uma alocação remove a categoria; para categorizar uma transação vinculada, envie allocationId: null junto. Transferências entre estratos se editam com editTransfer. Retorna a transação atualizada.',
        inputSchema: {
          id: z.string().describe('ID da transação'),
          amount: z
            .number()
            .positive()
            .optional()
            .describe('Novo valor em R$, sempre positivo'),
          description: z.string().optional().describe('Nova descrição'),
          date: z.string().date().optional().describe('Nova data (AAAA-MM-DD)'),
          type: z
            .enum(['income', 'expense'])
            .optional()
            .describe('Receita ou despesa'),
          categoryId: z
            .string()
            .nullable()
            .optional()
            .describe('ID da categoria (ver getCategories); null remove'),
          estratoId: z
            .string()
            .optional()
            .describe('Move para outro estrato (ver listEstratos)'),
          allocationId: z
            .string()
            .nullable()
            .optional()
            .describe(
              'Vincula a uma alocação do plano (ver getPlan): Pagamento planejado ou uso de Reserva. null desvincula',
            ),
          withdrawalType: z
            .enum(['withdrawal', 'realization'])
            .optional()
            .describe(
              'Obrigatório ao vincular a uma Reserva (não vale para Pagamento): realization = uso para o objetivo; withdrawal = saque fora do objetivo. Reserva com realizationMode "never" só aceita withdrawal. Envie junto com allocationId',
            ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ id, ...fields }) => {
        if (Object.values(fields).every((v) => v === undefined)) {
          return error('Informe ao menos um campo para alterar');
        }
        if (fields.withdrawalType !== undefined && !fields.allocationId) {
          return error('withdrawalType precisa vir junto com o allocationId');
        }
        if (fields.categoryId && fields.allocationId) {
          return error(
            'Categoria e alocação do plano são exclusivas: envie só uma das duas',
          );
        }

        const [vaultErr, vault] = await this.vaultService.getVault({ vaultId });
        if (vaultErr !== null) return error(vaultErr);
        const current = vault.transactions.get(id);
        if (!current) return error('Transação não encontrada');
        if (current.transferId) {
          return error(transferSideError(current.transferId, 'editTransfer'));
        }
        const derived = derivedError(current);
        if (derived) return error(derived);
        if (
          fields.categoryId &&
          fields.allocationId === undefined &&
          current.allocationId
        ) {
          return error(
            'Esta transação está vinculada a uma alocação do plano, e categoria e alocação são exclusivas. Para trocar pela categoria, envie allocationId: null junto.',
          );
        }

        // The service looks categories up by code; the tools expose ids.
        let categoryCode: string | null | undefined;
        if (fields.categoryId) {
          const category = await this.findCategory(vaultId, fields.categoryId);
          if (!category) return error('Categoria não encontrada');
          categoryCode = category.code;
        } else if (fields.categoryId === null) {
          categoryCode = null;
        } else if (fields.allocationId && current.categoryId) {
          // Linking to the plan replaces the category.
          categoryCode = null;
        }

        const [err, result] = await this.vaultService.editTransactionInVault({
          vaultId,
          transactionId: id,
          newAmount: fields.amount,
          description: fields.description,
          // Same as addTransaction: a YYYY-MM-DD date is stored as UTC midnight.
          date: fields.date ? new Date(fields.date) : undefined,
          type: fields.type,
          categoryCode,
          boxId: fields.estratoId,
          allocationId: fields.allocationId,
          withdrawalType: fields.withdrawalType,
        });
        if (err !== null) return error(err);
        return json(toTransactionItem(result.transaction));
      },
    );

    server.registerTool(
      'categorizeTransactions',
      {
        title: 'Categorizar transações',
        description:
          'Aplica uma categoria a várias transações de uma vez, pelos ids (de listTransactions). Cada id é tratado à parte: os que falham (não encontrado, transferência, vinculado a alocação do plano) voltam em "failed" sem impedir os demais.',
        inputSchema: {
          ids: z
            .array(z.string())
            .min(1)
            .max(100)
            .describe('IDs das transações (até 100)'),
          categoryId: z
            .string()
            .describe('ID da categoria (ver getCategories)'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ ids, categoryId }) => {
        const category = await this.findCategory(vaultId, categoryId);
        if (!category) return error('Categoria não encontrada');
        const [vaultErr, vault] = await this.vaultService.getVault({ vaultId });
        if (vaultErr !== null) return error(vaultErr);

        const updated: string[] = [];
        const failed: { id: string; error: string }[] = [];
        for (const id of new Set(ids)) {
          const current = vault.transactions.get(id);
          if (!current) {
            failed.push({ id, error: 'Transação não encontrada' });
            continue;
          }
          if (current.transferId) {
            failed.push({
              id,
              error: 'Transferência entre estratos não tem categoria',
            });
            continue;
          }
          const derived = derivedError(current);
          if (derived) {
            failed.push({ id, error: derived });
            continue;
          }
          if (current.allocationId) {
            failed.push({
              id,
              error:
                'Vinculada a uma alocação do plano; use editTransaction com allocationId: null para trocar pela categoria',
            });
            continue;
          }
          const [err] = await this.vaultService.editTransactionInVault({
            vaultId,
            transactionId: id,
            categoryCode: category.code,
          });
          if (err !== null) failed.push({ id, error: err });
          else updated.push(id);
        }

        const payload = {
          category: { id: category.id, name: category.name },
          updated,
          failed,
        };
        if (updated.length === 0) return { ...json(payload), isError: true };
        return json(payload);
      },
    );

    server.registerTool(
      'createTransfer',
      {
        title: 'Transferir entre estratos',
        description:
          'Move dinheiro entre dois estratos do usuário (ex.: da conta para a reserva). Cria o par de lançamentos, sem categoria e sem afetar o orçamento. Retorna o transferId.',
        inputSchema: {
          fromEstratoId: z
            .string()
            .describe('Estrato de origem (ver listEstratos)'),
          toEstratoId: z.string().describe('Estrato de destino'),
          amount: z
            .number()
            .positive()
            .describe('Valor em R$, sempre positivo'),
          date: z.string().date().describe('Data no formato AAAA-MM-DD'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (input) => {
        const [err, transferId] = await this.vaultService.createTransfer({
          vaultId,
          fromBoxId: input.fromEstratoId,
          toBoxId: input.toEstratoId,
          amount: input.amount,
          date: new Date(input.date),
        });
        if (err !== null) return error(err);
        return this.transferResult(vaultId, transferId);
      },
    );

    server.registerTool(
      'editTransfer',
      {
        title: 'Editar transferência',
        description:
          'Edita uma transferência entre estratos pelo transferId (de listTransactions): valor, data, estrato de origem e/ou de destino. Os dois lados mudam juntos. Só os campos enviados mudam.',
        inputSchema: {
          transferId: z.string().describe('ID da transferência'),
          amount: z
            .number()
            .positive()
            .optional()
            .describe('Novo valor em R$, sempre positivo'),
          date: z.string().date().optional().describe('Nova data (AAAA-MM-DD)'),
          fromEstratoId: z
            .string()
            .optional()
            .describe('Novo estrato de origem'),
          toEstratoId: z
            .string()
            .optional()
            .describe('Novo estrato de destino'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ transferId, ...fields }) => {
        if (Object.values(fields).every((v) => v === undefined)) {
          return error('Informe ao menos um campo para alterar');
        }
        const [err] = await this.vaultService.editTransfer({
          vaultId,
          transferId,
          amount: fields.amount,
          date: fields.date ? new Date(fields.date) : undefined,
          fromBoxId: fields.fromEstratoId,
          toBoxId: fields.toEstratoId,
        });
        if (err !== null) return error(err);
        return this.transferResult(vaultId, transferId);
      },
    );

    server.registerTool(
      'deleteTransfer',
      {
        title: 'Remover transferência',
        description:
          'Remove uma transferência entre estratos (os dois lados) pelo transferId.',
        inputSchema: {
          transferId: z.string().describe('ID da transferência'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ transferId }) => {
        const [err] = await this.vaultService.deleteTransfer({
          vaultId,
          transferId,
        });
        if (err !== null) return error(err);
        return json({ deleted: transferId });
      },
    );
  }

  private async transferResult(
    vaultId: string,
    transferId: string,
  ): Promise<CallToolResult> {
    const [err, vault] = await this.vaultService.getVault({ vaultId });
    if (err !== null) return error(err);
    const transfer = describeTransfer(vault, transferId);
    if (!transfer) return error('Transferência não encontrada');
    return json(transfer);
  }
}
