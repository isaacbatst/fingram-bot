import { TransactionDTO } from '../dto/transaction.dto,';

type Params = {
  vaultId: string;
  transaction: TransactionDTO;
  platform: 'web' | 'telegram-bot';
};

export class TransactionCreatedEvent {
  static readonly eventName = 'transaction.created';

  public readonly vaultId: string;
  public readonly transaction: TransactionDTO;
  public readonly platform: 'web' | 'telegram-bot';
  constructor(params: Params) {
    this.vaultId = params.vaultId;
    this.transaction = params.transaction;
    this.platform = params.platform;
  }
}
