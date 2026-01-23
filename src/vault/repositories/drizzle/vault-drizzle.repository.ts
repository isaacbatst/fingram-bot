import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { BatchItem } from 'drizzle-orm/batch';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import {
  vault,
  transaction,
  budget,
  vaultCategory,
} from '@/shared/persistence/drizzle/schema';
import { Category } from '../../domain/category';
import { Transaction } from '../../domain/transaction';
import { Vault } from '../../domain/vault';
import { VaultRepository } from '../vault.repository';

@Injectable()
export class VaultDrizzleRepository extends VaultRepository {
  private readonly logger = new Logger(VaultDrizzleRepository.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  async create(vaultEntity: Vault): Promise<void> {
    await this.db.insert(vault).values({
      id: vaultEntity.id,
      token: vaultEntity.token,
      createdAt: vaultEntity.createdAt,
    });
  }

  async update(vaultEntity: Vault): Promise<void> {
    const queries: BatchItem<'pg'>[] = [];

    if (vaultEntity.isDirty) {
      queries.push(
        this.db
          .update(vault)
          .set({ customPrompt: vaultEntity.getCustomPrompt() })
          .where(eq(vault.id, vaultEntity.id)),
      );
    }

    const transactionsChanges = vaultEntity.transactionsTracker.getChanges();

    // Insert new transactions
    for (const t of transactionsChanges.new) {
      queries.push(
        this.db.insert(transaction).values({
          id: t.id,
          code: t.code,
          amount: t.amount,
          type: t.type,
          categoryId: t.categoryId ?? null,
          vaultId: t.vaultId,
          description: t.description ?? '',
          createdAt: t.createdAt,
          committed: t.isCommitted,
          date: t.date,
        }),
      );
    }

    // Delete removed transactions
    const deletedTransactionIds = transactionsChanges.deleted.map((t) => t.id);
    if (deletedTransactionIds.length > 0) {
      queries.push(
        this.db
          .delete(transaction)
          .where(inArray(transaction.id, deletedTransactionIds)),
      );
    }

    // Update dirty transactions
    for (const t of transactionsChanges.dirty) {
      queries.push(
        this.db
          .update(transaction)
          .set({
            amount: t.amount,
            categoryId: t.categoryId,
            createdAt: t.createdAt,
            description: t.description,
            type: t.type,
            date: t.date,
            committed: t.isCommitted,
          })
          .where(eq(transaction.id, t.id)),
      );
    }

    const budgetChanges = vaultEntity.budgetsTracker.getChanges();

    // Insert new budgets
    for (const b of budgetChanges.new) {
      queries.push(
        this.db.insert(budget).values({
          vaultId: vaultEntity.id,
          categoryId: b.category.id,
          amount: b.amount,
        }),
      );
    }

    // Delete removed budgets
    for (const b of budgetChanges.deleted) {
      queries.push(
        this.db.delete(budget).where(eq(budget.categoryId, b.category.id)),
      );
    }

    // Update dirty budgets
    for (const b of budgetChanges.dirty) {
      queries.push(
        this.db
          .update(budget)
          .set({ amount: b.amount })
          .where(eq(budget.categoryId, b.category.id)),
      );
    }

    // Execute all queries in a batch
    console.log('queries', queries);
    if (queries.length > 0) {
      const [first, ...rest] = queries;
      await this.db.batch([first, ...rest]);
    }

    vaultEntity.clearChanges();
  }

  async findById(id: string): Promise<Vault | null> {
    const rows = await this.db.select().from(vault).where(eq(vault.id, id));
    if (rows.length === 0) return null;
    const row = rows[0];

    return this.loadVaultWithRelations(row);
  }

  async findByToken(token: string): Promise<Vault | null> {
    const rows = await this.db
      .select()
      .from(vault)
      .where(eq(vault.token, token));
    if (rows.length === 0) return null;
    const row = rows[0];

    return this.loadVaultWithRelations(row);
  }

  private async loadVaultWithRelations(row: {
    id: string;
    token: string;
    customPrompt: string | null;
    createdAt: Date;
  }): Promise<Vault> {
    // Load transactions
    const transactionRows = await this.db
      .select()
      .from(transaction)
      .where(eq(transaction.vaultId, row.id));

    const transactions = new Map<string, Transaction>();
    for (const t of transactionRows) {
      transactions.set(
        t.id,
        Transaction.restore({
          id: t.id,
          code: t.code,
          amount: t.amount,
          vaultId: t.vaultId,
          isCommitted: t.committed,
          description: t.description ?? undefined,
          createdAt: t.createdAt,
          categoryId: t.categoryId,
          type: t.type as 'expense' | 'income',
          date: t.date ?? t.createdAt,
        }),
      );
    }

    // Load budgets with vault categories
    const budgetRows = await this.db
      .select()
      .from(budget)
      .where(eq(budget.vaultId, row.id));

    const budgets = new Map<string, { category: Category; amount: number }>();
    for (const b of budgetRows) {
      const catRows = await this.db
        .select()
        .from(vaultCategory)
        .where(eq(vaultCategory.id, b.categoryId));

      if (catRows.length > 0) {
        const catRow = catRows[0];
        const cat = new Category(
          catRow.id,
          catRow.name,
          catRow.code,
          catRow.description ?? '',
          catRow.transactionType as 'income' | 'expense' | 'both',
        );
        budgets.set(cat.id, { category: cat, amount: b.amount });
      }
    }

    const vaultEntity = new Vault(
      row.id,
      row.token,
      row.createdAt,
      transactions,
      budgets,
      row.customPrompt ?? '',
    );
    vaultEntity.transactionsTracker.clearChanges();
    vaultEntity.budgetsTracker.clearChanges();

    return vaultEntity;
  }
}
