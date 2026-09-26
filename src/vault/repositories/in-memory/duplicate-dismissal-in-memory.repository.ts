/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import {
  DuplicateDismissal,
  DuplicateDismissalRepository,
} from '../duplicate-dismissal.repository';

/**
 * Sem FK aqui: um par cujo lançamento foi apagado fica guardado, mas não volta
 * a aparecer porque o par não é mais sugerido.
 */
@Injectable()
export class DuplicateDismissalInMemoryRepository extends DuplicateDismissalRepository {
  private readonly byVault = new Map<string, DuplicateDismissal[]>();

  async findByVaultId(vaultId: string): Promise<DuplicateDismissal[]> {
    return [...(this.byVault.get(vaultId) ?? [])];
  }

  async save(vaultId: string, pair: DuplicateDismissal): Promise<void> {
    const pairs = this.byVault.get(vaultId) ?? [];
    const exists = pairs.some(
      (p) =>
        p.manualTransactionId === pair.manualTransactionId &&
        p.importedTransactionId === pair.importedTransactionId,
    );
    if (!exists) this.byVault.set(vaultId, [...pairs, { ...pair }]);
  }
}
