import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { BatchItem } from 'drizzle-orm/batch';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DRIZZLE_DATABASE,
  DRIZZLE_IS_NEON,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import {
  vault,
  transaction,
  budget,
  vaultCategory,
  box,
  card,
  cardCycle,
  cardPayment,
} from '@/shared/persistence/drizzle/schema';
import * as schema from '@/shared/persistence/drizzle/schema';
import { Box, BoxType } from '../../domain/box';
import {
  BudgetStartDayOverride,
  BudgetStartDaySchedule,
} from '../../domain/budget-period';
import { CardInvoice, CardPayment } from '../../domain/card-invoice';
import { Card } from '../../domain/card';
import { InvoiceRole } from '../../domain/transaction';
import { Category } from '../../domain/category';
import { Transaction } from '../../domain/transaction';
import { Vault } from '../../domain/vault';
import { VaultRepository } from '../vault.repository';

@Injectable()
export class VaultDrizzleRepository extends VaultRepository {
  private readonly logger = new Logger(VaultDrizzleRepository.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase,
    @Inject(DRIZZLE_IS_NEON) private readonly isNeon: boolean,
  ) {
    super();
  }

  async create(vaultEntity: Vault): Promise<void> {
    await this.db.insert(vault).values({
      id: vaultEntity.id,
      token: vaultEntity.token,
      createdAt: vaultEntity.createdAt,
      budgetStartDay: vaultEntity.budgetStartDay,
      budgetStartDayOverrides: vaultEntity.budgetStartDayOverrides,
    });
  }

