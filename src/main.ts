import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { TelegrafStarter } from './bot/modules/telegram/telegraf-starter';
import { TelegramHandler } from './bot/telegram.handler';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register('in-memory'),
  );
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use((req, res, next) => {
    console.log(
      `Incoming request: ${req.method} ${req.originalUrl} from ${req.ip}`,
    );
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
