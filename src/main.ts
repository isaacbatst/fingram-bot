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
  app.enableCors({
    origin: (requestOrigin, cb) => {
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
