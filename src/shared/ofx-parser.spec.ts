import { describe, it, expect } from 'vitest';
import {
  parseOfx,
  parseOfxAmount,
  parseOfxDate,
  decodeOfx,
  OfxParseError,
} from './ofx-parser';

/** OFX 1.x SGML, como os bancos brasileiros emitem: folhas sem fechamento. */
const OFX_1X = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0260
<ACCTID>1234567-8
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101000000[-3:BRT]
<DTEND>20260131235959[-3:BRT]
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260115120000[-3:BRT]
<TRNAMT>-45.90
<FITID>202601150001
<MEMO>PAG*IFOOD 1234
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260105000000[-3:BRT]
<TRNAMT>7500.00
<FITID>202601050001
<MEMO>SALARIO
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260120000000[-3:BRT]
<TRNAMT>-1.234,56
<FITID>202601200001
<MEMO>ALUGUEL JANEIRO
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>6219.54
<DTASOF>20260131235959[-3:BRT]
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

/** Mesmo arquivo com acentuação — os bytes vão como latin1, sem declarar UTF-8. */
const OFX_ACENTOS = OFX_1X.replace(
  '<MEMO>ALUGUEL JANEIRO',
  '<MEMO>ALUGUEL JANEIRO - CONDOMÍNIO ÁGUAS & JARDIM',
);

const OFX_CARTAO = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
<OFX>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<CURDEF>BRL
<CCACCTFROM>
<ACCTID>5432109876543210
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101
<DTEND>20260131
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260110
<TRNAMT>-199.00
<FITID>CC-202601100001
<MEMO>ASSINATURA STREAMING
</STMTTRN>
</BANKTRANLIST>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`;

/** OFX 2.x é XML: todas as folhas fechadas, encoding declarado. */
const OFX_2X = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="200"?>
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <CURDEF>BRL</CURDEF>
        <BANKACCTFROM>
          <BANKID>0341</BANKID>
          <ACCTID>99887766</ACCTID>
          <ACCTTYPE>CHECKING</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20260201</DTSTART>
          <DTEND>20260228</DTEND>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260210</DTPOSTED>
            <TRNAMT>-88.40</TRNAMT>
            <FITID>XML-0001</FITID>
            <MEMO>PADARIA P&amp;A</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>`;

const latin1 = (text: string) => Buffer.from(text, 'latin1');
const utf8 = (text: string) => Buffer.from(text, 'utf8');

