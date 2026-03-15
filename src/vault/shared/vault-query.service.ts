import { Injectable } from '@nestjs/common';
import { BoxRepository } from '@/vault/repositories/box.repository';
import { BoxInfo } from './domain/box-info';

@Injectable()
export class VaultQueryService {
  constructor(private readonly boxRepo: BoxRepository) {}

  async findBoxById(boxId: string): Promise<BoxInfo | null> {
    const box = await this.boxRepo.findById(boxId);
    if (!box) return null;
    return {
      id: box.id,
      name: box.name,
      type: box.type,
      balance: 0, // balance computation deferred to later slice
      goalAmount: box.goalAmount,
      vaultId: box.vaultId,
    };
  }

  async listSavingBoxes(vaultId: string): Promise<BoxInfo[]> {
    const boxes = await this.boxRepo.findByVaultId(vaultId);
    return boxes
      .filter((b) => b.type === 'saving')
      .map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type,
        balance: 0,
        goalAmount: b.goalAmount,
        vaultId: b.vaultId,
      }));
  }
}
