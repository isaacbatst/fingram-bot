import { Injectable, Logger } from '@nestjs/common';
import { VaultRepository } from './repositories/vault.repository';

@Injectable()
export class VaultAuthService {
  private readonly logger = new Logger(VaultAuthService.name);

  constructor(private readonly vaultRepository: VaultRepository) {}

  async findByToken(token: string) {
    this.logger.log('Finding vault by token');
    const vault = await this.vaultRepository.findByToken(token);
    if (vault) {
      this.logger.log('Vault found for token');
    } else {
      this.logger.warn('No vault found for token');
    }
    return vault;
  }
}
