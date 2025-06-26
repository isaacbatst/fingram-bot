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
    const code = crypto.randomBytes(2).toString('hex');
    return new Transaction(id, code, amount, false, description);
  }

  constructor(
    readonly id: string,
    readonly code: string,
    public amount: number,
    public isCommitted: boolean = false,
    public description?: string,
    public createdAt: Date = new Date(),
  ) {}

  commit(): Either<string, boolean> {
    if (this.isCommitted) {
      return left(`Transação #${this.code} já efetivada`);
    }
    this.isCommitted = true;
    return right(true);
  }
}
