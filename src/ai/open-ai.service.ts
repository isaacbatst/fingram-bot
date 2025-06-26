import OpenAI from 'openai';
import { AiService } from './ai.service';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { Injectable } from '@nestjs/common';
import { Action, ActionType } from '../domain/action';
import { Either, left, right } from '../domain/either';
import { Category } from '../domain/category';

const schema = z.object({
  match: z.boolean(),
  action: z.discriminatedUnion('action', [
    z.object({
      action: z.literal(ActionType.EXPENSE),
      payload: z.object({
        amount: z.number(),
        description: z.string(),
        categoryId: z.string(),
      }),
    }),
    z.object({
      action: z.literal(ActionType.INCOME),
      payload: z.object({
        amount: z.number(),
        description: z.string(),
        categoryId: z.string(),
      }),
    }),
  ]),
});

@Injectable()
export class OpenAiService extends AiService {
  openAi: OpenAI;

  constructor(private configService: ConfigService) {
    super();
    this.openAi = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('OPEN_AI_API_KEY'),
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
        format: zodTextFormat(schema, 'action'),
      },
    });

    if (!response.output_parsed?.match) {
      return left(`Ação não reconhecida ou inválida: ${input}`);
    }

    const action = response.output_parsed.action;
    return right(Action.create(action.action, action.payload));
  }
}
