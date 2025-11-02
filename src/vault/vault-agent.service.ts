import { Injectable } from '@nestjs/common';
import { OpenAiAgentService } from '../shared/ai/open-ai-agent.service';
import { AgentInputItem } from '@openai/agents';
import { left, right } from './domain/either';

@Injectable()
export class VaultAgentService {
  constructor(private readonly agentService: OpenAiAgentService) {}

  async execute(params: {
    messages: AgentInputItem[];
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
}