describe('parseOfxDate', () => {
  it('should parse a plain YYYYMMDD date as UTC midnight', () => {
    const date = parseOfxDate('20260115');
    expect(date).toBeInstanceOf(Date);
    expect(date!.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('should ignore time and timezone suffix', () => {
    const date = parseOfxDate('20260115120000[-3:BRT]');
    expect(date!.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('should keep the calendar day the bank reported, not shift it', () => {
    // Um Date construído com métodos locais em UTC-3 cairia em 14/jan.
    const date = parseOfxDate('20260115000000[-3:BRT]');
    expect(date!.getUTCDate()).toBe(15);
    expect(date!.getUTCMonth()).toBe(0);
    expect(date!.getUTCFullYear()).toBe(2026);
  });

  it('should return null for unparseable input', () => {
    expect(parseOfxDate('not-a-date')).toBeNull();
    expect(parseOfxDate(null)).toBeNull();
  });
});

describe('parseOfxAmount', () => {
  it('should parse the OFX standard decimal point', () => {
    expect(parseOfxAmount('-45.90')).toBe(-45.9);
    expect(parseOfxAmount('7500.00')).toBe(7500);
  });

  it('should parse comma as decimal separator', () => {
    expect(parseOfxAmount('-1234,56')).toBe(-1234.56);
  });

  it('should treat the last separator as decimal and the other as thousands', () => {
    expect(parseOfxAmount('-1.234,56')).toBe(-1234.56);
    expect(parseOfxAmount('-1,234.56')).toBe(-1234.56);
    expect(parseOfxAmount('1.234.567,89')).toBe(1234567.89);
  });

  it('should parse integers without separators', () => {
    expect(parseOfxAmount('1234')).toBe(1234);
    expect(parseOfxAmount('-1234')).toBe(-1234);
  });

  it('should return null for unparseable input', () => {
    expect(parseOfxAmount('abc')).toBeNull();
    expect(parseOfxAmount(null)).toBeNull();
  });
});

describe('decodeOfx', () => {
  it('should decode as latin1 when the header does not declare UTF-8', () => {
    const text = decodeOfx(latin1(OFX_ACENTOS));
    expect(text).toContain('CONDOMÍNIO ÁGUAS');
  });

  it('should decode as UTF-8 when the XML declaration says so', () => {
    const text = decodeOfx(utf8(OFX_2X.replace('P&amp;A', 'PÃO')));
    expect(text).toContain('PÃO');
  });
});

describe('parseOfx — OFX 1.x (SGML)', () => {
  it('should extract the account identity and build a stable accountKey', () => {
    const [statement] = parseOfx(latin1(OFX_1X));
    expect(statement.account.bankId).toBe('0260');
    expect(statement.account.acctId).toBe('1234567-8');
    expect(statement.account.acctType).toBe('CHECKING');
    expect(statement.account.accountKey).toBe('0260:1234567-8:CHECKING');
    expect(statement.kind).toBe('bank');
    expect(statement.currency).toBe('BRL');
  });

  it('should extract the statement period and ledger balance', () => {
    const [statement] = parseOfx(latin1(OFX_1X));
    expect(statement.periodStart!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(statement.periodEnd!.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(statement.ledgerBalance).toBe(6219.54);
  });

  it('should extract every transaction with its FITID', () => {
    const [statement] = parseOfx(latin1(OFX_1X));
    expect(statement.transactions).toHaveLength(3);
    expect(statement.transactions.map((t) => t.fitId)).toEqual([
      '202601150001',
      '202601050001',
      '202601200001',
    ]);
  });

  it('should derive type from the sign of TRNAMT, not from TRNTYPE', () => {
    const [statement] = parseOfx(latin1(OFX_1X));
    const [ifood, salario] = statement.transactions;
    expect(ifood.amount).toBe(-45.9);
    expect(ifood.type).toBe('expense');
    expect(salario.amount).toBe(7500);
    expect(salario.type).toBe('income');
  });

  it('should not let an unclosed MEMO swallow the next tag', () => {
    const [statement] = parseOfx(latin1(OFX_1X));
    expect(statement.transactions[0].memo).toBe('PAG*IFOOD 1234');
  });

  it('should preserve accented characters from latin1 bytes', () => {
    const [statement] = parseOfx(latin1(OFX_ACENTOS));
    expect(statement.transactions[2].memo).toBe(
      'ALUGUEL JANEIRO - CONDOMÍNIO ÁGUAS & JARDIM',
    );
  });
});

describe('parseOfx — OFX 2.x (XML)', () => {
  it('should parse closed tags and decode XML entities', () => {
    const [statement] = parseOfx(utf8(OFX_2X));
    expect(statement.account.accountKey).toBe('0341:99887766:CHECKING');
    expect(statement.transactions).toHaveLength(1);
    expect(statement.transactions[0].memo).toBe('PADARIA P&A');
    expect(statement.transactions[0].amount).toBe(-88.4);
  });
});

describe('parseOfx — cartão de crédito', () => {
  it('should parse a CCSTMTRS statement and mark its kind', () => {
    const [statement] = parseOfx(latin1(OFX_CARTAO));
    expect(statement.kind).toBe('creditcard');
    expect(statement.account.acctId).toBe('5432109876543210');
    expect(statement.account.accountKey).toBe(':5432109876543210:');
    expect(statement.transactions[0].fitId).toBe('CC-202601100001');
  });
});

describe('parseOfx — múltiplos extratos e erros', () => {
  it('should return one statement per account in the file', () => {
    const combined = OFX_1X.replace(
      '</OFX>',
      OFX_CARTAO.slice(OFX_CARTAO.indexOf('<CREDITCARDMSGSRSV1>')),
    );
    const statements = parseOfx(latin1(combined));
    expect(statements).toHaveLength(2);
    expect(statements.map((s) => s.kind)).toEqual(['bank', 'creditcard']);
  });

  it('should skip transactions missing FITID, date or amount', () => {
    const broken = OFX_1X.replace('<FITID>202601050001\n', '');
    const [statement] = parseOfx(latin1(broken));
    expect(statement.transactions).toHaveLength(2);
    expect(statement.transactions.map((t) => t.fitId)).not.toContain(
      '202601050001',
    );
  });

  it('should throw when the file is not OFX at all', () => {
    expect(() => parseOfx(utf8('data,valor\n01/01/2026,10'))).toThrow(
      OfxParseError,
    );
  });

  it('should throw when the file has no usable statement', () => {
    expect(() => parseOfx(utf8('<OFX></OFX>'))).toThrow(OfxParseError);
  });
});
