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
import { Category } from '../../vault/domain/category';
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
  private categories: Category[] = [];
  constructor(
    private readonly openAiClient: OpenAiClient,
    private readonly categoryRepository: CategoryRepository,
    private readonly vaultService: VaultService,
  ) {
    setDefaultOpenAIKey(this.openAiClient.apiKey);
    this.agent = new Agent<AgentContext>({
      name: 'Basic Agent',
      model: 'gpt-4.1-nano',
      instructions: `Você é um agente que ajuda o usuário a gerenciar seu cofre financeiro.
        Caso o usuário pergunte sobre as categorias disponíveis, use a ferramenta getCategories para obter as categorias disponíveis.
        Caso o usuário queira adicionar uma transação, use a ferramenta addTransaction para adicionar a transação.

        Considere a data atual ${new Date().toISOString()} caso o usuário não forneça uma data.
        Infira o tipo de transação (income ou expense) de acordo com a descrição da transação. 
        A categoria deve ser uma das categorias disponíveis para o usuário. Use a ferramenta getCategories para obter as categorias disponíveis.

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
        `,
      tools: this.getTools(),
    });
    this.categoryRepository
      .findAll()
      .then((categories) => {
        this.categories = categories;
      })
      .catch((error) => {
        this.logger.error('Error loading categories', error);
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

      this.logger.debug(
        `Deserialized state: ${JSON.stringify(state._context)}`,
      );

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

    this.logger.debug(
      `runContext: ${JSON.stringify({
        context: {
          vaultId: params.vaultId,
        },
      })}`,
    );
    const result = await run(this.agent, input, {
      context: {
        vaultId: params.vaultId,
      },
    });

    this.logger.debug(
      `result.state._context: ${JSON.stringify(result.state._context)}`,
    );

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
      parameters: z.object({
        userId: z.string(),
      }),
      execute: ({ userId }) => {
        return `The categories for user ${userId} are ${JSON.stringify(this.categories)}.`;
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
      execute: ({ transaction }, runContext: RunContext<AgentContext>) => {
        this.logger.debug(
          `Executing addTransaction with transaction ${JSON.stringify(transaction)} and context ${JSON.stringify(runContext.context)}`,
        );
        if (!runContext || !runContext.context.vaultId) {
          throw new Error('Vault ID is required');
        }
        return this.vaultService.addTransactionToVault({
          vaultId: runContext.context.vaultId,
          transaction: {
            amount: transaction.amount,
            date: new Date(transaction.date),
            type: transaction.type,
            description: transaction.description,
            categoryId: transaction.categoryId,
            shouldCommit: true,
          },
        });
      },
    });
    return [getCategories, addTransaction];
  }
}
