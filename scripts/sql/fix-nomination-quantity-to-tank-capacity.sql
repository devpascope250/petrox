-- ---------------------------------------------------------------------------
-- Set each nomination's quantity to the tank capacity of the truck it is on.
--
-- A trip carries a truckload, so the figure on the nomination should be what
-- that truck holds. Where it is not, this puts it right — on the nomination
-- **and on its vessel line**, which is the part that matters.
--
--   HOW TO RUN
--     Step 0 and step 1 first, and read step 1 before anything else.
--     mysql -u <user> -p -h <host> <database> --table < this-file.sql
--
--   ⚠️ READ THIS BEFORE THE T1 BACKFILL
--     `backfill-t1-validations.sql` copies `Nomination.ambQuantity` into
--     `T1Validation.quantityAt20C`. Run **this** script first, or those T1s
--     are written from the figures you are about to correct. If the backfill
--     has already run, step 4 below corrects the T1s it wrote — but only the
--     ones that still carry the old figure untouched by hand.
--
--   ⚠️ WHY THE VESSEL LINE TOO
--     The application holds `Nomination.ambQuantity` as the **sum of its
--     vessel lines**, and recomputes it on every save:
--         ambQuantity: this.totalQuantity(data.vessels)
--     Correct the header alone and the next person to edit that nomination
--     silently puts the old figure back. So both move, together.
--
--   WHAT IT LEAVES ALONE
--     - A nomination that already matches its truck.
--     - A nomination with anything other than exactly one vessel line:
--       splitting a truckload across two batches is a decision about which
--       fuel went on the truck, and no script should guess it. Step 5 lists
--       them for you.
--     - A line whose batch cannot spare the extra litres — raising a draw
--       beyond what the stock still has would oversell it. Step 5 lists these
--       as well.
--     - `CentralStock`. Receipts already written are not corrected here;
--       those are a reconciliation, not an update.
-- ---------------------------------------------------------------------------

SET @run = NOW(3);


-- 0 --------------------------------------------------------------- BACKUP ---
-- An UPDATE has no undo of its own, so the old figures are kept first. Drop
-- this table once you are satisfied — it is not part of the schema.
CREATE TABLE IF NOT EXISTS zz_nomination_quantity_backup (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  runAt           DATETIME(3)    NOT NULL,
  nominationId    VARCHAR(191)   NOT NULL,
  vesselId        VARCHAR(191)   NULL,
  oldNominationQty DECIMAL(18,2) NOT NULL,
  oldVesselQty    DECIMAL(18,2)  NULL,
  newQty          DECIMAL(18,2)  NOT NULL,
  oldT1Qty        DECIMAL(18,2)  NULL,
  INDEX (runAt),
  INDEX (nominationId)
)
-- The same collation the application's tables were created with. Without it
-- the table takes the server default, and every join from this table to an
-- app table fails with "Illegal mix of collations".
DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- 1 ------------------------------------------------------------------ LOOK ---
-- What would change, and what would be skipped. Read this first.
SELECT
  n.id            AS nominationId,
  n.destination,
  n.ambQuantity   AS currentQty,
  v.tankCapacity  AS newQty,
  v.platNumber,
  v.trailerNumber,
  (SELECT COUNT(*) FROM NominationVessel c WHERE c.nominationId = n.id)        AS vessels,
  (SELECT t.quantityAt20C FROM T1Validation t WHERE t.nominationId = n.id)     AS t1Qty,
  CASE
    /*
     * Counted per nomination with a subquery, not with GROUP BY: grouping by
     * the vessel's own columns gives a two-vessel nomination two rows, each
     * reporting a count of one, and the test below never fires.
     */
    WHEN (SELECT COUNT(*) FROM NominationVessel c WHERE c.nominationId = n.id) <> 1
      THEN 'SKIPPED: not exactly one vessel'
    /* What the batch could still give this line, if the draw were raised. */
    WHEN v.tankCapacity > (
      SELECT s.quantity
           - (SELECT COALESCE(SUM(o.ambQuantity), 0)
                FROM NominationVessel o WHERE o.stockId = nv.stockId)
           + nv.ambQuantity
        FROM NominationVessel nv
        JOIN Stock s ON s.id = nv.stockId
       WHERE nv.nominationId = n.id
       LIMIT 1)
      THEN 'SKIPPED: the batch cannot spare the extra litres'
    ELSE 'will be corrected'
  END             AS verdict
FROM Nomination n
JOIN DriverVehicles dv ON dv.id = n.driverVehicleId
JOIN Vehicle        v  ON v.id  = dv.vehicleId
WHERE n.ambQuantity <> v.tankCapacity
  -- @scope: narrow this. Examples —
  --   AND n.createdAt >= '2026-10-01'
  --   AND n.id IN ('…', '…')
  AND 1 = 1
ORDER BY n.createdAt;


