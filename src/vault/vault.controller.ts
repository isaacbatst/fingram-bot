import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultAccessTokenGuard } from './vault-access-token.guard';
import { VaultSession } from './vault-session.decorator';
import { VaultErrorType, VaultAuthService } from './vault-auth.service';
import { Response } from 'express';

@Controller('vault')
export class VaultController {
  constructor(
    private readonly vaultAuthService: VaultAuthService,
    private readonly vaultService: VaultService,
  ) {}

  @UseGuards(VaultAccessTokenGuard)
  @Get('summary')
  async getSummary(
    @VaultSession() vaultId: string,
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

    const [error, data] = await this.vaultAuthService.getSummary(vaultId, date);

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return data;
  }

  @UseGuards(VaultAccessTokenGuard)
  @Get('transactions')
  async getTransactions(
    @VaultSession() vaultId: string,
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

    const [error, transactions] = await this.vaultAuthService.getTransactions(
      vaultId,
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

  @UseGuards(VaultAccessTokenGuard)
  @Post('create-transaction')
  async createTransaction(
    @VaultSession() vaultId: string,
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

    const [error, result] = await this.vaultAuthService.createTransaction(
      vaultId,
      parsedData,
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return result;
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('edit-transaction')
  async editTransaction(
    @VaultSession() vaultId: string,
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

    const [error, result] = await this.vaultAuthService.editTransaction(
      vaultId,
      parsedData,
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return result;
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('set-budgets')
  async setBudgets(
    @VaultSession() vaultId: string,
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

    const [error, result] = await this.vaultAuthService.setBudgets(
      vaultId,
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

  @Post('authenticate')
  async authenticate(
    @Body() data: { accessToken: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!data.accessToken) {
      throw new BadRequestException('Access token é obrigatório');
    }

    const [error, vaultId] = await this.vaultAuthService.authenticate(
      data.accessToken,
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    // Set HTTP-only cookie
    response.cookie('vault_access_token', data.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    return { vaultId };
  }

  @Post('authenticate-temp-token')
  async authenticateTempToken(
    @Body() data: { token: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!data.token) {
      throw new BadRequestException('Token é obrigatório');
    }

    const [error, vaultId] = await this.vaultAuthService.authenticateTempToken(
      data.token,
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    // Set HTTP-only cookie with the vault access token
    response.cookie('vault_access_token', data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    return { vaultId };
  }

  @UseGuards(VaultAccessTokenGuard)
  @Get('me')
  getMe(@VaultSession() vaultId: string) {
    return {
      vaultId,
    };
  }

  private handleError(error: VaultErrorType, message: string): never {
    switch (error) {
      case VaultErrorType.UNAUTHORIZED:
        throw new UnauthorizedException(message);
      case VaultErrorType.VAULT_NOT_FOUND:
        throw new NotFoundException(message);
      case VaultErrorType.INTERNAL_ERROR:
      default:
        throw new InternalServerErrorException(message);
    }
  }
}
