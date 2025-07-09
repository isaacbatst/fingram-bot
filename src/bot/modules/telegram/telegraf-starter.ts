import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Express } from 'express';
import { Telegraf } from 'telegraf';

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
      await this.telegraf.launch();
      return;
    }

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
      // Log incoming requests to the webhook
      this.logger.log(
        `Incoming request: ${req.method} ${req.originalUrl} from ${req.ip}`,
      );
      next();
    });

    server.use('/webhooks/telegram', (req, res, next) => {
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
