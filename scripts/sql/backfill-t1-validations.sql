-- ---------------------------------------------------------------------------
-- Raise the missing T1 validations from the nominations themselves.
--
-- One row per nomination that has none, taking `quantityAt20C` from the
-- nomination's own `ambQuantity` — which is the sum of the vessels it loads
-- from — instead of having it typed again.
--
-- Nothing in the application changes. This is a repair, run by hand, on rows
-- that are already there.
--
--   HOW TO RUN
--     mysql -u <user> -p <database> < scripts/sql/backfill-t1-validations.sql
--
--   or paste the steps one at a time into a client. **Step 1 first, always.**
--
--   WHAT YOU MUST SET
--     @country — `exportingCountry` is NOT NULL with no default, so every row
--                needs one. If your trips come from more than one country,
--                run this once per country with a scope that matches.
--     @scope   — which nominations to touch. Left as 1=1 it takes every
--                nomination with no T1 at all, which is almost never what you
--                want on production. Narrow it.
--
--   WHAT IT WILL NOT DO
--     - It will not touch a nomination that already has a T1. `nominationId`
--       is unique on `T1Validation`, and the `NOT EXISTS` keeps the insert
--       from failing on the whole batch because of one row.
--     - It will not write a T1 for a nomination carrying nothing.
--       `quantityAt20C` is NOT NULL DEFAULT 0.00, so a nomination with no
--       vessels would silently produce a T1 for zero litres — and a receipt
--       measured against zero reads as a total loss.
--     - It does not touch `CentralStock`. Stock moves only when a receipt is
--       recorded, and a T1 on its own moves nothing.
--
--   ⚠️ `ambQuantity` is an **ambient** volume and `quantityAt20C` is read
--      everywhere as a 20 °C one. These rows will therefore show no loss or
--      gain against a receipt that carries the same figure. That is the known
--      state of this data, not something this script introduces.
-- ---------------------------------------------------------------------------

-- Stamped on every row written by this run, so step 6 can undo exactly it.
SET @run     = NOW(3);
SET @country = 'Tanzania';


-- 1 ---------------------------------------------------------------- LOOK ---
-- What would be written. Run this on its own and read it before step 2.
SELECT
  n.id                         AS nominationId,
  n.destination,
  n.ambQuantity                AS quantityToWrite,
  v.platNumber,
  v.trailerNumber,
  v.tankCapacity,
  -- The fingerprint of the bad habit: a nomination that is exactly the
  -- truck's tank. Look at these before writing anything.
  IF(n.ambQuantity = v.tankCapacity, 'EQUALS TANK CAPACITY', '')     AS warning,
  (SELECT COUNT(*) FROM NominationVessel nv WHERE nv.nominationId = n.id) AS vessels,
  (SELECT s.status FROM NominationTimeLine tl
     JOIN NominationTimeLineStatus s ON s.id = tl.timeLineStatusId
    WHERE tl.nominationId = n.id ORDER BY s.level DESC LIMIT 1)      AS furthestStage,
  n.createdAt
FROM Nomination n
JOIN DriverVehicles dv ON dv.id = n.driverVehicleId
JOIN Vehicle        v  ON v.id  = dv.vehicleId
WHERE NOT EXISTS (SELECT 1 FROM T1Validation t WHERE t.nominationId = n.id)
  AND n.ambQuantity > 0
  -- @scope: narrow this. Examples —
  --   AND n.createdAt >= '2026-10-01'
  --   AND n.id IN ('…', '…')
  --   AND n.destination = 'Kigali'
  AND 1 = 1
ORDER BY n.createdAt;


-- 2 -------------------------------------------------------------- INSERT ---
-- The same WHERE as step 1. Keep the two in step if you edit one.
INSERT INTO T1Validation
  (id, nominationId, exportingCountry, quantityAt20C, supportingDocUrl, createdAt, updatedAt)
SELECT
  UUID(),          -- `id` has no database default, Prisma generates it in code
  n.id,
  @country,
  n.ambQuantity,   -- the figure travels instead of being typed again
  NULL,
  @run,
  @run             -- `updatedAt` has no default either
FROM Nomination n
WHERE NOT EXISTS (SELECT 1 FROM T1Validation t WHERE t.nominationId = n.id)
  AND n.ambQuantity > 0
  AND 1 = 1;       -- @scope: the same clause as step 1


-- 3 ------------------------------------------------- TIMELINE (optional) ---
-- The app stamps `t1Pending` when it raises a T1. This does the same for the
-- rows just written, and only for a trip that has not already climbed past it
-- — the ladder is a ladder, and a level 3 rung stamped after level 5 reads as
-- nonsense however the history is sorted.
INSERT INTO NominationTimeLine (id, nominationId, timeLineStatusId, changedBy, createdAt)
SELECT UUID(), t.nominationId, s.id, NULL, @run
FROM T1Validation t
JOIN NominationTimeLineStatus s ON s.status = 't1Pending'
WHERE t.createdAt = @run
  AND NOT EXISTS (
    SELECT 1 FROM NominationTimeLine tl
      JOIN NominationTimeLineStatus ls ON ls.id = tl.timeLineStatusId
     WHERE tl.nominationId = t.nominationId
       AND ls.level >= s.level
  );


-- 4 --------------------------------------------- CUSTOMS CHECK (optional) ---
-- The form always raises one customs check with the T1. Leave this out if the
-- office differs per trip and you would rather enter them on the screen.
-- SET @office = 'Rusumo';
-- INSERT INTO ExtraT1Validation (id, t1ValidationId, customOffice, status, createdAt, updatedAt)
-- SELECT UUID(), t.id, @office, 'pending', @run, @run
-- FROM T1Validation t
-- WHERE t.createdAt = @run
--   AND NOT EXISTS (SELECT 1 FROM ExtraT1Validation e WHERE e.t1ValidationId = t.id);


-- 5 ---------------------------------------------------------------- CHECK ---
-- **Write this stamp down.** `@run` is a session variable: it is gone the
-- moment you close the client, and the undo in step 6 needs its value.
SELECT @run AS runStamp;

SELECT COUNT(*) AS t1sWritten        FROM T1Validation      WHERE createdAt = @run;
SELECT COUNT(*) AS rungsWritten      FROM NominationTimeLine WHERE createdAt = @run;
SELECT COUNT(*) AS nominationsLeft
FROM Nomination n
WHERE NOT EXISTS (SELECT 1 FROM T1Validation t WHERE t.nominationId = n.id)
  AND n.ambQuantity > 0;


-- 6 ----------------------------------------------------------------- UNDO ---
-- Only if nothing has been built on the new rows — a receipt recorded against
-- one of these T1s cannot be undone from here.
--
-- Paste the stamp from step 5 in place of the date below. `@run` itself is no
-- use in a new session: it is empty there, and these deletes would match
-- nothing (or, worse, be edited into something that matches everything).
-- DELETE FROM NominationTimeLine WHERE createdAt = '2026-11-12 09:00:00.000';
-- DELETE FROM ExtraT1Validation  WHERE createdAt = '2026-11-12 09:00:00.000';
-- DELETE FROM T1Validation       WHERE createdAt = '2026-11-12 09:00:00.000';
