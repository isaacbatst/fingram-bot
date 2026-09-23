import type { ReasoningEffort } from 'openai/resources/shared';

export type ModelConfig = {
  model: string;
  /**
   * Só para modelos de raciocínio (família GPT-5+). Omitido nos que não raciocinam.
   *
   * Tarefas de extração e classificação usam `none`: raciocínio ali só soma
   * latência e tokens de saída cobrados, sem ganho de qualidade — e a sugestão de
   * categoria roda no blur do campo, onde a espera aparece para o usuário.
   */
  reasoningEffort?: ReasoningEffort;
};

/**
 * Modelo de cada chamada de IA, num lugar só.
 *
 * Centralizado para que trocar de modelo seja uma edição, e para que a avaliação
 * lado a lado consiga comparar configurações usando os prompts reais do serviço.
 */
export const AI_MODELS = {
  /** Texto livre → transação (comando /ai do bot). */
  parseAction: {
    model: 'gpt-5.4-nano',
    reasoningEffort: 'none',
  } as ModelConfig,
  /** Categorização em lote do upload de CSV (caminho legado do Telegram). */
  batchCategorize: { model: 'gpt-4.1-mini' } as ModelConfig,
  /** Descrição → categoria (formulário e import). */
  suggestCategory: {
    model: 'gpt-5.4-nano',
    reasoningEffort: 'none',
  } as ModelConfig,
};

export type AiModels = typeof AI_MODELS;

/** Parâmetros para a Responses API a partir da configuração. */
export const modelParams = (config: ModelConfig) => ({
  model: config.model,
  ...(config.reasoningEffort
    ? { reasoning: { effort: config.reasoningEffort } }
    : {}),
});
