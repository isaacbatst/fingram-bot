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
import { randomUUID } from 'node:crypto';
import z from 'zod';
import { left, right } from '../../vault/domain/either';
import { CategoryRepository } from '../../vault/repositories/category.repository';
import { VaultService } from '../../vault/vault.service';
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
  ) {
    setDefaultOpenAIKey(this.openAiClient.apiKey);
    this.agent = new Agent<AgentContext>({
      name: 'FinGram Agent',
      model: 'gpt-4.1-nano',
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
        - Sua resposta deverá ter quebras de linha apropriadas para serem renderizadas no HTML com white-space: pre-wrap;
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

  private handleResult(result: any, conversationId: string) {
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
    return [getCategories, addTransaction];
  }
}
