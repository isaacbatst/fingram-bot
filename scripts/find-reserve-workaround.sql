-- Finds uses of a Reserva recorded with the old workaround: a transfer INTO
-- the Reserva's linked estrato, followed by a realization/withdrawal of the
-- same amount in that estrato. The pair of transfers is spurious: the plan
-- counts it as a contribution, and the Reserva estrato ends up with the
-- money that was already spent.
--
-- Correct state (same as "É uso de uma Reserva" in the import triage): only
-- the realization in the Reserva estrato. The fix for each row is to delete
-- the transfer (both sides), keeping the realization.
--
-- Read-only. Run with: psql "$DATABASE_URL" -f scripts/find-reserve-workaround.sql
WITH reserva AS (
  SELECT a.id AS allocation_id, a.label, a.estrato_id, p.vault_id
  FROM allocation a
  JOIN plan p ON p.id = a.plan_id
  WHERE a.estrato_id IS NOT NULL
    AND a.realization_mode <> 'immediate'
),
transfer_in AS (
  SELECT r.vault_id, r.allocation_id, r.label, r.estrato_id,
         t_in.transfer_id, t_in.amount, t_in.date,
         t_out.id AS transfer_out_id, t_out.box_id AS from_box_id,
         ie.id AS import_entry_id, ie.description AS import_description
  FROM reserva r
  JOIN "transaction" t_in
    ON t_in.box_id = r.estrato_id
   AND t_in.type = 'income'
   AND t_in.transfer_id IS NOT NULL
  JOIN "transaction" t_out
    ON t_out.transfer_id = t_in.transfer_id
   AND t_out.type = 'expense'
  LEFT JOIN import_entry ie ON ie.transaction_id = t_out.id
)
SELECT ti.vault_id,
       ti.label AS reserva,
       to_char(ti.date, 'YYYY-MM-DD') AS transfer_date,
       ti.amount,
       ti.transfer_id,
       CASE WHEN ti.import_entry_id IS NULL THEN 'manual' ELSE 'import' END
         AS transfer_origin,
       ti.import_description,
       rz.id AS realization_id,
       to_char(rz.date, 'YYYY-MM-DD') AS realization_date,
       rz.withdrawal_type,
       rz.description AS realization_description
FROM transfer_in ti
JOIN "transaction" rz
  ON rz.allocation_id = ti.allocation_id
 AND rz.type = 'expense'
 AND rz.withdrawal_type IS NOT NULL
 AND rz.box_id = ti.estrato_id
 AND rz.amount = ti.amount
 AND rz.date BETWEEN ti.date - INTERVAL '3 days' AND ti.date + INTERVAL '60 days'
ORDER BY ti.vault_id, ti.date;
