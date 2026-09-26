import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import { duplicateDismissal } from '@/shared/persistence/drizzle/schema';
import {
  DuplicateDismissal,
  DuplicateDismissalRepository,
} from '../duplicate-dismissal.repository';

@Injectable()
export class DuplicateDismissalDrizzleRepository extends DuplicateDismissalRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  async findByVaultId(vaultId: string): Promise<DuplicateDismissal[]> {
    const rows = await this.db
      .select()
      .from(duplicateDismissal)
      .where(eq(duplicateDismissal.vaultId, vaultId));
    return rows.map((row) => ({
      manualTransactionId: row.manualTransactionId,
      importedTransactionId: row.importedTransactionId,
    }));
  }

  async save(vaultId: string, pair: DuplicateDismissal): Promise<void> {
    await this.db
      .insert(duplicateDismissal)
      .values({ vaultId, ...pair, createdAt: new Date() })
      .onConflictDoNothing();
  }
}
