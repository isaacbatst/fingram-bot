import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { MiniappService, MiniappErrorType } from './miniapp.service';
import { VaultService } from '../vault/vault.service';

@Controller('miniapp')
export class MiniappController {
  constructor(
    private readonly miniappService: MiniappService,
    private readonly vaultService: VaultService,
  ) {}

  @Get('summary')
  async getSummary(@Query('initData') initData: string) {
    if (!initData) {
      throw new UnauthorizedException('O parâmetro initData é obrigatório');
    }

    const [error, data] =
      await this.miniappService.getSummaryFromInitData(initData);

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return data;
  }

  @Get('transactions')
  async getTransactions(
    @Query('initData') initData: string,
    @Query('categoryId') categoryId?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('page') page?: string,
  ) {
    if (!initData) {
      throw new UnauthorizedException('O parâmetro initData é obrigatório');
    }

    const pageNumber = page ? parseInt(page, 10) : 1;
    const date =
      year && month
        ? {
            year: parseInt(year, 10),
            month: parseInt(month, 10),
          }
        : undefined;

    const [error, transactions] =
      await this.miniappService.getTransactionsFromInitData(initData, {
        categoryId,
        date,
        page: pageNumber,
      });

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return transactions;
  }

  @Post('edit-transaction')
  async editTransaction(
    @Query('initData') initData: string,
    @Body()
    data: {
      transactionCode: string;
      newAmount?: number;
      newDate?: string; // formato ISO (YYYY-MM-DD)
      newCategory?: string;
      newDescription?: string;
    },
  ) {
    if (!initData) {
      throw new UnauthorizedException('O parâmetro initData é obrigatório');
    }

    if (!data.transactionCode) {
      throw new UnauthorizedException('O código da transação é obrigatório');
    }

    // Converte a data de string para Date se estiver presente
    const parsedData = {
      ...data,
      newDate: data.newDate ? new Date(data.newDate) : undefined,
    };

    const [error, result] =
      await this.miniappService.editTransactionFromInitData(
        initData,
        parsedData,
      );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return result;
  }

  @Get('categories')
  async getCategories() {
    const categories = await this.vaultService.getCategories();
    if (!categories) {
      throw new NotFoundException('Categorias não encontradas');
    }
    return categories;
  }

  @Post('exchange')
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
