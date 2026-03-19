import { Injectable, Logger } from '@nestjs/common';
import {
  Agent,
  MemorySession,
  run,
  RunContext,
  RunState,
  RunToolApprovalItem,
  setDefaultOpenAIKey,
  tool,
} from '@openai/agents';
import type { RunStreamEvent } from '@openai/agents';
import { randomUUID } from 'node:crypto';
import z from 'zod';
import { left, right } from '../../vault/domain/either';
import { CategoryRepository } from '../../vault/repositories/category.repository';
import { VaultService } from '../../vault/vault.service';
import { PlanService } from '../../plan/plan.service';
import { OpenAiClient } from './open-ai.client';

type AgentContext = {
  vaultId: string;
};

@Injectable()
export class OpenAiAgentService {
  private readonly logger = new Logger(OpenAiAgentService.name);
  private readonly agent: Agent<AgentContext>;
  private readonly sessions = new Map<string, MemorySession>();
  private readonly pendingStates = new Map<string, string>();

  constructor(
    private readonly openAiClient: OpenAiClient,
    private readonly categoryRepository: CategoryRepository,
    private readonly vaultService: VaultService,
    private readonly planService: PlanService,
  ) {
    setDefaultOpenAIKey(this.openAiClient.apiKey);
    this.agent = new Agent<AgentContext>({
      name: 'FinGram Agent',
      model: 'gpt-5.4-nano',
      instructions: `Você é um agente que ajuda o usuário a gerenciar o Duna, seu copiloto financeiro.
        Caso o usuário pergunte sobre as categorias disponíveis, use a ferramenta getCategories para obter as categorias disponíveis.
        Caso o usuário queira adicionar uma transação, use a ferramenta addTransaction para adicionar a transação. Esse pedido normalmente será simplesmente uma descrição de uma transação, como "Salário de 1000 reais" ou "Aluguel 1000 reais", considere essas mensagens um pedido de adição de transação e chame a ferramenta addTransaction imediatamente.
        Se for necessário buscar as categorias disponíveis para adicionar uma transação, busque-as imediatamente.
        Nunca responda que "vai chamar a ferramenta addTransaction" ou "vai chamar a ferramenta getCategories", apenas chame as ferramentas imediatamente caso as informações necessárias estejam disponíveis ou sejam inferíveis a partir da mensagem do usuário.
        Nunca diga que adicionou uma transação se a execução da ferramenta addTransaction não for aprovada, apenas informe que a ação foi rejeitada e pergunte ao usuário se ele deseja fazer outra ação ou mudar alguma informação.
        Se o usuário rejeitar uma ação, não tente chamar a ferramenta novamente, apenas informe que a ação foi rejeitada e pergunte ao usuário se ele deseja fazer outra ação.
        Caso fique em dúvida sobre a categoria de uma transação, use a mais provável entre as categorias disponíveis, pois o usuário poderá editar a categoria posteriormente.
        Nunca ignore quando uma ferramenta não for aprovada, imediatamente pergunte ao usuário se ele deseja fazer outra ação ou mudar alguma informação.

        Fluxo padrão:

        - Usuário: uber 10 reais no dia 10 de novembro de 2025
        - Agente: getCategories -> addTransaction -> informa que a transação foi adicionada com sucesso e o saldo atual do Duna.

        Use esse fluxo para evitar ficar confirmando ações do usuário.

        ----

        - Sua resposta será enviada para o usuário final.
        - Sua resposta será renderizada como Markdown. Use **negrito**, listas e quebras de linha quando apropriado.
        - Sua resposta não deve conter observações técnicas como sobre estar formatando corret
        - Considere a data atual ${new Date().toISOString()} caso o usuário não forneça uma data.
        - Infira o tipo de transação (income ou expense) de acordo com a descrição da transação.
        - A categoria deve ser uma das categorias disponíveis para o usuário. Use a ferramenta getCategories para obter as categorias disponíveis.
        - Você deve ser ágil, não fique confirmando, justifique as suas ações e use as ferramentas para adicionar a transação. A exceção é caso o usuário não forneça o valor da transação, nesse caso, pergunte ao usuário para fornecer o valor da transação.
        - Nunca sugira uma categoria que não está na lista de categorias disponíveis.
        - Sempre mencione datas formatadas para o usuário final, como "10 de novembro de 2025" e nunca no formato ISO 8601.
        - Sempre que uma transação for adicionada, informe o saldo atual do Duna formatado de maneira apropriada para o usuário final com moeda (R$) e casas decimais apropriadas, ele será retornado pela ferramenta addTransaction.

        Exemplo de entrada:
        - "Salário de 1000 reais" (income)
        - "Aluguel 1000 reais" (expense)
        - "roupas 100 reais" (expense)
        - "alimentos 100 reais" (expense)
        - "transporte 100 reais" (expense)
        - "lazer 100 reais" (expense)
        - "saúde 100 reais" (expense)
        - "escola 100 reais" (expense)
        - "família & pets 100 reais" (expense)

        Lembretes finais:
        - Não chame a ferramenta de addTransaction se o usuário acabou de rejeitar sua execução, apenas informe que a ação foi rejeitada e pergunte ao usuário se ele deseja fazer outra ação.
        - Não diga que a transação foi adicionada se a execução da ferramenta addTransaction não for aprovada, apenas informe que a ação foi rejeitada e pergunte ao usuário se ele deseja fazer outra ação ou mudar alguma informação.
        - Se o uso da ferramenta não for aprovado, não diga que houve um erro, pois o próprio usuário rejeitou a ação.

        ----

        PLANOS FINANCEIROS:

        O usuário pode ter planos financeiros de longo prazo. Use as ferramentas listPlans, getPlan e getProjection para responder perguntas sobre planos.

        Fluxo típico:
        - "Como está meu plano?" → listPlans → getPlan → resuma em linguagem natural
        - "Quanto vou ter no mês 24?" → listPlans → getProjection → responda com o valor
        - "Quando atinjo a meta da reserva?" → getProjection → encontre o mês onde o saldo da alocação atinge o target

        Regras:
        - Se o usuário tem apenas 1 plano, use-o automaticamente sem perguntar qual.
        - Se tem múltiplos planos, pergunte qual plano o usuário quer consultar.
        - Formate valores monetários em R$ com 2 casas decimais.
        - Formate datas para o usuário final como "janeiro de 2026", nunca ISO 8601.
        - Diferencie dados reais (isReal: true) de projetados (isReal: false) quando relevante.
        - Se a projeção é grande demais, resuma: mostre apenas meses-chave (início, marcos, final) em vez de todos os 120 meses.
        - Use o campo allocations do resultado para identificar alocações por ID. Cruze com getPlan para obter labels legíveis.
        - Nunca exponha IDs internos (UUIDs) para o usuário. Use apenas nomes legíveis.
        - Traduza status internos: draft → "rascunho", active → "ativo", archived → "arquivado".
        - Ao resumir um plano, mencione: nome, data de início, salário atual, custo de vida, alocações com labels e valores mensais.
        `,
      tools: this.getTools(),
    });
  }