-- 2 --------------------------------------------------------------- RECORD ---
-- The old figures, for exactly the rows step 3 is about to change.
INSERT INTO zz_nomination_quantity_backup
  (runAt, nominationId, vesselId, oldNominationQty, oldVesselQty, newQty, oldT1Qty)
SELECT @run, n.id, nv.id, n.ambQuantity, nv.ambQuantity, v.tankCapacity, t.quantityAt20C
FROM Nomination n
JOIN DriverVehicles  dv ON dv.id = n.driverVehicleId
JOIN Vehicle         v  ON v.id  = dv.vehicleId
JOIN NominationVessel nv ON nv.nominationId = n.id
JOIN Stock            s  ON s.id = nv.stockId
LEFT JOIN T1Validation t ON t.nominationId = n.id
WHERE n.ambQuantity <> v.tankCapacity
  AND 1 = (SELECT COUNT(*) FROM NominationVessel c WHERE c.nominationId = n.id)
  AND v.tankCapacity <= s.quantity
      - (SELECT COALESCE(SUM(o.ambQuantity), 0) FROM NominationVessel o WHERE o.stockId = nv.stockId)
      + nv.ambQuantity
  AND 1 = 1;       -- @scope: the same clause as step 1


-- 3 --------------------------------------------------------------- UPDATE ---
-- The line and the header together, from the backup written a moment ago, so
-- the two cannot drift apart and the rows changed are exactly the rows kept.
UPDATE NominationVessel nv
JOIN zz_nomination_quantity_backup b ON b.vesselId = nv.id AND b.runAt = @run
SET nv.ambQuantity = b.newQty;

UPDATE Nomination n
JOIN zz_nomination_quantity_backup b ON b.nominationId = n.id AND b.runAt = @run
SET n.ambQuantity = b.newQty, n.updatedAt = @run;


-- 4 ---------------------------------------------------- T1s (conditional) ---
-- Only if `backfill-t1-validations.sql` has already run. A T1 still carrying
-- the nomination's **old** figure was written from it, so it follows the
-- correction. One that carries anything else was entered by a person from the
-- customs document and is left exactly as it is.
UPDATE T1Validation t
JOIN zz_nomination_quantity_backup b ON b.nominationId = t.nominationId AND b.runAt = @run
SET t.quantityAt20C = b.newQty, t.updatedAt = @run
WHERE t.quantityAt20C = b.oldNominationQty;


-- 5 ----------------------------------------------------------------- LEFT ---
-- What was not corrected, and why. These need a person.
SELECT
  n.id            AS nominationId,
  n.destination,
  n.ambQuantity   AS currentQty,
  v.tankCapacity  AS truckHolds,
  (SELECT COUNT(*) FROM NominationVessel c WHERE c.nominationId = n.id) AS vessels,
  'needs a decision about which batch the truckload came from'          AS why
FROM Nomination n
JOIN DriverVehicles dv ON dv.id = n.driverVehicleId
JOIN Vehicle        v  ON v.id  = dv.vehicleId
WHERE n.ambQuantity <> v.tankCapacity
  AND NOT EXISTS (SELECT 1 FROM zz_nomination_quantity_backup b
                   WHERE b.nominationId = n.id AND b.runAt = @run)
  AND 1 = 1;       -- @scope: the same clause as step 1


-- 6 ---------------------------------------------------------------- CHECK ---
-- Write this stamp down: `@run` is a session variable and the undo needs it.
SELECT @run AS runStamp;
SELECT COUNT(*) AS nominationsCorrected FROM zz_nomination_quantity_backup WHERE runAt = @run;
SELECT COUNT(*) AS stillMismatched
FROM Nomination n
JOIN DriverVehicles dv ON dv.id = n.driverVehicleId
JOIN Vehicle        v  ON v.id  = dv.vehicleId
WHERE n.ambQuantity <> v.tankCapacity;


-- 7 ----------------------------------------------------------------- UNDO ---
-- Paste the stamp from step 6 in place of the date. Puts back every figure
-- this run changed, including the T1s it touched.
-- UPDATE NominationVessel nv
--   JOIN zz_nomination_quantity_backup b ON b.vesselId = nv.id
--   SET nv.ambQuantity = b.oldVesselQty
--   WHERE b.runAt = '2026-11-12 09:00:00.000';
-- UPDATE Nomination n
--   JOIN zz_nomination_quantity_backup b ON b.nominationId = n.id
--   SET n.ambQuantity = b.oldNominationQty
--   WHERE b.runAt = '2026-11-12 09:00:00.000';
-- UPDATE T1Validation t
--   JOIN zz_nomination_quantity_backup b ON b.nominationId = t.nominationId
--   SET t.quantityAt20C = b.oldT1Qty
--   WHERE b.runAt = '2026-11-12 09:00:00.000' AND b.oldT1Qty IS NOT NULL
--     AND t.quantityAt20C = b.newQty;