  async update(vaultEntity: Vault): Promise<void> {
    const queries: BatchItem<'pg'>[] = [];

    if (vaultEntity.isDirty) {
      queries.push(
        this.db
          .update(vault)
          .set({
            customPrompt: vaultEntity.getCustomPrompt(),
            budgetStartDay: vaultEntity.budgetStartDay,
            budgetStartDayOverrides: vaultEntity.budgetStartDayOverrides,
          })
          .where(eq(vault.id, vaultEntity.id)),
      );
    }

    const boxChanges = vaultEntity.boxesTracker.getChanges();
    // Estratos novos primeiro: cartões e pagamentos apontam para eles.
    for (const b of boxChanges.new) {
      queries.push(
        this.db.insert(box).values({
          id: b.id,
          vaultId: b.vaultId,
          name: b.name,
          goalAmount: b.goalAmount,
          isDefault: b.isDefault,
          type: b.type,
          createdAt: b.createdAt,
        }),
      );
    }

    const cardChanges = vaultEntity.cardsTracker.getChanges();
    const invoiceChanges = vaultEntity.invoicesTracker.getChanges();
    const paymentChanges = vaultEntity.paymentsTracker.getChanges();

    // Cartão → fatura → pagamento → transações: cada um aponta para o anterior.
    for (const c of cardChanges.new) {
      queries.push(this.db.insert(card).values(this.cardRow(c)));
    }
    for (const i of invoiceChanges.new) {
      queries.push(this.db.insert(cardCycle).values(this.invoiceRow(i)));
    }
    for (const p of paymentChanges.new) {
      queries.push(this.db.insert(cardPayment).values(this.paymentRow(p)));
    }
    // Atualizados antes das transações: uma compra pode ter mudado para uma
    // fatura cujo pagamento acabou de mudar, e nada aqui remove linhas.
    for (const c of cardChanges.dirty) {
      queries.push(
        this.db.update(card).set(this.cardRow(c)).where(eq(card.id, c.id)),
      );
    }
    for (const i of invoiceChanges.dirty) {
      queries.push(
        this.db
          .update(cardCycle)
          .set(this.invoiceRow(i))
          .where(eq(cardCycle.id, i.id)),
      );
    }
    for (const p of paymentChanges.dirty) {
      queries.push(
        this.db
          .update(cardPayment)
          .set(this.paymentRow(p))
          .where(eq(cardPayment.id, p.id)),
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
          boxId: t.boxId || null,
          transferId: t.transferId ?? null,
          allocationId: t.allocationId ?? null,
          withdrawalType: t.withdrawalType ?? null,
          invoiceId: t.invoiceId,
          purchaseDate: t.purchaseDate,
          invoiceRole: t.invoiceRole,
          sourceTransactionId: t.sourceTransactionId,
          paymentId: t.paymentId,
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
            boxId: t.boxId || null,
            transferId: t.transferId ?? null,
            allocationId: t.allocationId ?? null,
            withdrawalType: t.withdrawalType ?? null,
            invoiceId: t.invoiceId,
            purchaseDate: t.purchaseDate,
            invoiceRole: t.invoiceRole,
            sourceTransactionId: t.sourceTransactionId,
            paymentId: t.paymentId,
          })
          .where(eq(transaction.id, t.id)),
      );
    }

    // Removidos depois das transações, que deixaram de apontar para eles.
    const deletedPaymentIds = paymentChanges.deleted.map((p) => p.id);
    if (deletedPaymentIds.length > 0) {
      queries.push(
        this.db
          .delete(cardPayment)
          .where(inArray(cardPayment.id, deletedPaymentIds)),
      );
    }
    const deletedInvoiceIds = invoiceChanges.deleted.map((i) => i.id);
    if (deletedInvoiceIds.length > 0) {
      queries.push(
        this.db
          .delete(cardCycle)
          .where(inArray(cardCycle.id, deletedInvoiceIds)),
      );
    }
    const deletedCardIds = cardChanges.deleted.map((c) => c.id);
    if (deletedCardIds.length > 0) {
      queries.push(
        this.db.delete(card).where(inArray(card.id, deletedCardIds)),
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
        this.db
          .delete(budget)
          .where(
            and(
              eq(budget.vaultId, vaultEntity.id),
              eq(budget.categoryId, b.category.id),
            ),
          ),
      );
    }

    // Update dirty budgets
    for (const b of budgetChanges.dirty) {
      queries.push(
        this.db
          .update(budget)
          .set({ amount: b.amount })
          .where(
            and(
              eq(budget.vaultId, vaultEntity.id),
              eq(budget.categoryId, b.category.id),
            ),
          ),
      );
    }

    // Delete removed boxes
    const deletedBoxIds = boxChanges.deleted.map((b) => b.id);
    if (deletedBoxIds.length > 0) {
      queries.push(this.db.delete(box).where(inArray(box.id, deletedBoxIds)));
    }

    // Update dirty boxes
    for (const b of boxChanges.dirty) {
      queries.push(
        this.db
          .update(box)
          .set({
            name: b.name,
            goalAmount: b.goalAmount,
            type: b.type,
          })
          .where(eq(box.id, b.id)),
      );
    }

    // Execute queries
    if (queries.length > 0) {
      if (this.isNeon) {
        const neonDb = this.db as NeonHttpDatabase<typeof schema>;
        const [first, ...rest] = queries;
        await neonDb.batch([first, ...rest]);
      } else {
        const pgDb = this.db as NodePgDatabase<typeof schema>;
        await pgDb.transaction(async (tx) => {
          for (const query of queries) {
            await tx.execute(query as any);
          }
        });
      }
    }

    vaultEntity.clearChanges();
  }

  private cardRow(c: Card) {
    return {
      id: c.id,
      vaultId: c.vaultId,
      name: c.name,
      closingDay: c.closingDay,
      dueDay: c.dueDay,
      boxId: c.boxId,
      accountKey: c.accountKey,
      createdAt: c.createdAt,
    };
  }

  private invoiceRow(i: CardInvoice) {
    return {
      id: i.id,
      vaultId: i.vaultId,
      cardId: i.cardId,
      periodStart: i.periodStart,
      closingDate: i.closingDate,
      dueDate: i.dueDate,
      closed: i.closed,
      createdAt: i.createdAt,
    };
  }

  private paymentRow(p: CardPayment) {
    return {
      id: p.id,
      vaultId: p.vaultId,
      invoiceId: p.invoiceId,
      boxId: p.boxId,
      amount: p.amount,
      date: p.date,
      imported: p.imported,
      importEntryId: p.importEntryId,
      createdAt: p.createdAt,
    };
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
    budgetStartDay: number;
    budgetStartDayOverrides: unknown;
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
          boxId: t.boxId ?? '',
          transferId: t.transferId ?? null,
          isCommitted: t.committed,
          description: t.description ?? undefined,
          createdAt: t.createdAt,
          categoryId: t.categoryId,
          type: t.type as 'expense' | 'income',
          date: t.date ?? t.createdAt,
          allocationId: t.allocationId ?? null,
          withdrawalType: (t.withdrawalType ?? null) as
            | 'withdrawal'
            | 'realization'
            | null,
          invoiceId: t.invoiceId ?? null,
          purchaseDate: t.purchaseDate ?? null,
          invoiceRole: (t.invoiceRole ?? null) as InvoiceRole | null,
          sourceTransactionId: t.sourceTransactionId ?? null,
          paymentId: t.paymentId ?? null,
        }),
      );
    }

    const cards = new Map<string, Card>();
    for (const c of await this.db
      .select()
      .from(card)
      .where(eq(card.vaultId, row.id))) {
      cards.set(c.id, Card.restore(c));
    }
    const invoices = new Map<string, CardInvoice>();
    for (const i of await this.db
      .select()
      .from(cardCycle)
      .where(eq(cardCycle.vaultId, row.id))) {
      invoices.set(i.id, CardInvoice.restore(i));
    }
    const payments = new Map<string, CardPayment>();
    for (const p of await this.db
      .select()
      .from(cardPayment)
      .where(eq(cardPayment.vaultId, row.id))) {
      payments.set(p.id, CardPayment.restore(p));
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

    // Load boxes
    const boxRows = await this.db
      .select()
      .from(box)
      .where(eq(box.vaultId, row.id));

    const boxes = new Map<string, Box>();
    for (const b of boxRows) {
      boxes.set(
        b.id,
        Box.restore({
          id: b.id,
          vaultId: b.vaultId,
          name: b.name,
          goalAmount: b.goalAmount,
          isDefault: b.isDefault,
          type: b.type as BoxType,
          createdAt: b.createdAt,
        }),
      );
    }

    const overrides: BudgetStartDayOverride[] = Array.isArray(
      row.budgetStartDayOverrides,
    )
      ? (row.budgetStartDayOverrides as BudgetStartDayOverride[])
      : [];
    const schedule: BudgetStartDaySchedule = {
      defaultDay: row.budgetStartDay,
      overrides,
    };

    const vaultEntity = new Vault(
      row.id,
      row.token,
      row.createdAt,
      transactions,
      budgets,
      boxes,
      row.customPrompt ?? '',
      schedule,
      invoices,
      cards,
      payments,
    );
    vaultEntity.clearChanges();

    return vaultEntity;
  }
}
