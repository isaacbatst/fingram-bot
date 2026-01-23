import { Injectable, Logger } from '@nestjs/common';
import {
  Agent,
  AgentInputItem,
  run,
  RunContext,
  RunState,
  RunToolApprovalItem,
  setDefaultOpenAIClient,
  setDefaultOpenAIKey,
  tool,
} from '@openai/agents';
import { randomUUID } from 'node:crypto';
import z from 'zod';
import { left, right } from '../../vault/domain/either';
import { CategoryRepository } from '../../vault/repositories/category.repository';
import { VaultService } from '../../vault/vault.service';
import { AgentConversationsStore } from '../cache/agent-conversations-store';
import { OpenAiClient } from './open-ai.client';

type AgentContext = {
  vaultId: string;
};

@Injectable()
export class OpenAiAgentService {
  private readonly logger = new Logger(OpenAiAgentService.name);
  private readonly agent: Agent<AgentContext>;
  constructor(
    private readonly openAiClient: OpenAiClient,
    private readonly categoryRepository: CategoryRepository,
    private readonly vaultService: VaultService,
  ) {
    setDefaultOpenAIKey(this.openAiClient.apiKey);
    this.agent = new Agent<AgentContext>({
      name: 'FinGram Agent',
      model: 'gpt-4.1-nano',
      instructions: `Você é um agente que ajuda o usuário a gerenciar seu cofre financeiro.
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
        - Agente: getCategories -> addTransaction -> informa que a transação foi adicionada com sucesso e o saldo atual do cofre financeiro.

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
        - Sempre que uma transação for adicionada, informe o saldo atual do cofre financeiro formatado de maneira apropriada para o usuário final com moeda (R$) e casas decimais apropriadas, ele será retornado pela ferramenta addTransaction.

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
    messages: AgentInputItem[];
    decisions: Record<string, 'approved' | 'rejected'>;
    conversationId: string;
    vaultId: string;
  }) {
    const { messages = [], decisions = null } = params;
    let conversationId = params.conversationId;
    if (!conversationId) {
      conversationId = this.generateConversationId();
    }
    this.logger.log(
      `Executing agent with messages ${JSON.stringify(messages)} and decisions ${JSON.stringify(decisions)} and conversationId ${conversationId}`,
    );
    let input: AgentInputItem[] | RunState<AgentContext, Agent<AgentContext>>;

    if (
      decisions &&
      Object.keys(decisions).length > 0 &&
      params.conversationId /* original conversationId */
    ) {
      this.logger.log(
        `Executing agent with decisions ${JSON.stringify(decisions)}`,
      );
      // If we receive a new request with decisions, we will look up the current state in the database
      const stateString = AgentConversationsStore.store.get(
        params.conversationId,
      );

      if (!stateString) {
        return left('Conversation not found');
      }

      // We then deserialize the state so we can manipulate it and continue the run
      const state: RunState<
        AgentContext,
        Agent<AgentContext>
      > = await RunState.fromString(this.agent, stateString);

      const interruptions = state.getInterruptions() as RunToolApprovalItem[];
      this.logger.log(`Interruptions ${JSON.stringify(interruptions)}`);
      interruptions.forEach((item: RunToolApprovalItem) => {
        if (item.type === 'tool_approval_item' && 'callId' in item.rawItem) {
          const callId = item.rawItem.callId;

          if (decisions[callId] === 'approved') {
            state.approve(item);
          } else if (decisions[callId] === 'rejected') {
            state.reject(item);
          }
        }
      });

      input = state;
    } else {
      input = messages;
    }

    const result = await run(this.agent, input, {
      context: {
        vaultId: params.vaultId,
      },
    });

    if (result.interruptions.length > 0) {
      // If the run resulted in one or more interruptions, we will store the current state in the database

      // store the state in the database
      AgentConversationsStore.store.set(
        conversationId,
        JSON.stringify(result.state),
      );

      // We will return all the interruptions as approval requests to the UI/client so it can generate
      // the UI for approvals
      // We will also still return the history that contains the tool calls and potentially any interim
      // text response the agent might have generated (like announcing that it's calling a function)
      return right({
        conversationId,
        approvals: result.interruptions
          .filter((item) => item.type === 'tool_approval_item')
          .map((item) => item.toJSON()),
        history: result.history,
      });
    }

    return right({
      response: result.finalOutput as string,
      history: result.history,
      conversationId,
    });
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
      description: 'Adiciona uma transação ao cofre financeiro.',
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
