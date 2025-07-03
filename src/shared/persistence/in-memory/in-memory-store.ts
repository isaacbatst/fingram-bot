import { Action } from '@/vault/domain/action';
import { Category } from '@/vault/domain/category';
import { Chat } from '@/bot/modules/chat/domain/chat';
import { Vault } from '@/vault/domain/vault';
import { CATEGORIES_SEED } from '../seed';

export class InMemoryStore {
  actions: Map<string, Action> = new Map();
  vaults: Map<string, Vault> = new Map();
  chats: Map<string, Chat> = new Map();
  categories: Map<string, Category> = new Map(
    CATEGORIES_SEED.map(
      (c) =>
        new Category(c.id, c.name, c.code, c.description, c.transaction_type),
    ).map((category) => [category.id, category]),
  );
}
