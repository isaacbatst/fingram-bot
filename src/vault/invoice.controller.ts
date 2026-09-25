import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { VaultAccessTokenGuard } from './vault-access-token.guard';
import { VaultSession } from './vault-session.decorator';
import { CardInvoiceService } from './card-invoice.service';

/** "Não encontrado" vira 404; o resto das recusas de regra, 400. */
function fail(error: string): never {
  if (/não encontrad/i.test(error)) throw new NotFoundException(error);
  throw new BadRequestException(error);
}

/**
 * Lê uma data YYYY-MM-DD como meia-noite UTC (a convenção das datas gravadas).
 * `undefined` passa adiante; formato inválido é 400.
 */
function parseDay(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const match =
    typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) {
    throw new BadRequestException(`${field} deve estar no formato AAAA-MM-DD`);
  }
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} inválida`);
  }
  return date;
}

function parseAmount(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !(value > 0)) {
    throw new BadRequestException('amount deve ser um número positivo');
  }
  return value;
}

type CardBody = {
  name?: string;
  closingDay?: number;
  dueDay?: number;
  boxId?: string;
  accountKey?: string | null;
};

/** Cartões de crédito e saldo disponível (saldo − a pagar dos cartões). */
@UseGuards(VaultAccessTokenGuard)
@Controller('vault')
export class CardController {
  constructor(private readonly cardInvoiceService: CardInvoiceService) {}

  @Get('cards')
  async list(@VaultSession() vaultId: string) {
    const [error, cards] = await this.cardInvoiceService.listCards(vaultId);
    if (error !== null) fail(error);
    return { cards };
  }

  @Post('cards')
  async create(@VaultSession() vaultId: string, @Body() data: CardBody) {
    if (!data.name || data.closingDay === undefined || data.dueDay === undefined) {
      throw new BadRequestException('name, closingDay e dueDay são obrigatórios');
    }
    const [error, card] = await this.cardInvoiceService.createCard(vaultId, {
      name: data.name,
      closingDay: data.closingDay,
      dueDay: data.dueDay,
      boxId: data.boxId,
      accountKey: data.accountKey ?? null,
    });
    if (error !== null) fail(error);
    return card;
  }

  @Post('cards/:cardId/update')
  async update(
    @VaultSession() vaultId: string,
    @Param('cardId') cardId: string,
    @Body() data: CardBody,
  ) {
    const [error, card] = await this.cardInvoiceService.updateCard(
      vaultId,
      cardId,
      {
        name: data.name,
        closingDay: data.closingDay,
        dueDay: data.dueDay,
        boxId: data.boxId,
        accountKey: data.accountKey,
      },
    );
    if (error !== null) fail(error);
    return card;
  }

  @Post('cards/:cardId/delete')
  async delete(
    @VaultSession() vaultId: string,
    @Param('cardId') cardId: string,
  ) {
    const [error] = await this.cardInvoiceService.deleteCard(vaultId, cardId);
    if (error !== null) fail(error);
    return { deleted: true };
  }

  @Get('available-balance')
  async availableBalance(@VaultSession() vaultId: string) {
    const [error, view] =
      await this.cardInvoiceService.getAvailableBalance(vaultId);
    if (error !== null) fail(error);
    return view;
  }
}

type PaymentBody = {
  cardId?: string;
  invoiceId?: string;
  amount?: number;
  date?: string;
  boxId?: string;
  transactionId?: string;
  allowDuplicate?: boolean;
};

/** Faturas (ciclos dos cartões), pagamentos e conferência. */
@UseGuards(VaultAccessTokenGuard)
@Controller('vault/invoices')
export class InvoiceController {
  constructor(private readonly cardInvoiceService: CardInvoiceService) {}

  /**
   * Faturas de todos os cartões (ou de um, com `cardId`), da mais nova para a
   * mais antiga, e os extratos de cartão antigos ainda sem fatura.
   */
  @Get()
  async list(
    @VaultSession() vaultId: string,
    @Query('cardId') cardId?: string,
  ) {
    const [error, result] = await this.cardInvoiceService.listInvoices(
      vaultId,
      { cardId },
    );
    if (error !== null) fail(error);
    return result;
  }

  @Get('duplicates')
  async duplicates(
    @VaultSession() vaultId: string,
    @Query('invoiceId') invoiceId?: string,
  ) {
    const [error, pairs] = await this.cardInvoiceService.listDuplicates(
      vaultId,
      { invoiceId },
    );
    if (error !== null) fail(error);
    return { pairs };
  }

  @Get('reprocess/preview')
  async reprocessPreview(@VaultSession() vaultId: string) {
    const [error, report] =
      await this.cardInvoiceService.previewReprocess(vaultId);
    if (error !== null) fail(error);
    return report;
  }

  @Post('reprocess/apply')
  async reprocessApply(@VaultSession() vaultId: string) {
    const [error, report] =
      await this.cardInvoiceService.applyReprocess(vaultId);
    if (error !== null) fail(error);
    return report;
  }

  /** Liga transações a uma fatura, ou ao cartão (a fatura sai da data de cada uma). */
  @Post('link-transactions')
  async link(
    @VaultSession() vaultId: string,
    @Body()
    data: { transactionIds?: string[]; invoiceId?: string; cardId?: string },
  ) {
    if (!data.transactionIds?.length) {
      throw new BadRequestException('Nenhuma transação informada');
    }
    if (!data.invoiceId === !data.cardId) {
      throw new BadRequestException('Informe invoiceId ou cardId');
    }
    const [error, result] = await this.cardInvoiceService.linkTransactions(
      vaultId,
      data.transactionIds,
      data.invoiceId ? { invoiceId: data.invoiceId } : { cardId: data.cardId! },
    );
    if (error !== null) fail(error);
    return result;
  }

  /** Desfaz: as compras voltam a ser transações comuns, na data delas. */
  @Post('unlink-transactions')
  async unlink(
    @VaultSession() vaultId: string,
    @Body() data: { transactionIds?: string[] },
  ) {
    if (!data.transactionIds?.length) {
      throw new BadRequestException('Nenhuma transação informada');
    }
    const [error, result] = await this.cardInvoiceService.linkTransactions(
      vaultId,
      data.transactionIds,
      null,
    );
    if (error !== null) fail(error);
    return result;
  }

  /** Pagamento pelo cartão, com a fatura sugerida pela data. */
  @Post('payments')
  async addCardPayment(
    @VaultSession() vaultId: string,
    @Body() data: PaymentBody,
  ) {
    if (!data.cardId && !data.invoiceId) {
      throw new BadRequestException('Informe cardId ou invoiceId');
    }
    return this.addPayment(vaultId, data);
  }

  @Post('payments/:paymentId/update')
  async updatePayment(
    @VaultSession() vaultId: string,
    @Param('paymentId') paymentId: string,
    @Body()
    data: { amount?: number; date?: string; invoiceId?: string; boxId?: string },
  ) {
    const [error, result] = await this.cardInvoiceService.updatePayment(
      vaultId,
      paymentId,
      {
        amount: parseAmount(data.amount),
        date: parseDay(data.date, 'date'),
        invoiceId: data.invoiceId,
        boxId: data.boxId,
      },
    );
    if (error !== null) fail(error);
    return result;
  }

  @Post('payments/:paymentId/delete')
  async deletePayment(
    @VaultSession() vaultId: string,
    @Param('paymentId') paymentId: string,
  ) {
    const [error] = await this.cardInvoiceService.deletePayment(
      vaultId,
      paymentId,
    );
    if (error !== null) fail(error);
    return { deleted: true };
  }

  @Get(':invoiceId')
  async get(
    @VaultSession() vaultId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    const [error, detail] = await this.cardInvoiceService.getInvoice(
      vaultId,
      invoiceId,
    );
    if (error !== null) fail(error);
    return detail;
  }

  @Get(':invoiceId/reconcile')
  async reconcile(
    @VaultSession() vaultId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    const [error, view] = await this.cardInvoiceService.reconcileInvoice(
      vaultId,
      invoiceId,
    );
    if (error !== null) fail(error);
    return view;
  }

  @Post(':invoiceId/update')
  async update(
    @VaultSession() vaultId: string,
    @Param('invoiceId') invoiceId: string,
    @Body()
    data: {
      periodStart?: string;
      closingDate?: string;
      dueDate?: string;
      closed?: boolean;
    },
  ) {
    const [error, invoice] = await this.cardInvoiceService.updateInvoice(
      vaultId,
      invoiceId,
      {
        periodStart: parseDay(data.periodStart, 'periodStart'),
        closingDate: parseDay(data.closingDate, 'closingDate'),
        dueDate: parseDay(data.dueDate, 'dueDate'),
        closed: typeof data.closed === 'boolean' ? data.closed : undefined,
      },
    );
    if (error !== null) fail(error);
    return invoice;
  }

  @Post(':invoiceId/close')
  async close(
    @VaultSession() vaultId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() data: { closingDate?: string },
  ) {
    const [error, invoice] = await this.cardInvoiceService.closeInvoice(
      vaultId,
      invoiceId,
      parseDay(data?.closingDate, 'closingDate'),
    );
    if (error !== null) fail(error);
    return invoice;
  }

  @Post(':invoiceId/payments')
  async addInvoicePayment(
    @VaultSession() vaultId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() data: PaymentBody,
  ) {
    return this.addPayment(vaultId, { ...data, invoiceId });
  }

  private async addPayment(vaultId: string, data: PaymentBody) {
    const [error, result] = await this.cardInvoiceService.addPayment(vaultId, {
      invoiceId: data.invoiceId,
      cardId: data.cardId,
      amount: parseAmount(data.amount),
      date: parseDay(data.date, 'date'),
      boxId: data.boxId,
      transactionId: data.transactionId,
      allowDuplicate: data.allowDuplicate === true,
    });
    if (error !== null) fail(error);
    return result;
  }
}
