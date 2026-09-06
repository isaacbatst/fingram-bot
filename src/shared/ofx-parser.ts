/**
 * Parser de arquivos OFX (Open Financial Exchange).
 *
 * Cobre OFX 1.x (SGML, o formato emitido pelos bancos brasileiros) e OFX 2.x (XML).
 * Ver `docs/product/spec-operational.md` §9 para o contrato e os cuidados de parsing.
 */

export type OfxTransaction = {
  /** FITID: identificador único do lançamento na conta. Base da deduplicação. */
  fitId: string;
  /** DTPOSTED, normalizada para meia-noite UTC do dia informado pelo banco. */
  datePosted: Date;
  /** TRNAMT com o sinal original do arquivo. */
  amount: number;
  /** Derivado do sinal de TRNAMT — TRNTYPE não é consistente entre bancos. */
  type: 'income' | 'expense';
  /** TRNTYPE bruto, preservado para diagnóstico. */
  trnType: string | null;
  memo: string | null;
  name: string | null;
};

export type OfxAccount = {
  bankId: string | null;
  acctId: string;
  acctType: string | null;
  /** Chave estável da conta. Compõe o índice único de deduplicação. */
  accountKey: string;
};

export type OfxStatement = {
  account: OfxAccount;
  /** `bank` para conta corrente/poupança, `creditcard` para fatura de cartão. */
  kind: 'bank' | 'creditcard';
  currency: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  ledgerBalance: number | null;
  transactions: OfxTransaction[];
};

export class OfxParseError extends Error {}

/**
 * Decodifica o arquivo detectando o encoding pelos bytes, não pelo cabeçalho.
 *
 * O cabeçalho não é confiável: o Nubank declara `CHARSET:1252` e emite UTF-8, e
 * confiar na declaração transforma "Pix no Crédito" em "Pix no CrÃ©dito". Outros
 * bancos realmente emitem ISO-8859-1, então também não dá para fixar UTF-8.
 *
 * A detecção resolve os dois casos: UTF-8 tem estrutura verificável, e texto
 * latin1 acentuado quase nunca forma uma sequência UTF-8 válida. Se decodificar
 * como UTF-8 estrito sem erro, é UTF-8; senão, é latin1.
 */
export function decodeOfx(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return buffer.toString('latin1');
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    // &amp; por último, senão "&amp;lt;" viraria "<".
    .replace(/&amp;/gi, '&');
}

/**
 * Lê um elemento folha. Cobre a forma fechada (`<TAG>v</TAG>`, OFX 2.x) e a
 * aberta (`<TAG>v` seguido de quebra de linha), que é a convenção do SGML no OFX 1.x.
 */
function readLeaf(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
  if (!match) return null;
  const value = decodeEntities(match[1].trim());
  return value.length > 0 ? value : null;
}

/** Lê os blocos de um agregado. Agregados são sempre fechados, mesmo em SGML. */
function readBlocks(text: string, tag: string): string[] {
  const matches = text.matchAll(
    new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi'),
  );
  return [...matches].map((m) => m[1]);
}

/**
 * Converte DTPOSTED/DTSTART/DTEND em Date.
 *
 * O formato é `YYYYMMDD` com hora e fuso opcionais (`20260115120000[-3:BRT]`).
 * Só a parte da data importa: é o dia que o banco afirma, e o app compara datas
 * armazenadas em UTC. Construir via `Date.UTC` evita o deslocamento de um dia
 * que métodos locais causariam em UTC-3.
 */
export function parseOfxDate(raw: string | null): Date | null {
  if (!raw) return null;
  const match = /^\s*(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Converte TRNAMT/BALAMT em número.
 *
 * O separador decimal é o último `.` ou `,` que aparecer; o outro é milhar.
 * A especificação OFX manda usar ponto, mas parte dos bancos brasileiros emite vírgula.
 */
export function parseOfxAmount(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s| /g, '');
  if (!/^[+-]?[\d.,]+$/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized: string;
  if (lastDot === -1 && lastComma === -1) {
    normalized = cleaned;
  } else if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = cleaned.replace(/,/g, '');
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function parseAccount(block: string): OfxAccount | null {
  const bankAcct = readBlocks(block, 'BANKACCTFROM')[0];
  const ccAcct = readBlocks(block, 'CCACCTFROM')[0];
  const source = bankAcct ?? ccAcct;
  if (!source) return null;

  const acctId = readLeaf(source, 'ACCTID');
  if (!acctId) return null;

  const bankId = readLeaf(source, 'BANKID');
  const acctType = readLeaf(source, 'ACCTTYPE');
  return {
    bankId,
    acctId,
    acctType,
    accountKey: [bankId ?? '', acctId, acctType ?? ''].join(':'),
  };
}

function parseTransaction(block: string): OfxTransaction | null {
  const fitId = readLeaf(block, 'FITID');
  const datePosted = parseOfxDate(readLeaf(block, 'DTPOSTED'));
  const amount = parseOfxAmount(readLeaf(block, 'TRNAMT'));

  // Sem qualquer um dos três o lançamento não é identificável nem contabilizável.
  if (!fitId || !datePosted || amount === null) return null;

  return {
    fitId,
    datePosted,
    amount,
    type: amount < 0 ? 'expense' : 'income',
    trnType: readLeaf(block, 'TRNTYPE'),
    memo: readLeaf(block, 'MEMO'),
    name: readLeaf(block, 'NAME'),
  };
}

function parseStatement(block: string, kind: 'bank' | 'creditcard'): OfxStatement | null {
  const account = parseAccount(block);
  if (!account) return null;

  const tranList = readBlocks(block, 'BANKTRANLIST')[0] ?? '';
  const ledgerBal = readBlocks(block, 'LEDGERBAL')[0] ?? '';

  return {
    account,
    kind,
    currency: readLeaf(block, 'CURDEF'),
    periodStart: parseOfxDate(readLeaf(tranList, 'DTSTART')),
    periodEnd: parseOfxDate(readLeaf(tranList, 'DTEND')),
    ledgerBalance: parseOfxAmount(readLeaf(ledgerBal, 'BALAMT')),
    transactions: readBlocks(block, 'STMTTRN')
      .map(parseTransaction)
      .filter((t): t is OfxTransaction => t !== null),
  };
}

/**
 * Extrai os extratos de um arquivo OFX.
 *
 * Um arquivo pode conter mais de um extrato (várias contas). Lança
 * {@link OfxParseError} quando nenhum extrato utilizável é encontrado.
 */
export function parseOfx(buffer: Buffer): OfxStatement[] {
  const text = decodeOfx(buffer);
  if (!/<OFX>/i.test(text)) {
    throw new OfxParseError('Arquivo não parece ser um OFX válido');
  }

  const statements = [
    ...readBlocks(text, 'STMTRS').map((b) => parseStatement(b, 'bank')),
    ...readBlocks(text, 'CCSTMTRS').map((b) => parseStatement(b, 'creditcard')),
  ].filter((s): s is OfxStatement => s !== null);

  if (statements.length === 0) {
    throw new OfxParseError(
      'Nenhum extrato encontrado no arquivo. Verifique se o arquivo contém lançamentos e identificação da conta.',
    );
  }

  return statements;
}
