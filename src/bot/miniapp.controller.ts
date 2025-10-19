import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { VaultService } from '../vault/vault.service';
import { MiniappSessionTokenPayload } from './miniapp-session-token';
import { MiniappSessionTokenGuard } from './miniapp-session-token.guard';
import { MiniappSession } from './miniapp-session.decorator';
import { MiniappErrorType, MiniappService } from './miniapp.service';

@Controller('miniapp')
export class MiniappController {
  constructor(
    private readonly miniappService: MiniappService,
    private readonly vaultService: VaultService,
  ) {}

  @UseGuards(MiniappSessionTokenGuard)
  @Get('summary')
  async getSummary(
    @MiniappSession() session: MiniappSessionTokenPayload,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const date =
      year && month
        ? {
            year: parseInt(year, 10),
            month: parseInt(month, 10),
          }
        : undefined;

    const [error, data] = await this.miniappService.getSummary(
      session.vaultId,
      date,
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return data;
  }

  @UseGuards(MiniappSessionTokenGuard)
  @Get('transactions')
  async getTransactions(
    @MiniappSession() session: MiniappSessionTokenPayload,
    @Query('categoryId') categoryId?: string,
    @Query('description') description?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('page') page?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const date =
      year && month
        ? {
            year: parseInt(year, 10),
            month: parseInt(month, 10),
          }
        : undefined;

    const [error, transactions] = await this.miniappService.getTransactions(
      session.vaultId,
      {
        categoryId,
        description,
        date,
        page: pageNumber,
      },
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return transactions;
  }

  @UseGuards(MiniappSessionTokenGuard)
  @Post('create-transaction')
  async createTransaction(
    @MiniappSession() session: MiniappSessionTokenPayload,
    @Body()
    data: {
      amount: number;
      description?: string;
      categoryId?: string;
      date?: string; // formato ISO (YYYY-MM-DD)
      type: 'income' | 'expense';
    },
  ) {
    if (!data.amount || data.amount <= 0) {
      throw new BadRequestException(
        'O valor da transação é obrigatório e deve ser positivo',
      );
    }

    if (!data.type || !['income', 'expense'].includes(data.type)) {
      throw new BadRequestException(
        'Tipo de transação é obrigatório. Use "income" ou "expense"',
      );
    }

    // Converte a data de string para Date se estiver presente
    const parsedData = {
      ...data,
      date: data.date ? new Date(data.date) : new Date(),
    };

    const [error, result] = await this.miniappService.createTransaction(
      session.vaultId,
      parsedData,
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return result;
  }

  @UseGuards(MiniappSessionTokenGuard)
  @Post('edit-transaction')
  async editTransaction(
    @MiniappSession() session: MiniappSessionTokenPayload,
    @Body()
    data: {
      transactionCode: string;
      newAmount?: number;
      newDate?: string; // formato ISO (YYYY-MM-DD)
      newCategory?: string;
      newDescription?: string;
      newType?: 'income' | 'expense';
    },
  ) {
    if (!data.transactionCode) {
      throw new BadRequestException('O código da transação é obrigatório');
    }

    if (data.newType && !['income', 'expense'].includes(data.newType)) {
      throw new BadRequestException(
        'Tipo de transação inválido. Use "income" ou "expense"',
      );
    }

    // Converte a data de string para Date se estiver presente
    const parsedData = {
      ...data,
      newDate: data.newDate ? new Date(data.newDate) : undefined,
    };

    const [error, result] = await this.miniappService.editTransaction(
      session.vaultId,
      parsedData,
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return result;
  }

  @UseGuards(MiniappSessionTokenGuard)
  @Post('set-budgets')
  async setBudgets(
    @MiniappSession() session: MiniappSessionTokenPayload,
    @Body()
    data: {
      budgets: { categoryCode: string; amount: number }[];
    },
  ) {
    if (!data.budgets || !Array.isArray(data.budgets)) {
      throw new BadRequestException('Lista de orçamentos é obrigatória');
    }

    // Validar estrutura dos budgets
    for (const budget of data.budgets) {
      if (!budget.categoryCode || typeof budget.amount !== 'number') {
        throw new BadRequestException(
          'Cada orçamento deve ter categoryCode (string) e amount (number)',
        );
      }
      if (budget.amount < 0) {
        throw new BadRequestException('O valor do orçamento deve ser positivo');
      }
    }

    const [error, result] = await this.miniappService.setBudgets(
      session.vaultId,
      data.budgets,
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return result as unknown;
  }

  @Get('categories')
  async getCategories() {
    const categories = await this.vaultService.getCategories();
    if (!categories) {
      throw new NotFoundException('Categorias não encontradas');
    }
    return categories;
  }

  @Get('exchange')
  async exchangeInitDataForAuthToken(@Query('initData') initData: string) {
    if (!initData) {
      throw new UnauthorizedException('O parâmetro initData é obrigatório');
    }

    const [err, token] =
      await this.miniappService.exchangeInitDataForAuthToken(initData);
    if (err !== null) {
      this.handleError(err.type, err.message);
    }

    return { token };
  }

  @UseGuards(MiniappSessionTokenGuard)
  @Get('me')
  getMe(@MiniappSession() session: MiniappSessionTokenPayload) {
    const payload: MiniappSessionTokenPayload = {
      chatId: session.chatId,
      vaultId: session.vaultId,
    };

    return {
      chatId: payload.chatId,
      vaultId: payload.vaultId,
    };
  }

  private handleError(error: MiniappErrorType, message: string): never {
    switch (error) {
      case MiniappErrorType.UNAUTHORIZED:
        throw new UnauthorizedException(message);
      case MiniappErrorType.CHAT_NOT_FOUND:
      case MiniappErrorType.VAULT_NOT_FOUND:
        throw new NotFoundException(message);
      case MiniappErrorType.INTERNAL_ERROR:
      default:
        throw new InternalServerErrorException(message);
    }
  }
}