  async execute(params: {
    message?: string;
    decisions: Record<string, 'approved' | 'rejected'>;
    conversationId: string;
    vaultId: string;
  }) {
    let conversationId = params.conversationId;
    if (!conversationId) {
      conversationId = this.generateConversationId();
    }

    const session = this.getOrCreateSession(conversationId);

    this.logger.log(
      `Executing agent with message "${params.message ?? ''}" and decisions ${JSON.stringify(params.decisions)} and conversationId ${conversationId}`,
    );

    // Handle approval decisions
    if (
      params.decisions &&
      Object.keys(params.decisions).length > 0 &&
      params.conversationId
    ) {
      this.logger.log(
        `Executing agent with decisions ${JSON.stringify(params.decisions)}`,
      );
      const stateString = this.pendingStates.get(params.conversationId);
      if (!stateString) {
        return left('Conversation not found');
      }

      const state: RunState<
        AgentContext,
        Agent<AgentContext>
      > = await RunState.fromString(this.agent, stateString);

      const interruptions = state.getInterruptions() as RunToolApprovalItem[];
      this.logger.log(`Interruptions ${JSON.stringify(interruptions)}`);
      interruptions.forEach((item: RunToolApprovalItem) => {
        if (item.type === 'tool_approval_item' && 'callId' in item.rawItem) {
          const callId = item.rawItem.callId;
          if (params.decisions[callId] === 'approved') {
            state.approve(item);
          } else if (params.decisions[callId] === 'rejected') {
            state.reject(item);
          }
        }
      });

      const result = await run(this.agent, state, {
        context: { vaultId: params.vaultId },
        session,
      });

      return this.handleResult(result, conversationId);
    }

    // Normal message
    const result = await run(this.agent, params.message ?? '', {
      context: { vaultId: params.vaultId },
      session,
    });

    return this.handleResult(result, conversationId);
  }

