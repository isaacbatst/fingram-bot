import { Vault } from '../domain/vault';

export abstract class VaultRepository {
  abstract create(vault: Vault): Promise<void>;
  abstract update(vault: Vault): Promise<void>;
  abstract findById(id: string): Promise<Vault | null>;
  abstract findByToken(token: string): Promise<Vault | null>;
}
