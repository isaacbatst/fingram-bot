import { Injectable } from '@nestjs/common';
import { BoxRepository } from '../box.repository';
import { Box } from '@/vault/domain/box';

@Injectable()
export class BoxInMemoryRepository extends BoxRepository {
  private boxes = new Map<string, Box>();

  async findByVaultId(vaultId: string): Promise<Box[]> {
    return [...this.boxes.values()].filter((b) => b.vaultId === vaultId);
  }

  async findById(id: string): Promise<Box | null> {
    return this.boxes.get(id) ?? null;
  }

  async create(box: Box): Promise<void> {
    this.boxes.set(box.id, box);
  }

  async update(box: Box): Promise<void> {
    this.boxes.set(box.id, box);
  }

  async delete(id: string): Promise<void> {
    this.boxes.delete(id);
  }

  async findDefaultByVaultId(vaultId: string): Promise<Box | null> {
    return (
      [...this.boxes.values()].find(
        (b) => b.vaultId === vaultId && b.isDefault,
      ) ?? null
    );
  }
}
