import { Box } from '../domain/box';

export abstract class BoxRepository {
  abstract findByVaultId(vaultId: string): Promise<Box[]>;
  abstract findById(id: string): Promise<Box | null>;
  abstract create(box: Box): Promise<void>;
  abstract update(box: Box): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract findDefaultByVaultId(vaultId: string): Promise<Box | null>;
}
