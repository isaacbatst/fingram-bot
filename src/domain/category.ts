export class Category {
  constructor(
    readonly id: string,
    public name: string,
    readonly code: string,
    public description: string = '',
    public transactionType: 'income' | 'expense' = 'expense',
  ) {}
}