  async executeStream(
    params: {
      message?: string;
      decisions: Record<string, 'approved' | 'rejected'>;
      conversationId: string;
      vaultId: string;
    },
    emit: (event: string, data: unknown) => void,
  ) {
    let conversationId = params.conversationId;
    if (!conversationId) {
      conversationId = this.generateConversationId();
    }

    const session = this.getOrCreateSession(conversationId);

    this.logger.log(
      `Executing stream agent with message "${params.message ?? ''}" and conversationId ${conversationId}`,
    );

    let input: string | RunState<AgentContext, Agent<AgentContext>>;

    if (
      params.decisions &&
      Object.keys(params.decisions).length > 0 &&
      params.conversationId
    ) {
      const stateString = this.pendingStates.get(params.conversationId);
      if (!stateString) {
        emit('error', { message: 'Conversation not found' });
        return;
      }

      const state: RunState<AgentContext, Agent<AgentContext>> =
        await RunState.fromString(this.agent, stateString);

      const interruptions =
        state.getInterruptions() as RunToolApprovalItem[];
      interruptions.forEach((item: RunToolApprovalItem) => {
        if (item.type === 'tool_approval_item' && 'callId' in item.rawItem) {
          const callId = item.rawItem.callId;
          if (params.decisions[callId] === 'approved') {
            state.approve(item);
          } else if (params.decisions[callId] === 'rejected') {
            state.reject(item);
          }
        }
      });

      input = state;
    } else {
      input = params.message ?? '';
    }

    try {
      const result = await run(this.agent, input, {
        context: { vaultId: params.vaultId },
        session,
        stream: true,
      });

      for await (const event of result as AsyncIterable<RunStreamEvent>) {
        if (
          event.type === 'raw_model_stream_event' &&
          event.data.type === 'output_text_delta'
        ) {
          emit('text_delta', { delta: event.data.delta });
        }

        if (event.type === 'run_item_stream_event') {
          if (event.name === 'tool_called') {
            const raw = event.item.rawItem as { callId?: string; name?: string };
            emit('tool_called', {
              name: raw.name ?? '',
              callId: raw.callId ?? '',
            });
          }

          if (event.name === 'tool_output') {
            const item = event.item as { rawItem: { callId?: string }; output?: unknown };
            emit('tool_output', {
              callId: item.rawItem.callId ?? '',
              output:
                typeof item.output === 'string'
                  ? item.output
                  : JSON.stringify(item.output),
            });
          }

          if (event.name === 'tool_approval_requested') {
            // Will be handled after stream completes via interruptions
          }
        }
      }

      await result.completed;

      if (result.interruptions && result.interruptions.length > 0) {
        this.pendingStates.set(conversationId, JSON.stringify(result.state));
        emit('approval_requested', {
          approvals: result.interruptions
            .filter((item: any) => item.type === 'tool_approval_item')
            .map((item: any) => item.toJSON()),
          conversationId,
        });
      } else {
        this.pendingStates.delete(conversationId);
        emit('done', {
          conversationId,
          history: result.history,
        });
      }
    } catch (error) {
      this.logger.error(`Stream error: ${error}`);
      emit('error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private handleResult(result: any, conversationId: string) {
    if (result.rawResponses?.length) {
      let totalInput = 0;
      let totalOutput = 0;
      let cachedInput = 0;
      for (const resp of result.rawResponses) {
        const u = resp.usage;
        if (u) {
          totalInput += u.inputTokens ?? 0;
          totalOutput += u.outputTokens ?? 0;
          cachedInput += u.inputTokensDetails?.[0]?.cached_tokens ?? 0;
        }
      }
      this.logger.log(
        `Token usage — input: ${totalInput} (cached: ${cachedInput}), output: ${totalOutput}, total: ${totalInput + totalOutput}, api_calls: ${result.rawResponses.length}`,
      );
    }

    if (result.interruptions.length > 0) {
      this.pendingStates.set(conversationId, JSON.stringify(result.state));
      return right({
        conversationId,
        approvals: result.interruptions
          .filter((item: any) => item.type === 'tool_approval_item')
          .map((item: any) => item.toJSON()),
        history: result.history,
      });
    }

    this.pendingStates.delete(conversationId);
    return right({
      response: result.finalOutput as string,
      history: result.history,
      conversationId,
    });
  }

  private getOrCreateSession(conversationId: string): MemorySession {
    let session = this.sessions.get(conversationId);
    if (!session) {
      session = new MemorySession();
      this.sessions.set(conversationId, session);
    }
    return session;
  }

  private generateConversationId() {
    return `conv_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }

  private getTools() {
    const getCategories = tool({
      name: 'getCategories',
      description: 'Obtém as categorias de transações para um usuário',
      parameters: z.object({}),
      execute: async (_, runContext: RunContext<AgentContext>) => {
        const categories = await this.categoryRepository.findAllByVaultId(
          runContext.context.vaultId,
        );
        return `The categories for this user are ${JSON.stringify(categories)}.`;
      },
    });
    const addTransaction = tool({
      name: 'addTransaction',
      description: 'Adiciona uma transação ao Duna.',
      needsApproval: true,
      parameters: z.object({
        transaction: z.object({
          amount: z.number(),
          date: z.string().datetime(),
          type: z.enum(['income', 'expense']),
          description: z.string(),
          categoryId: z.string(),
          categoryName: z.string(),
        }),
      }),
      execute: async (
        { transaction },
        runContext: RunContext<AgentContext>,
      ) => {
        this.logger.debug(
          `Executing addTransaction with transaction ${JSON.stringify(transaction)} and context ${JSON.stringify(runContext.context)}`,
        );
        if (!runContext || !runContext.context.vaultId) {
          throw new Error('Vault ID is required');
        }
        const [err, vault] = await this.vaultService.addTransactionToVault({
          vaultId: runContext.context.vaultId,
          transaction: {
            amount: transaction.amount,
            date: new Date(transaction.date),
            type: transaction.type,
            description: transaction.description,
            categoryId: transaction.categoryId,
            shouldCommit: true,
          },
          platform: 'web',
        });
        if (err) {
          throw new Error(err);
        }
        return `A transação de ${transaction.amount} reais foi registrada com sucesso na categoria ${transaction.categoryName}. Saldo atual: ${vault?.vault.getBalance()}`;
      },
    });
    const listPlans = tool({
      name: 'listPlans',
      description: 'Lista os planos financeiros do usuário',
      parameters: z.object({}),
      execute: async (_, runContext: RunContext<AgentContext>) => {
        const plans = await this.planService.getByVaultId(
          runContext.context.vaultId,
        );
        if (plans.length === 0) {
          return 'O usuário não possui nenhum plano financeiro.';
        }
        return JSON.stringify(
          plans.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            startDate: p.startDate.toISOString(),
            salaryChangePoints: p.premises.salaryChangePoints,
            costOfLivingChangePoints: p.premises.costOfLivingChangePoints,
          })),
        );
      },
    });

    const getPlan = tool({
      name: 'getPlan',
      description:
        'Obtém detalhes completos de um plano, incluindo premissas, alocações e marcos',
      parameters: z.object({
        planId: z.string().describe('ID do plano'),
      }),
      execute: async ({ planId }, runContext: RunContext<AgentContext>) => {
        const [err, data] = await this.planService.getById(
          planId,
          runContext.context.vaultId,
        );
        if (err) return `Erro: ${err}`;
        return JSON.stringify({
          plan: {
            id: data.plan.id,
            name: data.plan.name,
            status: data.plan.status,
            startDate: data.plan.startDate.toISOString(),
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
            estratoId: a.estratoId,
          })),
        });
      },
    });

    const getProjection = tool({
      name: 'getProjection',
      description:
        'Calcula a projeção financeira mês a mês de um plano. Retorna patrimônio total, caixa, saldo por alocação e marcos atingidos.',
      parameters: z.object({
        planId: z.string().describe('ID do plano'),
        months: z
          .number()
          .default(120)
          .describe('Número de meses a projetar (padrão: 120)'),
      }),
      execute: async (
        { planId, months },
        runContext: RunContext<AgentContext>,
      ) => {
        const [err, projection] = await this.planService.getProjection(
          planId,
          runContext.context.vaultId,
          months,
        );
        if (err) return `Erro: ${err}`;

        const summary = projection.map((m) => ({
          month: m.month,
          date: m.date.toISOString().slice(0, 7),
          income: m.income,
          costOfLiving: m.costOfLiving,
          surplus: m.surplus,
          cash: Math.round(m.cash * 100) / 100,
          totalWealth: Math.round(m.totalWealth * 100) / 100,
          allocations: Object.fromEntries(
            Object.entries(m.allocations).map(([k, v]) => [
              k,
              Math.round(v * 100) / 100,
            ]),
          ),
          isReal: m.isReal,
        }));

        return JSON.stringify(summary);
      },
    });

    const updatePremises = tool({
      name: 'updatePremises',
      description:
        'Atualiza premissas de um plano (change points de salário e/ou custo de vida). Envie apenas os campos que deseja alterar.',
      needsApproval: true,
      parameters: z.object({
        planId: z.string().describe('ID do plano'),
        salaryChangePoints: z
          .array(z.object({ month: z.number(), amount: z.number() }))
          .optional()
          .describe('Novos change points de salário (substitui todos)'),
        costOfLivingChangePoints: z
          .array(z.object({ month: z.number(), amount: z.number() }))
          .optional()
          .describe('Novos change points de custo de vida (substitui todos)'),
      }),
      execute: async (
        { planId, salaryChangePoints, costOfLivingChangePoints },
        runContext: RunContext<AgentContext>,
      ) => {
        const [err, plan] = await this.planService.updatePremises(
          planId,
          runContext.context.vaultId,
          { salaryChangePoints, costOfLivingChangePoints },
        );
        if (err) return `Erro: ${err}`;
        return `Premissas atualizadas com sucesso. Salário: ${JSON.stringify(plan.premises.salaryChangePoints)}, Custo de vida: ${JSON.stringify(plan.premises.costOfLivingChangePoints)}`;
      },
    });

    const addAllocation = tool({
      name: 'addAllocation',
      description: 'Adiciona uma nova alocação a um plano existente.',
      needsApproval: true,
      parameters: z.object({
        planId: z.string().describe('ID do plano'),
        label: z.string().describe('Nome da alocação'),
        target: z.number().describe('Meta em R$ (0 se não houver meta)'),
        monthlyAmount: z
          .array(z.object({ month: z.number(), amount: z.number() }))
          .describe('Valor mensal (change points)'),
        realizationMode: z
          .enum(['immediate', 'manual', 'onCompletion', 'never'])
          .describe('Modo de realização: immediate=pagamento mensal, manual=reserva com saque manual, onCompletion=reserva saque ao atingir meta, never=reserva sem saque'),
      }),
      execute: async (
        { planId, label, target, monthlyAmount, realizationMode },
        runContext: RunContext<AgentContext>,
      ) => {
        const [err, allocation] = await this.planService.addAllocation(
          planId,
          runContext.context.vaultId,
          { label, target, monthlyAmount, realizationMode, scheduledMovements: [] },
        );
        if (err) return `Erro: ${err}`;
        return `Alocação "${allocation.label}" adicionada com sucesso. Meta: R$ ${allocation.target}, Aporte mensal: R$ ${allocation.monthlyAmount[0]?.amount ?? 0}`;
      },
    });

    const updateAllocation = tool({
      name: 'updateAllocation',
      description:
        'Atualiza uma alocação existente (label, target, monthlyAmount, yieldRate). Envie apenas os campos que deseja alterar.',
      needsApproval: true,
      parameters: z.object({
        allocationId: z.string().describe('ID da alocação'),
        label: z.string().optional().describe('Novo nome'),
        target: z.number().optional().describe('Nova meta em R$'),
        monthlyAmount: z
          .array(z.object({ month: z.number(), amount: z.number() }))
          .optional()
          .describe('Novo valor mensal (change points)'),
        yieldRate: z.number().optional().describe('Nova taxa de rendimento anual'),
      }),
      execute: async (
        { allocationId, ...updates },
        runContext: RunContext<AgentContext>,
      ) => {
        const [err, allocation] = await this.planService.updateAllocation(
          allocationId,
          runContext.context.vaultId,
          updates,
        );
        if (err) return `Erro: ${err}`;
        return `Alocação "${allocation.label}" atualizada. Meta: R$ ${allocation.target}, Aporte mensal: R$ ${allocation.monthlyAmount[0]?.amount ?? 0}`;
      },
    });

    const removeAllocation = tool({
      name: 'removeAllocation',
      description: 'Remove uma alocação de um plano.',
      needsApproval: true,
      parameters: z.object({
        allocationId: z.string().describe('ID da alocação'),
        allocationLabel: z.string().describe('Nome da alocação (para confirmação)'),
      }),
      execute: async (
        { allocationId, allocationLabel },
        runContext: RunContext<AgentContext>,
      ) => {
        const [err] = await this.planService.removeAllocation(
          allocationId,
          runContext.context.vaultId,
        );
        if (err) return `Erro: ${err}`;
        return `Alocação "${allocationLabel}" removida com sucesso.`;
      },
    });

    return [
      getCategories,
      addTransaction,
      listPlans,
      getPlan,
      getProjection,
      updatePremises,
      addAllocation,
      updateAllocation,
      removeAllocation,
    ];
  }
}
