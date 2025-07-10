import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Express } from 'express';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';

@Injectable()
export class TelegrafStarter {
  private readonly logger = new Logger(TelegrafStarter.name);

  constructor(
    private configService: ConfigService,
    private telegraf: Telegraf,
  ) {}

  async start(server: Express) {
    this.logger.log('Starting Telegram bot...');
    if (this.configService.get('NODE_ENV') !== 'production') {
      this.logger.log(
        'Running in development mode, bare launching Telegraf...',
      );

      this.telegraf.on(message('text'), (ctx, next) => {
        this.logger.log(
          `Received message: ${ctx.message.text} from ${ctx.from.username}`,
        );
        return next();
      });

      await this.telegraf.launch(() => {
        this.logger.log(
          'Telegraf bot launched successfully in development mode',
        );
      });
      return;
    }

    this.logger.log('Running in production mode, setting up webhook...');
    server.set('trust proxy', true);
    await this.setupWebhook(server);
  }

  private async setupWebhook(server: Express) {
    const domain = this.configService.getOrThrow<string>(
      'TELEGRAM_WEBHOOK_DOMAIN',
    );
    const secretToken = this.configService.getOrThrow<string>(
      'TELEGRAM_WEBHOOK_SECRET_TOKEN',
    );

    this.logger.log(
      `Setting up webhook for Telegram bot at ${domain}/webhooks/telegram`,
    );

    server.use('/webhooks/telegram', (req, res, next) => {
      this.logger.log(
        `Received request for Telegram webhook: ${req.method} ${req.originalUrl}`,
      );
      if (req.headers['x-telegram-bot-api-secret-token'] !== secretToken) {
        this.logger.warn(
          `Invalid token for request: ${req.method} ${req.originalUrl}`,
        );
        res.status(403).send('Forbidden');
        return;
      }
      next();
    });

    server.use(
      await this.telegraf.createWebhook({
        domain,
        path: '/webhooks/telegram',
        secret_token: secretToken,
      }),
    );
  }
}
