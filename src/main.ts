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
    AppModule.register('sqlite'),
  );
  const configService = app.get(ConfigService);

  app.enableCors({
    origin: (requestOrigin, cb) => {
      const allowedOriginsStr =
        configService.get<string>('ALLOWED_ORIGINS') ?? 'http://localhost:5173';
      const allowedOrigins = allowedOriginsStr.split(',');
      const isAllowed = allowedOrigins.includes(requestOrigin);
      if (isAllowed) {
        cb(null, isAllowed);
      } else {
        cb(new Error('CORS not allowed'));
      }
    },
    credentials: true,
  });
  const expressApp = app.getHttpAdapter().getInstance();
  const logger = new Logger('Bootstrap');
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
