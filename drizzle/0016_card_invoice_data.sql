-- Migração de dados: do modelo "uma fatura por pagamento" (card_invoice, com
-- o resto não discriminado como transação e as compras ligadas contando na
-- data do pagamento) para cartão + ciclos (faturas) + pagamentos.
--
-- Escrita à mão (é backfill), registrada no _journal.json. Roda na mesma
-- transação das demais migrações pendentes. Cada fatura antiga vira:
--   - um pagamento (card_payment) com o MESMO id da fatura antiga;
--   - um ciclo (card_cycle) com o período do extrato ligado a ela, ou,
--     sem extrato, fechando 7 dias antes do pagamento;
--   - suas compras ligadas voltam à data da compra, com invoice_role =
--     'purchase', apontando para o ciclo;
--   - o resto antigo é removido e as linhas derivadas (partes e não
--     discriminado) são recalculadas aqui com a mesma regra de
--     `allocateCard` (fila do cartão em centavos, estornos primeiro).
-- Cartões: um por conta de extrato (account_key) ligada às faturas; faturas
-- sem extrato vão para o único cartão do vault, ou para um cartão "Cartão".

-- As FKs para card_invoice saem antes de reescrever invoice_id; a migração
-- seguinte recria as duas apontando para card_cycle.
ALTER TABLE "transaction" DROP CONSTRAINT IF EXISTS "transaction_invoice_id_card_invoice_id_fk";
--> statement-breakpoint
ALTER TABLE "import_batch" DROP CONSTRAINT IF EXISTS "import_batch_invoice_id_card_invoice_id_fk";
--> statement-breakpoint
CREATE TEMP TABLE "_ci" ON COMMIT DROP AS
SELECT
  ci.id AS invoice_id,
  ci.vault_id,
  ci.amount,
  ci.payment_date,
  ci.has_payment_line,
  ci.created_at,
  COALESCE(
    ci.box_id,
    (SELECT b.id FROM box b WHERE b.vault_id = ci.vault_id AND b.is_default ORDER BY b.created_at LIMIT 1),
    (SELECT b.id FROM box b WHERE b.vault_id = ci.vault_id ORDER BY b.created_at LIMIT 1)
  ) AS box_id,
  st.account_key,
  st.account_label,
  date_trunc('day', st.period_start) AS period_start,
  date_trunc('day', st.period_end) AS period_end,
  NULL::text AS card_id,
  gen_random_uuid()::text AS cycle_id
FROM card_invoice ci
LEFT JOIN LATERAL (
  SELECT ib.account_key, ib.account_label, ib.period_start, ib.period_end
  FROM import_batch ib
  WHERE ib.invoice_id = ci.id AND ib.kind = 'creditcard'
  ORDER BY ib.period_end DESC NULLS LAST, ib.created_at DESC
  LIMIT 1
) st ON true;
--> statement-breakpoint
CREATE TEMP TABLE "_card" ON COMMIT DROP AS
SELECT DISTINCT ON (vault_id, account_key)
  gen_random_uuid()::text AS id,
  vault_id,
  account_key,
  COALESCE(account_label, 'Cartão') AS name,
  period_end,
  payment_date,
  box_id
FROM "_ci"
WHERE account_key IS NOT NULL
ORDER BY vault_id, account_key, period_end DESC NULLS LAST, payment_date DESC;
--> statement-breakpoint
INSERT INTO "_card"
SELECT DISTINCT ON (c.vault_id)
  gen_random_uuid()::text, c.vault_id, NULL, 'Cartão', NULL, c.payment_date, c.box_id
FROM "_ci" c
WHERE c.account_key IS NULL
  AND (SELECT count(*) FROM "_card" k WHERE k.vault_id = c.vault_id) <> 1
