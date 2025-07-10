import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { TelegrafStarter } from './bot/modules/telegram/telegraf-starter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register('sqlite'),
  );
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use((req, res, next) => {
    // Log incoming requests
    console.log(
      `Incoming request: ${req.method} ${req.originalUrl} from ${req.ip}`,
    );
    next();
  });
  expressApp.set('trust proxy', true);
  const telegrafStarter = app.get(TelegrafStarter);
  await telegrafStarter.start(expressApp);
  await app.listen(process.env.PORT ?? 3002);
}
bootstrap().catch((error) => {
  console.error('Error during application bootstrap:', error);
  process.exit(1);
});
