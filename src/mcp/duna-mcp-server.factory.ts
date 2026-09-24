import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PlanService } from '@/plan/plan.service';
import { VaultService } from '@/vault/vault.service';
import { VaultWebService } from '@/vault/vault-web.service';

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

function json(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function error(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
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
        ].join('\n'),
      },
    );

    this.registerReadTools(server, vaultId);
    this.registerWriteTools(server, vaultId);
    return server;
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
          'Lista transações de um período de orçamento, da mais recente para a mais antiga, com filtros opcionais por categoria e descrição. Paginado.',
        inputSchema: {
          ...period,
          categoryId: z.string().optional().describe('Filtra por categoria'),
          description: z
            .string()
            .optional()
            .describe('Filtra por trecho da descrição'),
          allPeriods: z
            .boolean()
            .optional()
            .describe('Busca em todos os períodos, ignorando mês e ano'),
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
        const [err, result] = await this.vaultService.getTransactions({
          vaultId,
          date,
          categoryId: input.categoryId,
          description: input.description,
          ignorePeriod: input.allPeriods,
          page: input.page ?? 1,
          pageSize: input.pageSize ?? 50,
        });
        if (err !== null) return error(err);
        return json({
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: result.totalPages,
          items: result.items.map((t) => ({
            code: t.code,
            date: t.date.toISOString().slice(0, 10),
            type: t.type,
            amount: t.amount,
            description: t.description ?? '',
            category: t.category
              ? { id: t.category.id, name: t.category.name }
              : null,
            committed: t.isCommitted,
            isTransfer: t.transferId !== null,
            allocationId: t.allocationId ?? null,
          })),
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
          code: result.transaction.code,
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
          'Remove uma transação pelo código (retornado por addTransaction e listTransactions).',
        inputSchema: {
          code: z.string().describe('Código da transação'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ code }) => {
        const [err] = await this.vaultService.deleteTransaction({
          vaultId,
          transactionCode: code,
        });
        if (err !== null) return error(err);
        return json({ deleted: code });
      },
    );

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
}
