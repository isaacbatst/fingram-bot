// app controller with health check endpoint
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  healthCheck(): string {
    return 'OK';
  }
}
