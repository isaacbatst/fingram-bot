import crypto from 'crypto';
import { Either, left, right } from './either';

export class Transaction {
  static create({
    amount,
    description,
  }: {
    amount: number;
    description?: string;
  }): Transaction {
    const id = crypto.randomUUID();
    return new Transaction(id, amount, false, description);
  }

  constructor(
    readonly id: string,
    public amount: number,
    public isCommitted: boolean = false,
    public description?: string,
  ) {}

  commit(): Either<string, boolean> {
    if (this.isCommitted) {
      return left(`Transaction with id ${this.id} is already committed`);
    }
    this.isCommitted = true;
    return right(true);
  }
}