ORDER BY c.vault_id, c.payment_date DESC;
--> statement-breakpoint
UPDATE "_ci" SET card_id = k.id
FROM "_card" k
WHERE k.vault_id = "_ci".vault_id AND k.account_key = "_ci".account_key;
--> statement-breakpoint
UPDATE "_ci" SET card_id = (
  SELECT k.id FROM "_card" k
  WHERE k.vault_id = "_ci".vault_id
  ORDER BY (k.account_key IS NULL) DESC
  LIMIT 1
)
WHERE card_id IS NULL;
--> statement-breakpoint
INSERT INTO card (id, vault_id, name, closing_day, due_day, box_id, account_key, created_at)
SELECT
  id,
  vault_id,
  name,
  CASE WHEN period_end IS NOT NULL
    THEN extract(day FROM period_end)::int
    ELSE extract(day FROM payment_date - interval '7 days')::int END,
  CASE WHEN period_end IS NOT NULL
    THEN extract(day FROM period_end + interval '7 days')::int
    ELSE extract(day FROM payment_date)::int END,
  box_id,
  account_key,
  now() AT TIME ZONE 'UTC'
FROM "_card";
--> statement-breakpoint
INSERT INTO card_cycle (id, vault_id, card_id, period_start, closing_date, due_date, closed, created_at)
SELECT
  x.cycle_id,
  x.vault_id,
  x.card_id,
  CASE WHEN x.period_start IS NOT NULL AND x.period_start <= x.closing
    THEN x.period_start
    ELSE x.closing - interval '1 month' + interval '1 day' END,
  x.closing,
  CASE WHEN date_trunc('day', x.payment_date) > x.closing
    THEN date_trunc('day', x.payment_date)
    ELSE x.closing + interval '7 days' END,
  false,
  x.created_at
FROM (
  SELECT c.*, COALESCE(c.period_end, date_trunc('day', c.payment_date) - interval '7 days') AS closing
  FROM "_ci" c
) x;
--> statement-breakpoint
INSERT INTO card_payment (id, vault_id, invoice_id, box_id, amount, date, imported, import_entry_id, created_at)
SELECT invoice_id, vault_id, cycle_id, box_id, amount, payment_date, has_payment_line, NULL, created_at
FROM "_ci";
--> statement-breakpoint
-- A linha do extrato que registrou a fatura antiga apontava para o resto.
UPDATE card_payment p SET import_entry_id = e.id
FROM import_entry e
JOIN "transaction" t ON t.id = e.transaction_id
WHERE t.invoice_id = p.id AND t.purchase_date IS NULL AND p.import_entry_id IS NULL;
--> statement-breakpoint
UPDATE "transaction" t SET
  invoice_role = 'purchase',
  date = t.purchase_date,
  purchase_date = NULL,
  invoice_id = c.cycle_id,
  box_id = k.box_id
FROM "_ci" c
JOIN card k ON k.id = c.card_id
WHERE t.invoice_id = c.invoice_id AND t.purchase_date IS NOT NULL;
--> statement-breakpoint
-- O que ainda aponta para uma fatura antiga é o resto não discriminado.
DELETE FROM "transaction" t
USING "_ci" c
WHERE t.invoice_id = c.invoice_id AND t.invoice_role IS NULL;
--> statement-breakpoint
UPDATE import_batch b SET invoice_id = c.cycle_id
FROM "_ci" c
WHERE b.invoice_id = c.invoice_id;
--> statement-breakpoint
-- Fila de compras de cada cartão, em centavos: [s, e) acumulado na ordem
-- (fechamento do ciclo, data da compra, criação, id) — a mesma de allocateCard.
CREATE TEMP TABLE "_item" ON COMMIT DROP AS
SELECT
  t.id,
  k.card_id,
  sum(round(t.amount * 100)::bigint) OVER w - round(t.amount * 100)::bigint AS s,
  sum(round(t.amount * 100)::bigint) OVER w AS e
FROM "transaction" t
JOIN card_cycle k ON k.id = t.invoice_id
WHERE t.invoice_role = 'purchase'
  AND t.type = 'expense'
  AND round(t.amount * 100) > 0
  AND k.card_id IN (SELECT id FROM "_card")
