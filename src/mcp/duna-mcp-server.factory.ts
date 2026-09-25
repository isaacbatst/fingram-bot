import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PlanService } from '@/plan/plan.service';
import { VaultService } from '@/vault/vault.service';
import { VaultWebService } from '@/vault/vault-web.service';
import { CardInvoiceService, InvoiceView } from '@/vault/card-invoice.service';
import { Vault } from '@/vault/domain/vault';
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
    // 'purchase': compra de uma fatura de cartão, contada na data do pagamento
    // da fatura; 'remainder': a parte da fatura ainda não discriminada.
    invoiceRole: t.invoiceRole ?? null,
    purchaseDate: t.purchaseDate
      ? t.purchaseDate.toISOString().slice(0, 10)
      : null,
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

const INVOICE_REMAINDER_ERROR =
  'Esta transação é a parte não discriminada de uma fatura de cartão: ela se ajusta sozinha conforme as compras são ligadas. Para removê-la, use deleteInvoice (as compras da fatura voltam às datas em que foram feitas).';

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
          'O orçamento é mensal, mas o período pode não começar no dia 1: use getBudgetSummary para saber as datas do período.',
          'Para totais e comparações (por categoria, por mês, por estrato), use getSpendingBreakdown em vez de somar listTransactions.',
          'Fatura de cartão: o pagamento da fatura vira uma fatura (importado do extrato da conta, ou com createInvoice quando o usuário conta que pagou) com uma parte "não discriminada" que conta no mês do pagamento. As compras do extrato do cartão ligadas a ela contam na data do pagamento (a data da compra fica em purchaseDate) e abatem o não discriminado. Use listInvoices para saber o que falta detalhar.',
          'Para corrigir uma transação, use editTransaction com o id de listTransactions (só os campos enviados mudam); para recategorizar várias de uma vez, categorizeTransactions.',
          'Transferências entre estratos (isTransfer) são um par de lançamentos: altere ou remova com editTransfer/deleteTransfer, pelo transferId.',
        ].join('\n'),
      },
    );

    this.registerReadTools(server, vaultId);
    this.registerWriteTools(server, vaultId);
    this.registerInvoiceTools(server, vaultId);
    return server;
  }

  private registerInvoiceTools(server: McpServer, vaultId: string) {
    const toInvoiceItem = (invoice: InvoiceView) => ({
      id: invoice.id,
      amount: invoice.amount,
      paymentDate: invoice.paymentDate.toISOString().slice(0, 10),
      estratoId: invoice.boxId,
      cardLabel: invoice.cardLabel,
      paymentImported: invoice.hasPaymentLine,
      status: invoice.status,
      itemized: invoice.itemized,
      remainder: invoice.remainder,
      excess: invoice.excess,
      purchaseCount: invoice.purchaseCount,
      statements: invoice.statements.map((st) => ({
        statementId: st.batchId,
        accountLabel: st.accountLabel,
      })),
    });

    server.registerTool(
      'listInvoices',
      {
        title: 'Listar faturas de cartão',
        description:
          'Lista as faturas de cartão, da mais recente para a mais antiga: valor pago, data do pagamento, quanto já foi detalhado com as compras do extrato do cartão (itemized), o que falta detalhar (remainder), o excedente quando as compras passam do valor pago (excess) e a situação (awaiting, partial, detailed, exceeded). Traz também os extratos de cartão com compras confirmadas que ainda não pertencem a nenhuma fatura.',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const [err, result] =
          await this.cardInvoiceService.listInvoices(vaultId);
        if (err !== null) return error(err);
        return json({
          invoices: result.invoices.map(toInvoiceItem),
          unlinkedStatements: result.unlinkedStatements.map((st) => ({
            statementId: st.batchId,
            accountLabel: st.accountLabel,
            periodStart: st.periodStart?.toISOString().slice(0, 10) ?? null,
            periodEnd: st.periodEnd?.toISOString().slice(0, 10) ?? null,
            purchaseCount: st.purchaseCount,
            total: st.total,
          })),
        });
      },
    );

    server.registerTool(
      'createInvoice',
      {
        title: 'Registrar fatura de cartão',
        description:
          'Registra uma fatura de cartão paga, quando o usuário conta que pagou e o extrato da conta ainda não foi importado. O valor passa a contar no mês do pagamento como "não discriminado" até as compras do extrato do cartão serem ligadas. Quando o extrato da conta trouxer o débito, ele é reconhecido como o pagamento desta fatura (mesmo valor e estrato, até 7 dias de diferença) e a data passa a ser a do extrato. Confira listInvoices antes: se já houver fatura de mesmo valor em data próxima, a criação é recusada, a menos que allowDuplicate seja true. Compras já registradas podem ser ligadas na mesma chamada (transactionIds); as que não puderem voltam em linkFailed.',
        inputSchema: {
          amount: z.number().positive().describe('Valor pago em R$'),
          paymentDate: z
            .string()
            .date()
            .describe('Data do pagamento (AAAA-MM-DD)'),
          estratoId: z
            .string()
            .optional()
            .describe('Estrato que pagou (padrão: o estrato padrão)'),
          cardLabel: z
            .string()
            .optional()
            .describe('Nome do cartão, ex.: "Nubank"'),
          allowDuplicate: z
            .boolean()
            .optional()
            .describe(
              'Confirma que é outra fatura, mesmo havendo uma de mesmo valor em data próxima',
            ),
          transactionIds: z
            .array(z.string())
            .max(200)
            .optional()
            .describe(
              'Compras (ids de listTransactions) para ligar já à fatura criada',
            ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (input) => {
        const [err, invoice] = await this.cardInvoiceService.createInvoice({
          vaultId,
          amount: input.amount,
          // Como as demais datas: AAAA-MM-DD vira meia-noite UTC.
          paymentDate: new Date(input.paymentDate),
          boxId: input.estratoId,
          cardLabel: input.cardLabel ?? null,
          allowDuplicate: input.allowDuplicate,
          transactionIds: input.transactionIds,
        });
        if (err !== null) return error(err);
        return json({
          ...toInvoiceItem(invoice.invoice),
          linkFailed: invoice.linkFailed,
        });
      },
    );

    server.registerTool(
      'getInvoice',
      {
        title: 'Detalhar fatura de cartão',
        description:
          'Detalha uma fatura de cartão: os mesmos dados de listInvoices, as compras ligadas a ela (com a data da compra) e a transação do não discriminado, se ainda houver.',
        inputSchema: { invoiceId: z.string().describe('ID da fatura') },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ invoiceId }) => {
        const [err, result] =
          await this.cardInvoiceService.listInvoices(vaultId);
        if (err !== null) return error(err);
        const invoice = result.invoices.find((i) => i.id === invoiceId);
        if (!invoice) return error('Fatura não encontrada');

        const [vaultErr, vault] = await this.vaultService.getVault({ vaultId });
        if (vaultErr !== null) return error(vaultErr);
        const categories = new Map(
          (await this.vaultService.getCategories(vaultId)).map((c) => [
            c.id,
            c.name,
          ]),
        );
        const linked = [...vault.transactions.values()].filter(
          (t) => t.invoiceId === invoiceId,
        );
        const remainder = linked.find((t) => t.isInvoiceRemainder);
        const purchases = linked
          .filter((t) => t.isInvoicePurchase)
          .sort((a, b) => a.purchaseDate!.getTime() - b.purchaseDate!.getTime())
          .map((t) => ({
            id: t.id,
            purchaseDate: t.purchaseDate!.toISOString().slice(0, 10),
            type: t.type,
            amount: t.amount,
            description: t.description ?? '',
            category: t.categoryId
              ? {
                  id: t.categoryId,
                  name: categories.get(t.categoryId) ?? null,
                }
              : null,
          }));

        return json({
          ...toInvoiceItem(invoice),
          remainderTransactionId: remainder?.id ?? null,
          purchases,
        });
      },
    );

    server.registerTool(
      'linkStatementToInvoice',
      {
        title: 'Ligar extrato do cartão a uma fatura',
        description:
          'Liga um extrato de cartão (statementId, de listInvoices) à fatura que ele detalha: as compras confirmadas dele passam a contar na data do pagamento da fatura e abatem o não discriminado. invoiceId: null desliga, e as compras voltam às datas em que foram feitas.',
        inputSchema: {
          statementId: z.string().describe('ID do extrato de cartão'),
          invoiceId: z
            .string()
            .nullable()
            .describe('ID da fatura, ou null para desligar'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ statementId, invoiceId }) => {
        const [err] = await this.cardInvoiceService.setBatchInvoice({
          vaultId,
          batchId: statementId,
          invoiceId,
        });
        if (err !== null) return error(err);
        const [listErr, result] =
          await this.cardInvoiceService.listInvoices(vaultId);
        if (listErr !== null) return error(listErr);
        const invoice = invoiceId
          ? result.invoices.find((i) => i.id === invoiceId)
          : undefined;
        return json({
          statementId,
          invoice: invoice ? toInvoiceItem(invoice) : null,
        });
      },
    );

    server.registerTool(
      'linkTransactionsToInvoice',
      {
        title: 'Ligar compras a uma fatura',
        description:
          'Liga compras avulsas (ids de listTransactions) a uma fatura de cartão: cada uma passa a contar na data do pagamento da fatura, guarda a data da compra em purchaseDate e abate o não discriminado. Serve para compras lançadas à mão ou que caíram na fatura errada (uma compra de outra fatura muda de fatura sem contar duas vezes). invoiceId: null desliga, e as compras voltam às datas em que foram feitas. Transferências e o próprio não discriminado são recusados; cada id é tratado à parte e os que falham voltam em "failed". Para ligar um extrato de cartão inteiro, use linkStatementToInvoice.',
        inputSchema: {
          ids: z
            .array(z.string())
            .min(1)
            .max(200)
            .describe('Ids das transações'),
          invoiceId: z
            .string()
            .nullable()
            .describe('ID da fatura, ou null para desligar'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ ids, invoiceId }) => {
        const [err, result] = await this.cardInvoiceService.linkTransactions({
          vaultId,
          transactionIds: ids,
          invoiceId,
        });
        if (err !== null) return error(err);
        const payload = {
          updated: result.updated,
          failed: result.failed,
          invoice: result.invoice ? toInvoiceItem(result.invoice) : null,
        };
        if (result.updated.length === 0) {
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(payload) }],
          };
        }
        return json(payload);
      },
    );

    server.registerTool(
      'deleteInvoice',
      {
        title: 'Excluir fatura de cartão',
        description:
          'Exclui uma fatura de cartão e a parte não discriminada dela. As compras que estavam ligadas continuam registradas e voltam a contar nas datas em que foram feitas; os extratos ficam sem fatura.',
        inputSchema: { invoiceId: z.string().describe('ID da fatura') },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ invoiceId }) => {
        const [err] = await this.cardInvoiceService.deleteInvoice({
          vaultId,
          invoiceId,
        });
        if (err !== null) return error(err);
        return json({ deleted: invoiceId });
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
          'Lista os estratos do usuário (contas correntes e reservas) com saldo atual e meta. Use o id para filtrar transações e gastos por estrato.',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const [err, boxes] = await this.vaultService.getBoxes(vaultId);
        if (err !== null) return error(err);
        return json(
          boxes.map((b) => ({
            id: b.id,
            name: b.name,
            kind: b.type === 'saving' ? 'reserva' : 'corrente',
            isDefault: b.isDefault,
            balance: round(b.balance),
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
          transactions: vault.transactions.values(),
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
        if (current?.isInvoiceRemainder) return error(INVOICE_REMAINDER_ERROR);
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
          'Adiciona uma alocação ao plano: uma reserva (acumula até uma meta) ou um pagamento planejado mensal.',
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
            scheduledMovements: [],
          },
        );
        if (err !== null) return error(err);
        return json({
          id: allocation.id,
          label: allocation.label,
          target: allocation.target,
          monthlyAmount: allocation.monthlyAmount,
          realizationMode: allocation.realizationMode,
        });
      },
    );

    server.registerTool(
      'updateAllocation',
      {
        title: 'Atualizar alocação',
        description:
          'Atualiza nome, meta, aporte mensal ou rendimento de uma alocação. Envie só o que deve mudar.',
        inputSchema: {
          allocationId: z.string().describe('ID da alocação'),
          label: z.string().min(1).optional(),
          target: z.number().min(0).optional().describe('Meta em R$'),
          monthlyAmount: changePoints.optional(),
          yieldRate: z
            .number()
            .optional()
            .describe('Rendimento anual (0.12 = 12%)'),
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
        if (current.isInvoiceRemainder) return error(INVOICE_REMAINDER_ERROR);
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
          if (current.isInvoiceRemainder) {
            failed.push({
              id,
              error:
                'Parte não discriminada de uma fatura: não tem categoria até as compras serem ligadas',
            });
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
