-- `CentralStock.stockId` is a column no migration in this repository creates,
-- left on databases built before a receipt reached its stock through the
-- nomination chain (`CentralStock → T1Validation → Nomination →
-- NominationVessel → Stock`). Where it survives as `NOT NULL` with no
-- default, every `centralStock.create()` fails with
-- `P2011 Null constraint violation on the fields: (stockId)`, because the
-- schema has no such field and so never sends one.
--
-- It is made **nullable rather than dropped**: whatever is in it on those
-- databases is kept, and nothing invents a value for it — one receipt can draw
-- on several stocks through its nomination, so there is no single right
-- answer. Dropping it, once it is confirmed unused, is a later decision.
--
-- Does nothing where the column was never there, which is every database built
-- from these migrations.

SET @columnType = (
  SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CentralStock'
    AND COLUMN_NAME = 'stockId' AND IS_NULLABLE = 'NO'
);

-- The column's own type is carried over, so making it optional is the only
-- change: a hard-coded type here could silently widen or narrow it.
SET @sql = IF(
  @columnType IS NULL,
  'DO 0',
  CONCAT('ALTER TABLE `CentralStock` MODIFY `stockId` ', @columnType, ' NULL')
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
