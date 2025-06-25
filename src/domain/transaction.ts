import { Either, left, right } from "./either";

export class Transaction {
  constructor(
    readonly id: string,
    public amount: number,
    public isCommitted: boolean = false,
  ) {}

  commit(): Either<string, boolean> {
    if (this.isCommitted) {
      return left(`Transaction with id ${this.id} is already committed`);
    }
    this.isCommitted = true;
    return right(true);
  }
}