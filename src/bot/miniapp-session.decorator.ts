import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { MiniappSessionTokenPayload } from './miniapp-session-token';

export const MiniappSession = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): MiniappSessionTokenPayload => {
    const request: Request = ctx.switchToHttp().getRequest();
    return request['miniapp_session'] as MiniappSessionTokenPayload;
  },
);
