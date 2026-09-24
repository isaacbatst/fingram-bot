import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { TelegrafStarter } from './bot/modules/telegram/telegraf-starter';
import { TelegramHandler } from './bot/telegram.handler';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({ persistence: 'drizzle' }),
  );
  const logger = new Logger('Bootstrap');
  // O import de extrato envia o arquivo OFX em base64 no corpo JSON, para que os
  // bytes cheguem intactos ao parser. O default de 100kb do Express não comporta
  // um extrato de período longo.
  app.useBodyParser('json', { limit: '5mb' });
  const configService = app.get(ConfigService);
  const appCors = {
    origin: (
      requestOrigin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!requestOrigin) return cb(null, true);
      const allowedOriginsStr =
        configService.get<string>('ALLOWED_ORIGINS') ??
        'http://localhost:5173,http://localhost:5174';
      const allowedOrigins = allowedOriginsStr.split(',');
      const isAllowed = allowedOrigins.includes(requestOrigin);
      if (isAllowed) {
        cb(null, isAllowed);
      } else {
        logger.warn('Request origin not allowed:', requestOrigin);
        cb(new Error('CORS not allowed'));
      }
    },
    credentials: true,
  };
  // MCP clients call the MCP endpoint and the OAuth endpoints from any origin
  // (browser-based clients included). They authenticate with bearer tokens or
  // client credentials, never cookies, so any origin is allowed without
  // credentials. The consent endpoints (/oauth/consent) keep the app policy.
  const mcpPublicPath =
    /^\/(mcp|authorize|token|register|revoke|\.well-known\/oauth-)(\/|\?|$)/;
  app.enableCors((req: { url?: string }, cb) => {
    if (mcpPublicPath.test(req.url ?? '')) {
      return cb(null, { origin: true, credentials: false });
    }
    cb(null, appCors);
  });
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use((req, res, next) => {
    logger.log(`Request: ${req.method} ${req.url}`);
    next();
  });
  expressApp.use(cookieParser());
  const telegramHandler = app.get(TelegramHandler);
  telegramHandler.register();
  const telegrafStarter = app.get(TelegrafStarter);
  await telegrafStarter.start(expressApp);
  await app.listen(process.env.PORT ?? 3002);
}
bootstrap().catch((error) => {
  console.error('Error during application bootstrap:', error);
  process.exit(1);
});
