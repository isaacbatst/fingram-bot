import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { VaultAccessTokenGuard } from './vault-access-token.guard';
import { VaultSession } from './vault-session.decorator';
import { VaultErrorType, VaultWebService } from './vault-web.service';
import { VaultService } from './vault.service';

@Controller('vault')
export class VaultWebController {
  private readonly logger = new Logger(VaultWebController.name);
  constructor(
    private readonly vaultWebService: VaultWebService,
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

    const [error, data] = await this.vaultWebService.getSummary(vaultId, date);

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
    const [error, transactions] = await this.vaultWebService.getTransactions(
      vaultId,
      {
        categoryId,
        description,
        date,
        page: pageNumber,
        pageSize: 6,
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

    const [error, result] = await this.vaultWebService.createTransaction(
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

    const [error, result] = await this.vaultWebService.editTransaction(
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

    const [error, result] = await this.vaultWebService.setBudgets(
      vaultId,
      data.budgets,
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return result as unknown;
  }

  @UseGuards(VaultAccessTokenGuard)
  @Get('categories')
  async getCategories(@VaultSession() vaultId: string) {
    const categories = await this.vaultService.getCategories(vaultId);
    if (!categories) {
      throw new NotFoundException('Categorias não encontradas');
    }
    return categories;
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('vault_access_token');
    return {
      message: 'Logout realizado com sucesso',
    };
  }

  @Post('authenticate')
  async authenticate(
    @Body() data: { accessToken: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!data.accessToken) {
      throw new BadRequestException('Access token é obrigatório');
    }

    const [error, vaultToken] = await this.vaultWebService.authenticate(
      data.accessToken,
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    // Set HTTP-only cookie
    response.cookie('vault_access_token', vaultToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  }

  @Post('authenticate-temp-token')
  async authenticateTempToken(
    @Body() data: { token: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!data.token) {
      throw new BadRequestException('Token é obrigatório');
    }

    const [error, vaultToken] =
      await this.vaultWebService.authenticateTempToken(data.token);

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    // Set HTTP-only cookie with the vault access token
    response.cookie('vault_access_token', vaultToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  }

  @Post('create')
  async createVault(@Res({ passthrough: true }) response: Response) {
    const vault = await this.vaultService.createVault();

    // Set HTTP-only cookie with the vault access token for automatic login
    response.cookie('vault_access_token', vault.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    return {
      vaultId: vault.id,
      message: 'Carteira criada com sucesso! Você foi automaticamente logado.',
    };
  }

  @UseGuards(VaultAccessTokenGuard)
  @Get('me')
  getMe(@VaultSession() vaultId: string) {
    return {
      vaultId,
    };
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('share-link')
  createShareLink(@VaultSession() vaultId: string) {
    const [error, token] = this.vaultWebService.createWebShareLink(vaultId);

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return {
      token,
      message: 'Link de compartilhamento gerado com sucesso!',
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

  @UseGuards(VaultAccessTokenGuard)
  @Post('delete-transaction')
  async deleteTransaction(
    @VaultSession() vaultId: string,
    @Body() data: { transactionCode: string },
  ) {
    const [error, result] = await this.vaultWebService.deleteTransaction(
      vaultId,
      data.transactionCode,
    );
    if (error !== null) {
      this.handleError(error.type, error.message);
    }
  }
}
