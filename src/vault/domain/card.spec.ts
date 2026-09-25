import { describe, expect, it } from 'vitest';
import {
  Card,
  cardDaysFromStatement,
  clampedDay,
  cycleDatesFor,
  dueDateAfter,
} from './card';

const d = (y: number, m: number, day: number) =>
  new Date(Date.UTC(y, m - 1, day));

describe('Card', () => {
  it('valida os dias de fechamento e vencimento', () => {
    const base = { vaultId: 'v', name: 'Nubank', boxId: 'b' };
    expect(Card.create({ ...base, closingDay: 0, dueDay: 9 })[0]).toMatch(
      /fechamento/,
    );
    expect(Card.create({ ...base, closingDay: 2, dueDay: 32 })[0]).toMatch(
      /vencimento/,
    );
    expect(
      Card.create({ ...base, name: '  ', closingDay: 2, dueDay: 9 })[0],
    ).toMatch(/nome/);
    expect(Card.create({ ...base, closingDay: 2, dueDay: 9 })[0]).toBeNull();
  });
});

describe('datas do ciclo', () => {
  it('limita o dia ao tamanho do mês', () => {
    expect(clampedDay(2026, 1, 31)).toEqual(d(2026, 2, 28));
    expect(clampedDay(2026, 12, 5)).toEqual(d(2027, 1, 5));
  });

  it('o ciclo contém a compra: do dia seguinte ao fechamento anterior até o fechamento', () => {
    const card = { closingDay: 2, dueDay: 9 };
    expect(cycleDatesFor(card, d(2026, 8, 20))).toEqual({
      periodStart: d(2026, 8, 3),
      closingDate: d(2026, 9, 2),
      dueDate: d(2026, 9, 9),
    });
    // No próprio dia do fechamento, ainda é a fatura que fecha.
    expect(cycleDatesFor(card, d(2026, 9, 2)).closingDate).toEqual(
      d(2026, 9, 2),
    );
    expect(cycleDatesFor(card, d(2026, 9, 3)).closingDate).toEqual(
      d(2026, 10, 2),
    );
  });

  it('vencimento com dia menor que o fechamento cai no mês seguinte', () => {
    expect(dueDateAfter(d(2026, 8, 25), 5)).toEqual(d(2026, 9, 5));
    expect(dueDateAfter(d(2026, 8, 25), 30)).toEqual(d(2026, 8, 30));
    expect(
      cycleDatesFor({ closingDay: 25, dueDay: 5 }, d(2026, 12, 26)),
    ).toEqual({
      periodStart: d(2026, 12, 26),
      closingDate: d(2027, 1, 25),
      dueDate: d(2027, 2, 5),
    });
  });

  it('sugere os dias a partir do fim do extrato (vencimento 7 dias depois)', () => {
    expect(cardDaysFromStatement(d(2026, 9, 2))).toEqual({
      closingDay: 2,
      dueDay: 9,
    });
    expect(cardDaysFromStatement(d(2026, 8, 28))).toEqual({
      closingDay: 28,
      dueDay: 4,
    });
  });
});
