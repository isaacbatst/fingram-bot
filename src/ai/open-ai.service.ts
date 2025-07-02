import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { Action, ActionType } from '../vault/domain/action';
import { Category } from '../vault/domain/category';
import { Either, left, right } from '../vault/domain/either';
import { Transaction } from '../vault/domain/transaction';
import { AiService } from './ai.service';
import { ConcurrencyQueue } from '../vault/domain/concurrency-queue';

const parseVaultActionSchema = z.object({
  match: z.boolean(),
  action: z.discriminatedUnion('action', [
    z.object({
      action: z.enum([ActionType.INCOME, ActionType.EXPENSE]),
      payload: z.object({
        amount: z.number(),
        description: z.string(),
        categoryId: z.string(),
      }),
    }),
  ]),
});

interface ParsedTransaction {
  transactionId: string;
  categoryId: string;
}

const parseTransactionsFileSchema = z.object({
  transactions: z.array(
    z.object({
      transactionId: z.string(),
      categoryId: z.string(),
    }),
  ),
});

@Injectable()
export class OpenAiService extends AiService {
  openAi: OpenAI;

  constructor(private configService: ConfigService) {
    super();
    this.openAi = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('OPEN_AI_API_KEY'),
      //  5 min timeout for requests
      timeout: 5 * 60 * 1000,
    });
  }

  async parseVaultAction(
    input: string,
    categories: Category[],
  ): Promise<Either<string, Action>> {
    const response = await this.openAi.responses.parse({
      model: 'gpt-4.1-nano',
      instructions: `Você é um assistente que interpreta comandos para um cofre financeiro.
      O usuário pode solicitar ações de criar receitas e despesas no cofre.
      
      Se o usuário não solicitar uma ação ou não puder ser interpretada, retorne uma ação 'noAction' e match false.

      Na maioria dos casos o usuário não dirá explicitamente que está criando uma receita ou despesa, mas você deve inferir isso a partir da descrição.
      
      Exemplo de receita: "100 salário" { amount: 100, description: 'salário' }, "salário 2000" { amount: 2000, description: 'salário' }, "500 bônus" { amount: 500, description: 'bônus' }
      Exemplo de despesa: "50 café" { amount: 50, description: 'café' }, "100 gasolina" { amount: 100, description: 'gasolina' }, "1000 mercado" { amount: 1000, description: 'mercado' }
      
      Identifique também a categoria da transação, as disponíveis são: ${JSON.stringify(categories)}
      `,
      input: input,
      text: {
        format: zodTextFormat(parseVaultActionSchema, 'action'),
      },
    });

    if (!response.output_parsed?.match) {
      return left(`Ação não reconhecida ou inválida: ${input}`);
    }

    const action = response.output_parsed.action;
    return right(Action.create(action.action, action.payload));
  }

  chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  async parseTransactionsFile(
    transactions: Transaction[],
    categories: Category[],
  ): Promise<Either<string, Map<string, string>>> {
    const tag = '[parseTransactionsFile]';
    console.log(
      `${tag} Starting parsing of ${transactions.length} transactions...`,
    );

    try {
      const chunkSize = 5;
      const concurrency = 5;

      const chunks = this.chunkArray(transactions, chunkSize);
      console.log(
        `${tag} Split transactions into ${chunks.length} chunk(s) of up to ${chunkSize} each.`,
      );

      const chunksLogs = chunks.map(
        (chunk, index) =>
          `${tag} Chunk #${index + 1}: ${chunk.length} transactions: `,
      );

      const processChunk = async (
        chunk: Transaction[],
        index: number,
      ): Promise<ParsedTransaction[]> => {
        console.log(
          `${tag} Processing chunk #${index + 1} with ${chunk.length} transactions...`,
        );

        const stream = this.openAi.responses
          .stream({
            model: 'gpt-4.1-nano',
            instructions: this.buildParseTransactionsFile(categories),
            input: JSON.stringify(
              chunk.map((t) => ({
                id: t.id,
                description: t.description,
                amount: t.amount,
                type: t.type,
              })),
            ),
            text: {
              format: zodTextFormat(
                parseTransactionsFileSchema,
                'transactions',
              ),
            },
          })
          .on('response.output_text.delta', (event) => {
            chunksLogs[index] += event.delta;
            console.log(chunksLogs.join('\n'));
          });

        const response = await stream.finalResponse();

        if (!response.output_parsed) {
          const errorMsg = response.error?.message ?? 'sem mensagem';
          console.error(
            `${tag} Error processing chunk #${index + 1}: ${errorMsg}`,
          );
          return [];
        }

        console.log(`${tag} Chunk #${index + 1} processed successfully.`);
        return response.output_parsed.transactions as ParsedTransaction[];
      };

      // Usa ConcurrencyQueue para processar os chunks com concorrência
      const queue = new ConcurrencyQueue(chunks, concurrency, processChunk);
      const chunksResults = await queue.run();

      const map = new Map<string, string>();
      chunksResults.forEach((chunkResult, idx) => {
        if (!chunkResult || chunkResult.length === 0) {
          console.warn(`${tag} Chunk #${idx + 1} returned no results.`);
          return;
        }
        chunkResult.forEach((transaction) => {
          if (transaction.categoryId) {
            map.set(transaction.transactionId, transaction.categoryId);
          } else {
            console.warn(
              `${tag} Transaction ${transaction.transactionId} has no categoryId assigned.`,
            );
          }
        });
      });

      console.log(
        `${tag} All chunks processed, total mapped transactions: ${map.size}`,
      );

      return right(map);
    } catch (err) {
      console.error(`${tag} Error processing:`, err);
      return left(
        `Erro ao processar transações: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  buildParseTransactionsFile(categories: Category[]): string {
    const categoriesWithDesc = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      description: cat.description ?? `Categoria relacionada a ${cat.name}`,
    }));

    return `
Você é um assistente que interpreta comandos para um cofre financeiro.
O usuário enviou um extrato de transações financeiras.
Seu objetivo é identificar a categoria de cada transação com base na descrição e no tipo.
Use apenas as categorias abaixo:

${JSON.stringify(categoriesWithDesc)}
`;
  }
}
