import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { TelegrafStarter } from './bot/modules/telegram/telegraf-starter';
import { TelegramHandler } from './bot/telegram.handler';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register('sqlite'),
  );
  app.enableCors();
  const expressApp = app.getHttpAdapter().getInstance();
  const logger = new Logger('Bootstrap');
  expressApp.use((req, res, next) => {
    logger.debug(`Request: ${req.method} ${req.url}`);
    next();
  });
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
