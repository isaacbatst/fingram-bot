import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const VaultSession = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request['vault_id'] as string;
  },
);
