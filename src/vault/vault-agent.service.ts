import { Injectable } from '@nestjs/common';
import { OpenAiAgentService } from '../shared/ai/open-ai-agent.service';
import { left, right } from './domain/either';

@Injectable()
export class VaultAgentService {
  constructor(private readonly agentService: OpenAiAgentService) {}

  async execute(params: {
    message?: string;
    decisions: Record<string, 'approved' | 'rejected'>;
    conversationId: string;
    vaultId: string;
  }) {
    const [err, result] = await this.agentService.execute(params);
    if (err) {
      return left(err);
    }
    return right(result);
  }

  async executeStream(
    params: {
      message?: string;
      decisions: Record<string, 'approved' | 'rejected'>;
      conversationId: string;
      vaultId: string;
    },
    emit: (event: string, data: unknown) => void,
  ) {
    await this.agentService.executeStream(params, emit);
  }
}
