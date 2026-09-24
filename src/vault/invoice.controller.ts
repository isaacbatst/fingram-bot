import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { VaultAccessTokenGuard } from './vault-access-token.guard';
import { VaultSession } from './vault-session.decorator';
import { CardInvoiceService } from './card-invoice.service';

@UseGuards(VaultAccessTokenGuard)
@Controller('vault/invoices')
export class InvoiceController {
  constructor(private readonly cardInvoiceService: CardInvoiceService) {}

  /**
   * Faturas do vault com quanto já foi detalhado, e os extratos de cartão com
   * compras confirmadas que ainda não pertencem a nenhuma fatura.
   */
  @Get()
  async list(@VaultSession() vaultId: string) {
    const [error, result] = await this.cardInvoiceService.listInvoices(vaultId);
    if (error !== null) throw new NotFoundException(error);
    return result;
  }

  @Post('delete')
  async delete(
    @VaultSession() vaultId: string,
    @Body() data: { invoiceId?: string },
  ) {
    if (!data.invoiceId) {
      throw new BadRequestException('invoiceId é obrigatório');
    }
    const [error] = await this.cardInvoiceService.deleteInvoice({
      vaultId,
      invoiceId: data.invoiceId,
    });
    if (error !== null) throw new BadRequestException(error);
    return { deleted: true };
  }
}
