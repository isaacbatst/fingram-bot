import crypto from 'crypto';

export class Chat {
  static generateId(): string {
    return crypto.randomUUID();
  }

  constructor(
    public id: string,
    public telegramChatId: string,
    public vaultId: string | null = null,
  ) {}

  static create(input: {
    telegramChatId: string;
    vaultId?: string | null;
  }): Chat {
    return new Chat(
      Chat.generateId(),
      input.telegramChatId,
      input.vaultId ?? null,
    );
  }

  assignToVault(vaultId: string): void {
    this.vaultId = vaultId;
  }
}
