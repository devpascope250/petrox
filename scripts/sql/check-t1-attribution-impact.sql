-- Which T1 rows already on record change figure under T1 attribution?
--
-- Run this on production BEFORE deploying. If it returns no rows, the new rule
-- moves nothing: every figure the stock report gives today it will give after.
--
-- Background. A T1 that names a shipment (`T1Validation.cargoId`) is now drawn
-- off that shipment alone, instead of being spread across every batch the trip
-- loaded from in proportion to what each drew. That is what makes "this truck
-- topped up from another cargo" true in the figures rather than approximately
-- true. Only one shape of existing row can be read differently by it:
--
--   * names no cargo              -> spread, exactly as before. Every row
--                                    raised before `cargoId` existed is one.
--   * names a cargo the trip has
--     no vessel line on           -> still spread: there is no line to draw
--                                    off, and naming a cargo does not put the
--                                    trip on it.
--   * on a trip with ONE line     -> one line gets the whole figure either
--                                    way. Same answer.
--   * names a cargo that IS one
--     of several lines            -> ** this one changes **, and the new figure
--                                    is the truer one: the litres go to the
--                                    shipment the document names rather than
--                                    being smeared over the others.
--
-- Read only. It changes nothing.

SELECT
  t.id                                   AS t1_id,
  t.sdReference                          AS declaration,
  t.quantityAt20C                        AS t1_litres_at_20c,
  c.vesselName                           AS names_vessel,
  c.blRef                                AS names_bl,
  n.id                                   AS nomination_id,
  n.destination                          AS trip,
  (SELECT COUNT(*) FROM `NominationVessel` nv
     WHERE nv.nominationId = n.id)       AS vessel_lines_on_trip
FROM `T1Validation` t
JOIN `Nomination` n ON n.id = t.nominationId
JOIN `Cargo`      c ON c.id = t.cargoId
WHERE t.cargoId IS NOT NULL
  -- More than one batch to spread across, or there was nothing to spread.
  AND (SELECT COUNT(*) FROM `NominationVessel` nv
         WHERE nv.nominationId = n.id) > 1
  -- And the shipment it names is actually one of them.
  AND EXISTS (
    SELECT 1
    FROM `NominationVessel` nv
    JOIN `Stock` s ON s.id = nv.stockId
    WHERE nv.nominationId = n.id
      AND s.cargoId = t.cargoId
  )
ORDER BY t.createdAt DESC;
