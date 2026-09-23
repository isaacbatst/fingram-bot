import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAiService } from './open-ai.service';
import { AI_MODELS } from './ai-models';
import { OpenAiClient } from './open-ai.client';
import { Category } from '@/vault/domain/category';

const categories = [
  new Category('c1', 'Compras', '1', 'mercado', 'expense'),
  new Category('c2', 'Trabalho', '2', 'salário', 'income'),
];

/** Procura `oneOf` em qualquer profundidade do JSON Schema enviado. */
const hasOneOf = (node: unknown): boolean => {
  if (!node || typeof node !== 'object') return false;
  if ('oneOf' in node) return true;
  return Object.values(node).some(hasOneOf);
};

describe('OpenAiService — chamadas à Responses API', () => {
  let calls: Record<string, any>[];
  let parsed: unknown;
  let service: OpenAiService;

  beforeEach(() => {
    calls = [];
    const fakeClient = {
      openAi: {
        responses: {
          parse: async (params: Record<string, any>) => {
            calls.push(params);
            return { output_parsed: parsed };
          },
        },
      },
    } as unknown as OpenAiClient;
    service = new OpenAiService(fakeClient);
  });

  describe('parseVaultAction', () => {
    beforeEach(() => {
      parsed = {
        match: true,
        action: {
          action: 'expense',
          payload: {
            amount: 289.9,
            description: 'mercado',
            categoryId: 'c1',
            categoryName: 'Compras',
          },
        },
      };
    });

    it('should not send oneOf in the structured output schema', async () => {
      // Regressão: com o zod v4 um discriminatedUnion vira oneOf, que a OpenAI
      // recusa com 400 em qualquer modelo — o /ai do bot ficou fora do ar assim.
      await service.parseVaultAction('mercado 289,90', categories);
      expect(hasOneOf(calls[0].text.format.schema)).toBe(false);
    });

    it('should use the configured model and reasoning effort', async () => {
      await service.parseVaultAction('mercado 289,90', categories);
      expect(calls[0].model).toBe(AI_MODELS.parseAction.model);
      expect(calls[0].reasoning?.effort).toBe(
        AI_MODELS.parseAction.reasoningEffort,
      );
    });

    it('should build the action from the parsed output', async () => {
      const [error, action] = await service.parseVaultAction(
        'mercado 289,90',
        categories,
      );
      expect(error).toBeNull();
      expect(action!.payload.amount).toBe(289.9);
    });
  });

  describe('suggestCategory', () => {
    beforeEach(() => {
      parsed = { categoryId: 'c1' };
    });

    it('should not send oneOf in the structured output schema', async () => {
      await service.suggestCategory('mercado', 'expense', categories);
      expect(hasOneOf(calls[0].text.format.schema)).toBe(false);
    });

    it('should use the configured model and reasoning effort', async () => {
      // A sugestão roda no blur do campo: raciocínio aqui é espera visível.
      await service.suggestCategory('mercado', 'expense', categories);
      expect(calls[0].model).toBe(AI_MODELS.suggestCategory.model);
      expect(calls[0].reasoning?.effort).toBe(
        AI_MODELS.suggestCategory.reasoningEffort,
      );
    });
  });
});
