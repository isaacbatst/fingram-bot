import crypto from 'crypto';
import { Either, left, right } from './either';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dias entre o fechamento e o vencimento quando o extrato não diz. */
export const DEFAULT_DUE_OFFSET_DAYS = 7;

type CreateParams = {
  vaultId: string;
  name: string;
  closingDay: number;
  dueDay: number;
  boxId: string;
  accountKey?: string | null;
  createdAt?: Date;
};

type RestoreParams = CreateParams & {
  id: string;
  accountKey: string | null;
  createdAt: Date;
};

export function validateCardDay(value: unknown, label: string): string | null {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 31) {
    return `O dia de ${label} deve ser um número inteiro entre 1 e 31`;
  }
  return null;
}

/**
 * Cartão de crédito cadastrado. Não é estrato: dinheiro não fica nele. As
 * compras dele esperam um pagamento de fatura para contar, e o pagamento sai do
 * estrato pagador (`boxId`). `accountKey` é a conta do OFX (`CCACCTFROM`) que
 * faz um extrato importado cair no cartão certo.
 */
export class Card {
  static create(params: CreateParams): Either<string, Card> {
    const error =
      validateCardDay(params.closingDay, 'fechamento') ??
      validateCardDay(params.dueDay, 'vencimento');
    if (error) return left(error);
    if (!params.name.trim()) return left('O nome do cartão é obrigatório');
    return right(
      new Card({
        ...params,
        name: params.name.trim(),
        id: crypto.randomUUID(),
        accountKey: params.accountKey ?? null,
        createdAt: params.createdAt ?? new Date(),
      }),
    );
  }

  static restore(params: RestoreParams): Card {
    return new Card(params);
  }

  readonly id: string;
  readonly vaultId: string;
  readonly createdAt: Date;
  name: string;
  closingDay: number;
  dueDay: number;
  boxId: string;
  accountKey: string | null;

  private constructor(params: RestoreParams) {
    this.id = params.id;
    this.vaultId = params.vaultId;
    this.name = params.name;
    this.closingDay = params.closingDay;
    this.dueDay = params.dueDay;
    this.boxId = params.boxId;
    this.accountKey = params.accountKey;
    this.createdAt = params.createdAt;
  }
}

/** Meia-noite UTC do dia, com o dia limitado ao tamanho do mês (31 → 30/28). */
export function clampedDay(year: number, monthIndex: number, day: number): Date {
  const normalized = new Date(Date.UTC(year, monthIndex, 1));
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Primeiro dia `dueDay` depois do fechamento. */
export function dueDateAfter(closingDate: Date, dueDay: number): Date {
  const y = closingDate.getUTCFullYear();
  const m = closingDate.getUTCMonth();
  const candidate = clampedDay(y, m, dueDay);
  return candidate.getTime() > closingDate.getTime()
    ? candidate
    : clampedDay(y, m + 1, dueDay);
}

/**
 * O ciclo que, pelos dias do cartão, contém uma data de compra. O período é
 * fechado nas duas pontas: [dia seguinte ao fechamento anterior, fechamento],
 * como `DTSTART`/`DTEND` de um extrato de cartão.
 */
export function cycleDatesFor(
  card: { closingDay: number; dueDay: number },
  date: Date,
): { periodStart: Date; closingDate: Date; dueDate: Date } {
  const day = startOfUtcDay(date);
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  let closingDate = clampedDay(y, m, card.closingDay);
  let closingMonth = m;
  if (day.getTime() > closingDate.getTime()) {
    closingMonth = m + 1;
    closingDate = clampedDay(y, closingMonth, card.closingDay);
  }
  const previousClosing = clampedDay(y, closingMonth - 1, card.closingDay);
  return {
    periodStart: addDays(previousClosing, 1),
    closingDate,
    dueDate: dueDateAfter(closingDate, card.dueDay),
  };
}

/** Dias do cartão sugeridos a partir do período de um extrato. */
export function cardDaysFromStatement(periodEnd: Date): {
  closingDay: number;
  dueDay: number;
} {
  return {
    closingDay: periodEnd.getUTCDate(),
    dueDay: addDays(periodEnd, DEFAULT_DUE_OFFSET_DAYS).getUTCDate(),
  };
}
