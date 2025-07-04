import { Action, ActionType } from '@/vault/domain/action';
import { Category } from '@/vault/domain/category';
import { ConcurrencyQueue } from '@/vault/domain/concurrency-queue';
import { Either, left, right } from '@/vault/domain/either';
import { Transaction } from '@/vault/domain/transaction';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { AiService } from './ai.service';

const parseVaultActionSchema = z.object({
  match: z.boolean(),
  action: z.discriminatedUnion('action', [
    z.object({
      action: z.enum([ActionType.INCOME, ActionType.EXPENSE]),
      payload: z.object({
        amount: z.number(),
        description: z.string(),
        categoryId: z.string(),
        categoryName: z.string(),
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
      transactionDescription: z.string(),
      categoryId: z.string(),
      categoryName: z.string(),
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
    customPrompt = '',
  ): Promise<Either<string, Action>> {
    const response = await this.openAi.responses.parse({
      model: 'gpt-4.1-nano',
      instructions: `Você é um assistente que interpreta comandos para um cofre financeiro.
      O usuário pode solicitar ações de criar receitas e despesas no cofre.
      
      Se o usuário não solicitar uma ação ou não puder ser interpretada, retorne uma ação 'noAction' e match false.

      Na maioria dos casos o usuário não dirá explicitamente que está criando uma receita ou despesa, mas você deve inferir isso a partir da descrição.
      
      Exemplo de receita: "100 salário"
      Exemplo de despesa: "50 café" 
      
      Muitas vezes uma transação será uma transferência para uma pessoa ou empresa, o nome pode dar uma pista da categoria, como "Transferência para Curso de Inglês" ou "Pagamento Uber"
      O usuário poderá fornecer uma customização do prompt para dar mais contexto, como deixar claro que uma transferência para "João" é uma despesa de "Transporte" ou "Educação", por exemplo.
      
      Identifique também a categoria da transação.
      Atenção, mapeie as transações para o ID da categoria, não para o nome da ou descrição.
      
      As categorias disponíveis são:
      
      \`\`\`
      ${JSON.stringify(
        categories.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          transactionType: c.transactionType,
        })),
        null,
        2,
      )}
      \`\`\`

      Exemplo ERRADO:
      - TransactionId: x, CategoryId: ${categories[0].name}
      - TransactionId: y, CategoryId: ${categories[0].code}

      Exemplo CERTO:
      - TransactionId: x, CategoryId: ${categories[0].id}
      - TransactionId: y, CategoryId: ${categories[1].id}
      `,
      input: `
        Contexto adicional do usuário: ${customPrompt}
        Ação solicitada (pode ser a descrição de uma receita ou despesa): ${input}
      `,
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
    customPrompt: string,
  ): Promise<Either<string, Map<string, string>>> {
    const tag = '[parseTransactionsFile]';
    console.log(
      `${tag} Starting parsing of ${transactions.length} transactions@.`,
    );

    try {
      const chunkSize = 5;
      const concurrency = 5;

      const chunks = this.chunkArray(transactions, chunkSize);
      console.log(
        `${tag} Split transactions into ${chunks.length} chunk(s) of up to ${chunkSize} each.`,
      );

      const chunksLogs = chunks.map((chunk, index) => ({
        title: `${tag} Chunk #${index + 1}: ${chunk.length}`,
        content: '',
      }));

      const processChunk = async (
        chunk: Transaction[],
        index: number,
      ): Promise<ParsedTransaction[]> => {
        console.log(
          `${tag} Processing chunk #${index + 1} with ${chunk.length} transactions.`,
        );

        const stream = this.openAi.responses
          .stream({
            model: 'gpt-4.1-mini',
            instructions: this.parseTransactionsFileInstructions(categories),
            input: `
            ${customPrompt ? `Contexto adicional do usuário: ${customPrompt}` : ''}

            -----
              Arquivo de transações:
              \`\`\`
              ${JSON.stringify(
                chunk.map((t) => ({
                  id: t.id,
                  description: t.description,
                  amount: t.amount,
                  type: t.type,
                })),
                null,
                2,
              )}
              \`\`\`
            `,
            text: {
              format: zodTextFormat(
                parseTransactionsFileSchema,
                'transactions',
              ),
            },
          })
          .on('response.output_text.delta', (event) => {
            chunksLogs[index].content += event.delta;
            console.log(
              chunksLogs
                .map(
                  (log) => log.title + `(${log.content.length} parsed chars)`,
                )
                .join('\n'),
            );
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
      console.log('customPrompt:', customPrompt);

      return right(map);
    } catch (err) {
      console.error(`${tag} Error processing:`, err);
      return left(
        `Erro ao processar transações: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  parseTransactionsFileInstructions(categories: Category[]): string {
    const categoriesWithDesc = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      description: cat.description ?? `Categoria relacionada a ${cat.name}`,
      transactionType: cat.transactionType,
    }));

    return `
Você é um assistente que interpreta comandos para um cofre financeiro.
O usuário enviou um extrato de transações financeiras.
Seu objetivo é identificar a categoria de cada transação com base na descrição e no tipo.
Use apenas as categorias abaixo:

\`\`\`
${JSON.stringify(categoriesWithDesc, null, 2)}
\`\`\`

Muitas vezes uma transação será uma transferência para uma pessoa ou empresa, a descrição da transação pode dar uma pista da categoria, como "Transferência para Curso de Inglês" (despesa de Educação) ou "Pagamento Uber" (despesa de Transporte), "Pet Center" (despesa de Família & Pets).
Transferência por PIX é descrita no seguinte formato: "Transferência enviada pelo Pix - Recipiente (Nome da Pessoa ou Empresa) - CPF/CNPJ - Informações Bancárias.
Com base no nome da pessoa ou empresa, você deve inferir a categoria correta.
O usuário poderá fornecer uma customização do prompt para dar mais contexto, como por exmplo informar que no contexto dele uma transferência para "João" é uma despesa de categoria X ou Y.
Se não encontrar uma categoria adequada, marque como "Outros", mas SEMPRE marque como alguma categoria, mesmo que seja "Outros".
`;
  }
}
