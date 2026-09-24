import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { VaultAccessTokenGuard } from './vault-access-token.guard';
import { VaultSession } from './vault-session.decorator';
import { ImportService } from './import.service';
import { CardInvoiceService } from './card-invoice.service';
import { ImportBatch } from './domain/import-batch';
import { ImportEntry, ImportEntryStatus } from './domain/import-entry';

const STATUSES: ImportEntryStatus[] = ['pending', 'confirmed', 'dismissed'];

@UseGuards(VaultAccessTokenGuard)
@Controller('vault/import')
export class ImportController {
  private readonly logger = new Logger(ImportController.name);

  constructor(
    private readonly importService: ImportService,
    private readonly cardInvoiceService: CardInvoiceService,
  ) {}

  /**
   * The file arrives base64-encoded rather than as multipart on purpose: the OFX
   * bytes must reach the parser untouched. Sending it as text would let the browser
   * re-encode latin1 content and corrupt the accents before the server ever sees it.
   */
  @Post('upload')
  async upload(
    @VaultSession() vaultId: string,
    @Body()
    data: {
      contentBase64?: string;
      fileName?: string;
      boxId?: string;
      /** Data inicial opcional, no formato YYYY-MM-DD. */
      fromDate?: string;
    },
  ) {
    if (!data.contentBase64?.trim()) {
      throw new BadRequestException('O arquivo é obrigatório');
    }

    const file = Buffer.from(data.contentBase64, 'base64');
    if (file.length === 0) {
      throw new BadRequestException('O arquivo está vazio');
    }

    const fromDate = this.parseDayOnly(data.fromDate);
    if (data.fromDate && !fromDate) {
      throw new BadRequestException('Data inicial inválida');
    }

    const [error, batches] = await this.importService.ingest({
      vaultId,
      file,
      fileName: data.fileName,
      boxId: data.boxId,
      fromDate,
    });
    if (error !== null) throw new BadRequestException(error);

    return { batches: batches.map((batch) => this.batchToDTO(batch)) };
  }

  @Get('batches')
  async listBatches(@VaultSession() vaultId: string) {
    const batches = await this.importService.listBatches(vaultId);
    return {
      batches: batches.map(({ batch, pendingCount }) => ({
        ...this.batchToDTO(batch),
        pendingCount,
      })),
    };
  }

