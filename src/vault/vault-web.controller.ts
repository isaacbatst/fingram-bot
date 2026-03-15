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
    @Query('boxId') boxId?: string,
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
        boxId,
        date,
        page: pageNumber,
        pageSize: 15,
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
      boxId?: string;
      date?: string; // formato ISO (YYYY-MM-DD)
      type: 'income' | 'expense';
      allocationId?: string;
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
      allocationId: data.allocationId,
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
      newBoxId?: string;
      newAllocationId?: string | null;
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
      newAllocationId: data.newAllocationId,
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
      message: 'Duna criado com sucesso! Você foi automaticamente conectado.',
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
      case VaultErrorType.BAD_REQUEST:
        throw new BadRequestException(message);
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
    const [error] = await this.vaultWebService.deleteTransaction(
      vaultId,
      data.transactionCode,
    );
    if (error !== null) {
      this.handleError(error.type, error.message);
    }
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('budget-start-day')
  async setBudgetStartDay(
    @VaultSession() vaultId: string,
    @Body() data: { day: number },
  ) {
    if (typeof data.day !== 'number' || data.day < 1 || data.day > 28) {
      throw new BadRequestException(
        'O dia de início do orçamento deve ser um número entre 1 e 28',
      );
    }

    const [error, result] = await this.vaultWebService.setBudgetStartDay(
      vaultId,
      data.day,
    );

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return { budgetStartDay: result };
  }

  @UseGuards(VaultAccessTokenGuard)
  @Get('budget-start-day')
  async getBudgetStartDay(@VaultSession() vaultId: string) {
    const [error, result] =
      await this.vaultWebService.getBudgetStartDay(vaultId);

    if (error !== null) {
      this.handleError(error.type, error.message);
    }

    return { budgetStartDay: result };
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('suggest-category')
  async suggestCategory(
    @VaultSession() vaultId: string,
    @Body()
    data: { description: string; transactionType: 'income' | 'expense' },
  ) {
    if (!data.description || !data.description.trim()) {
      throw new BadRequestException('A descrição é obrigatória');
    }

    if (
      !data.transactionType ||
      !['income', 'expense'].includes(data.transactionType)
    ) {
      throw new BadRequestException(
        'Tipo de transação é obrigatório. Use "income" ou "expense"',
      );
    }

    const [error, categoryId] = await this.vaultService.suggestCategory({
      vaultId,
      description: data.description.trim(),
      transactionType: data.transactionType,
    });

    if (error !== null) {
      this.handleError(VaultErrorType.INTERNAL_ERROR, error);
    }

    return { categoryId };
  }

  @UseGuards(VaultAccessTokenGuard)
  @Get('budget-ceiling')
  async getBudgetCeiling(@VaultSession() vaultId: string) {
    const [error, result] = await this.vaultWebService.getBudgetCeiling(vaultId);
    if (error) {
      return { ceiling: null, allocated: 0, buffer: null, overBudget: false };
    }
    return result;
  }

  @UseGuards(VaultAccessTokenGuard)
  @Get('boxes')
  async getBoxes(@VaultSession() vaultId: string) {
    const [error, boxes] = await this.vaultWebService.getBoxes(vaultId);
    if (error !== null) this.handleError(error.type, error.message);
    return boxes;
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('create-box')
  async createBox(
    @VaultSession() vaultId: string,
    @Body()
    data: { name: string; goalAmount?: number; type?: 'spending' | 'saving' },
  ) {
    if (!data.name?.trim()) {
      throw new BadRequestException('Nome do estrato é obrigatório');
    }
    if (data.type && data.type !== 'spending' && data.type !== 'saving') {
      throw new BadRequestException(
        'Tipo do estrato deve ser "spending" ou "saving"',
      );
    }
    const [error, box] = await this.vaultWebService.createBox(vaultId, {
      name: data.name.trim(),
      goalAmount: data.goalAmount,
      type: data.type,
    });
    if (error !== null) this.handleError(error.type, error.message);
    return box;
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('edit-box')
  async editBox(
    @VaultSession() vaultId: string,
    @Body()
    data: {
      boxId: string;
      name?: string;
      goalAmount?: number | null;
      type?: 'spending' | 'saving';
    },
  ) {
    if (!data.boxId) {
      throw new BadRequestException('ID do estrato é obrigatório');
    }
    if (data.type && data.type !== 'spending' && data.type !== 'saving') {
      throw new BadRequestException(
        'Tipo do estrato deve ser "spending" ou "saving"',
      );
    }
    const [error, box] = await this.vaultWebService.editBox(vaultId, data);
    if (error !== null) this.handleError(error.type, error.message);
    return box;
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('delete-box')
  async deleteBox(
    @VaultSession() vaultId: string,
    @Body() data: { boxId: string },
  ) {
    if (!data.boxId) {
      throw new BadRequestException('ID do estrato é obrigatório');
    }
    const [error] = await this.vaultWebService.deleteBox(vaultId, data.boxId);
    if (error !== null) this.handleError(error.type, error.message);
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('create-transfer')
  async createTransfer(
    @VaultSession() vaultId: string,
    @Body()
    data: {
      fromBoxId: string;
      toBoxId: string;
      amount: number;
      date?: string;
    },
  ) {
    if (!data.fromBoxId || !data.toBoxId) {
      throw new BadRequestException(
        'Estratos de origem e destino são obrigatórios',
      );
    }
    if (!data.amount || data.amount <= 0) {
      throw new BadRequestException('Valor da transferência deve ser positivo');
    }

    const [error, transferId] = await this.vaultWebService.createTransfer(
      vaultId,
      {
        fromBoxId: data.fromBoxId,
        toBoxId: data.toBoxId,
        amount: data.amount,
        date: data.date ? new Date(data.date) : new Date(),
      },
    );
    if (error !== null) this.handleError(error.type, error.message);
    return { transferId };
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('edit-transfer')
  async editTransfer(
    @VaultSession() vaultId: string,
    @Body()
    data: {
      transferId: string;
      amount?: number;
      date?: string;
      fromBoxId?: string;
      toBoxId?: string;
    },
  ) {
    if (!data.transferId) {
      throw new BadRequestException('ID da transferência é obrigatório');
    }
    if (data.amount !== undefined && data.amount <= 0) {
      throw new BadRequestException('Valor da transferência deve ser positivo');
    }
    const [error] = await this.vaultWebService.editTransfer(vaultId, {
      transferId: data.transferId,
      amount: data.amount,
      date: data.date ? new Date(data.date) : undefined,
      fromBoxId: data.fromBoxId,
      toBoxId: data.toBoxId,
    });
    if (error !== null) this.handleError(error.type, error.message);
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('delete-transfer')
  async deleteTransfer(
    @VaultSession() vaultId: string,
    @Body() data: { transferId: string },
  ) {
    if (!data.transferId) {
      throw new BadRequestException('ID da transferência é obrigatório');
    }
    const [error] = await this.vaultWebService.deleteTransfer(
      vaultId,
      data.transferId,
    );
    if (error !== null) this.handleError(error.type, error.message);
  }
}