WINDOW w AS (
  PARTITION BY k.card_id
  ORDER BY k.closing_date, t.date, t.created_at, t.id COLLATE "C"
  ROWS UNBOUNDED PRECEDING
);
--> statement-breakpoint
-- Fontes que cobrem a fila: estornos primeiro (não geram gasto), depois os
-- pagamentos em ordem de data.
CREATE TEMP TABLE "_source" ON COMMIT DROP AS
WITH src AS (
  SELECT k.card_id, NULL::text AS payment_id, round(t.amount * 100)::bigint AS cents,
    0 AS grp, k.closing_date AS k1, t.date AS k2, t.created_at AS k3, t.id AS k4
  FROM "transaction" t
  JOIN card_cycle k ON k.id = t.invoice_id
  WHERE t.invoice_role = 'purchase'
    AND t.type = 'income'
    AND round(t.amount * 100) > 0
    AND k.card_id IN (SELECT id FROM "_card")
  UNION ALL
  SELECT k.card_id, p.id, round(p.amount * 100)::bigint,
    1, p.date, p.date, p.created_at, p.id
  FROM card_payment p
  JOIN card_cycle k ON k.id = p.invoice_id
  WHERE round(p.amount * 100) > 0
    AND k.card_id IN (SELECT id FROM "_card")
)
SELECT
  card_id,
  payment_id,
  cents,
  sum(cents) OVER w - cents AS s,
  sum(cents) OVER w AS e
FROM src
WINDOW w AS (
  PARTITION BY card_id
  ORDER BY grp, k1, k2, k3, k4 COLLATE "C"
  ROWS UNBOUNDED PRECEDING
);
--> statement-breakpoint
-- Partes: a interseção de cada compra com cada pagamento.
INSERT INTO "transaction" (
  id, code, amount, type, category_id, vault_id, description, created_at,
  committed, date, box_id, transfer_id, allocation_id, withdrawal_type,
  invoice_id, purchase_date, invoice_role, source_transaction_id, payment_id
)
SELECT
  gen_random_uuid()::text,
  substr(md5(random()::text), 1, 4),
  (LEAST(i.e, s.e) - GREATEST(i.s, s.s))::double precision / 100,
  'expense',
  t.category_id,
  t.vault_id,
  t.description,
  now() AT TIME ZONE 'UTC',
  true,
  p.date,
  p.box_id,
  NULL,
  t.allocation_id,
  t.withdrawal_type,
  t.invoice_id,
  t.date,
  'part',
  t.id,
  p.id
FROM "_item" i
JOIN "_source" s
  ON s.card_id = i.card_id
  AND s.payment_id IS NOT NULL
  AND LEAST(i.e, s.e) > GREATEST(i.s, s.s)
JOIN "transaction" t ON t.id = i.id
JOIN card_payment p ON p.id = s.payment_id;
--> statement-breakpoint
-- Não discriminado: o que cada pagamento pagou além das compras.
INSERT INTO "transaction" (
  id, code, amount, type, category_id, vault_id, description, created_at,
  committed, date, box_id, transfer_id, allocation_id, withdrawal_type,
  invoice_id, purchase_date, invoice_role, source_transaction_id, payment_id
)
SELECT
  gen_random_uuid()::text,
  substr(md5(random()::text), 1, 4),
  (s.cents - cov.covered)::double precision / 100,
  'expense',
  NULL,
  p.vault_id,
  'Fatura ' || k.name || ' · não discriminado',
  now() AT TIME ZONE 'UTC',
  true,
  p.date,
  p.box_id,
  NULL,
  NULL,
  NULL,
  p.invoice_id,
  NULL,
  'remainder',
  NULL,
  p.id
FROM "_source" s
JOIN card_payment p ON p.id = s.payment_id
JOIN card_cycle c ON c.id = p.invoice_id
JOIN card k ON k.id = c.card_id
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(LEAST(i.e, s.e) - GREATEST(i.s, s.s)), 0) AS covered
  FROM "_item" i
  WHERE i.card_id = s.card_id AND LEAST(i.e, s.e) > GREATEST(i.s, s.s)
) cov
WHERE s.payment_id IS NOT NULL AND s.cents - cov.covered > 0;
