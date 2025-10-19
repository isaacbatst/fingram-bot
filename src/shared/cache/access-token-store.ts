export class AccessTokenStore {
  static readonly store: Map<
    string,
    {
      expiresAt: number;
      chatId: string;
      vaultId: string;
    }
  > = new Map();
}
