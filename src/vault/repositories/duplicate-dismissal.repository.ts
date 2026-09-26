export type DuplicateDismissal = {
  manualTransactionId: string;
  importedTransactionId: string;
};

/**
 * Pares que o usuário disse não serem duplicata. Apagar qualquer um dos dois
 * lançamentos apaga a dispensa (FK em cascata no Postgres).
 */
export abstract class DuplicateDismissalRepository {
  abstract findByVaultId(vaultId: string): Promise<DuplicateDismissal[]>;
  /** Idempotente: dispensar de novo o mesmo par não faz nada. */
  abstract save(vaultId: string, pair: DuplicateDismissal): Promise<void>;
}
