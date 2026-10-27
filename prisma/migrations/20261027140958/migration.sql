-- A ranging tier's figure is a rate per unit sold, not a lump sum, so
-- `RangingDiscount.amount` becomes `rate`.
--
-- Renamed rather than dropped and re-added, so tiers already written keep
-- their figures. Idempotent: a database that already has `rate` is left
-- alone, which is why this is wrapped in a prepared statement rather than a
-- plain ALTER.

SET @hasAmount := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RangingDiscount' AND COLUMN_NAME = 'amount'
);
SET @hasRate := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RangingDiscount' AND COLUMN_NAME = 'rate'
);

SET @rename := IF(
  @hasAmount = 1 AND @hasRate = 0,
  'ALTER TABLE `RangingDiscount` CHANGE COLUMN `amount` `rate` DECIMAL(12, 1) NOT NULL',
  'DO 0'
);
PREPARE renameRate FROM @rename;
EXECUTE renameRate;
DEALLOCATE PREPARE renameRate;

-- Neither column present at all would mean a database this feature never
-- reached; the column is added so the schema still matches.
SET @add := IF(
  @hasAmount = 0 AND @hasRate = 0,
  'ALTER TABLE `RangingDiscount` ADD COLUMN `rate` DECIMAL(12, 1) NOT NULL DEFAULT 0.0',
  'DO 0'
);
PREPARE addRate FROM @add;
EXECUTE addRate;
DEALLOCATE PREPARE addRate;
