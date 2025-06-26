import { Either, left, right } from "./either";
import { Transaction } from "./transaction";

export class Vault {
  entries: {
    transaction: Transaction
  }[] = [];
  transactions: Map<string, Transaction> = new Map();

  addTransaction(transaction: Transaction): void {
    this.transactions.set(transaction.id, transaction);
  }

  commitTransaction(id: string): Either<string, boolean> {
    const transaction = this.transactions.get(id);
    if (!transaction) return left(`Transaction with id ${id} not found`);
    const [err] = transaction.commit();
    if(err !== null){
      return left(err);
    }
    this.entries.push({
      transaction: transaction,
    });
    return right(true);
  }

  editTransaction(id: string, newAmount: number): Either<string, boolean> {
    const transaction = this.transactions.get(id);
    if (!transaction) return left(`Transaction with id ${id} not found`);
    transaction.amount = newAmount;
    // Recalculate the entry in the vault
    const entryIndex = this.entries.findIndex(entry => entry.transaction.id === id);
    if (entryIndex !== -1) {
      this.entries[entryIndex].transaction = transaction;
    }
    return right(true);
  }

  getBalance(): number {
    return this.entries.reduce((total, entry) => total + entry.transaction.amount, 0);
  }
}