  @Get('batch/:batchId')
  async getReview(
    @VaultSession() vaultId: string,
    @Param('batchId') batchId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (status && !STATUSES.includes(status as ImportEntryStatus)) {
      throw new BadRequestException('Status inválido');
    }

    const [error, review] = await this.importService.getReview({
      vaultId,
      batchId,
      status: status as ImportEntryStatus | undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
    if (error !== null) throw new NotFoundException(error);

    return {
      batch: this.batchToDTO(review.batch),
      counts: review.counts,
      duplicateCount: review.duplicateCount,
      outOfRangeCount: review.outOfRangeCount,
      entries: {
        ...review.entries,
        items: review.entries.items.map((entry) => this.entryToDTO(entry)),
      },
    };
  }

  /** Os lançamentos pendentes do lote, colapsados por estabelecimento. */
  @Get('batch/:batchId/groups')
  async getGroups(
    @VaultSession() vaultId: string,
    @Param('batchId') batchId: string,
  ) {
    const [error, groups] = await this.importService.getGroups({
      vaultId,
      batchId,
    });
    if (error !== null) throw new NotFoundException(error);

    return { groups };
  }

  /**
   * Define a categoria de vários lançamentos sem confirmá-los.
   *
   * Separar categorizar de confirmar é o que deixa a triagem rápida: nada vira
   * transação até o confirmar final, então voltar e mudar de ideia não custa nada.
   */
  @Post('entries/categorize')
  async categorizeEntries(
    @VaultSession() vaultId: string,
    @Body()
    data: {
      entryIds?: string[];
      categoryId?: string | null;
      /** Pagamento planejado do plano, no lugar da categoria. */
      allocationId?: string | null;
    },
  ) {
    if (!data.entryIds?.length) {
      throw new BadRequestException('Nenhum lançamento informado');
    }

    const [error, result] = await this.importService.categorizeEntries({
      vaultId,
      entryIds: data.entryIds,
      categoryId: data.categoryId ?? null,
      allocationId: data.allocationId ?? null,
    });
    if (error !== null) throw new BadRequestException(error);

    return result;
  }

  @Post('entry/edit')
  async editEntry(
    @VaultSession() vaultId: string,
    @Body()
    data: {
      entryId?: string;
      date?: string;
      amount?: number;
      type?: 'income' | 'expense';
      description?: string;
      categoryId?: string | null;
      boxId?: string | null;
    },
  ) {
    if (!data.entryId) throw new BadRequestException('entryId é obrigatório');
    if (data.type && !['income', 'expense'].includes(data.type)) {
      throw new BadRequestException('Tipo inválido');
    }

    const [error, entry] = await this.importService.editEntry({
      vaultId,
      entryId: data.entryId,
      changes: {
        date: data.date ? new Date(data.date) : undefined,
        amount: data.amount,
        type: data.type,
        description: data.description,
        categoryId: data.categoryId,
        boxId: data.boxId,
      },
    });
    if (error !== null) throw new BadRequestException(error);

    return this.entryToDTO(entry);
  }

  @Post('entry/dismiss')
  async dismissEntry(
    @VaultSession() vaultId: string,
    @Body() data: { entryId?: string },
  ) {
    if (!data.entryId) throw new BadRequestException('entryId é obrigatório');

    const [error, entry] = await this.importService.dismissEntry({
      vaultId,
      entryId: data.entryId,
    });
    if (error !== null) throw new BadRequestException(error);

    return this.entryToDTO(entry);
  }

  /** Confirms the entries the user reviewed — typically the visible batch. */
  @Post('confirm')
  async confirm(
    @VaultSession() vaultId: string,
    @Body() data: { entryIds?: string[] },
  ) {
    if (!data.entryIds?.length) {
      throw new BadRequestException('Nenhum lançamento informado');
    }

    const [error, result] = await this.importService.confirmEntries({
      vaultId,
      entryIds: data.entryIds,
    });
    if (error !== null) throw new BadRequestException(error);

    return result;
  }

  /**
   * Confirma lançamentos como transferência entre estratos do usuário, criando o
   * par em vez de uma transação solta — o dinheiro continua sendo dele.
   */
  @Post('confirm-transfer')
  async confirmTransfer(
    @VaultSession() vaultId: string,
    @Body() data: { entryIds?: string[]; boxId?: string },
  ) {
    if (!data.entryIds?.length) {
      throw new BadRequestException('Nenhum lançamento informado');
    }
    if (!data.boxId) {
      throw new BadRequestException('O estrato de destino é obrigatório');
    }

    const [error, result] = await this.importService.confirmAsTransfer({
      vaultId,
      entryIds: data.entryIds,
      boxId: data.boxId,
    });
    if (error !== null) throw new BadRequestException(error);

    return result;
  }

  /**
   * Confirma despesas pagas com dinheiro de uma Reserva (realização ou saque):
   * lança a despesa vinculada a ela, no estrato da Reserva.
   */
  @Post('confirm-reserve-withdrawal')
  async confirmReserveWithdrawal(
    @VaultSession() vaultId: string,
    @Body()
    data: {
      entryIds?: string[];
      allocationId?: string;
      withdrawalType?: string;
      fromEstrato?: boolean;
    },
  ) {
    if (!data.entryIds?.length) {
      throw new BadRequestException('Nenhum lançamento informado');
    }
    if (!data.allocationId) {
      throw new BadRequestException('A Reserva é obrigatória');
    }
    if (
      data.withdrawalType !== 'withdrawal' &&
      data.withdrawalType !== 'realization'
    ) {
      throw new BadRequestException(
        'withdrawalType deve ser "withdrawal" ou "realization"',
      );
    }

    const [error, result] = await this.importService.confirmAsReserveWithdrawal(
      {
        vaultId,
        entryIds: data.entryIds,
        allocationId: data.allocationId,
        withdrawalType: data.withdrawalType,
        fromEstrato: data.fromEstrato ?? true,
      },
    );
    if (error !== null) throw new BadRequestException(error);

    return result;
  }

  /**
   * Registra a fatura de cartão a partir do débito de pagamento na conta
   * corrente. Confirma na hora: a fatura passa a contar como gasto, e o que o
   * extrato do cartão ainda não detalhou aparece como "não discriminado".
   */
  @Post('confirm-invoice')
  async confirmInvoice(
    @VaultSession() vaultId: string,
    @Body() data: { entryIds?: string[] },
  ) {
    if (!data.entryIds?.length) {
      throw new BadRequestException('Nenhum lançamento informado');
    }

    const [error, result] = await this.importService.confirmAsInvoice({
      vaultId,
      entryIds: data.entryIds,
    });
    if (error !== null) throw new BadRequestException(error);

    return result;
  }

  /** Liga um extrato de cartão a uma fatura, ou desliga com `invoiceId: null`. */
  @Post('batch/invoice')
  async setBatchInvoice(
    @VaultSession() vaultId: string,
    @Body() data: { batchId?: string; invoiceId?: string | null },
  ) {
    if (!data.batchId) throw new BadRequestException('batchId é obrigatório');

    const [error, batch] = await this.cardInvoiceService.setBatchInvoice({
      vaultId,
      batchId: data.batchId,
      invoiceId: data.invoiceId ?? null,
    });
    if (error !== null) throw new BadRequestException(error);

    return this.batchToDTO(batch);
  }

  @Post('batch/confirm')
  async confirmBatch(
    @VaultSession() vaultId: string,
    @Body() data: { batchId?: string },
  ) {
    if (!data.batchId) throw new BadRequestException('batchId é obrigatório');

    const [error, result] = await this.importService.confirmBatch({
      vaultId,
      batchId: data.batchId,
    });
    if (error !== null) throw new BadRequestException(error);

    return result;
  }

  @Post('batch/close')
  async closeBatch(
    @VaultSession() vaultId: string,
    @Body() data: { batchId?: string },
  ) {
    if (!data.batchId) throw new BadRequestException('batchId é obrigatório');

    const [error, batch] = await this.importService.closeBatch({
      vaultId,
      batchId: data.batchId,
    });
    if (error !== null) throw new NotFoundException(error);

    return this.batchToDTO(batch);
  }

  /**
   * Lê uma data no formato YYYY-MM-DD como meia-noite UTC.
   *
   * Construir com `Date.UTC` em vez de `new Date(...)` local evita o deslocamento de
   * um dia em UTC-3, que faria o corte "a partir de 06/05" incluir o dia 05/05.
   */
  private parseDayOnly(value?: string): Date | undefined {
    if (!value) return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return undefined;
    const [, year, month, day] = match;
    const date = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private batchToDTO(batch: ImportBatch) {
    return {
      id: batch.id,
      accountKey: batch.accountKey,
      accountLabel: batch.accountLabel,
      boxId: batch.boxId,
      kind: batch.kind,
      currency: batch.currency,
      periodStart: batch.periodStart,
      periodEnd: batch.periodEnd,
      ledgerBalance: batch.ledgerBalance,
      fileName: batch.fileName,
      status: batch.status,
      duplicateCount: batch.duplicateCount,
      fromDate: batch.fromDate,
      outOfRangeCount: batch.outOfRangeCount,
      invoiceId: batch.invoiceId,
      createdAt: batch.createdAt,
    };
  }

  private entryToDTO(entry: ImportEntry) {
    return {
      id: entry.id,
      batchId: entry.batchId,
      fitId: entry.fitId,
      date: entry.date,
      amount: entry.amount,
      type: entry.type,
      description: entry.description,
      categoryId: entry.categoryId,
      allocationId: entry.allocationId,
      boxId: entry.boxId,
      suggestedCategoryId: entry.suggestedCategoryId,
      suggestionSource: entry.suggestionSource,
      status: entry.status,
      transactionId: entry.transactionId,
      // O texto original do banco, preservado para o usuário conferir contra o extrato
      // mesmo depois de editar a descrição.
      rawDescription: entry.rawMemo ?? entry.rawName,
      rawAmount: entry.rawAmount,
      rawDate: entry.rawDate,
    };
  }
}
