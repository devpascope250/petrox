-- Many T1 validations per nomination, and the declaration reference on each.
--
-- A trip may be cleared on more than one transit document — a load split
-- across declarations, or a second raised after a correction — so the unique
-- index that allowed only one goes. What a trip took out of a batch is the
-- **sum** of its T1s from here on, not the first of them.
--
-- `sdReference` is the reference on the customs declaration. Nullable: every
-- row already on record predates it.
--
-- Purely additive in effect — dropping a uniqueness constraint forbids
-- nothing that was allowed before, and no existing row changes. Written so it
-- can be run again after a part-way failure: MySQL has no transactional DDL,
-- so each step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'T1Validation' AND COLUMN_NAME = 'sdReference') = 0,
  'ALTER TABLE `T1Validation` ADD COLUMN `sdReference` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- The plain index stays: `nominationId` is still how a trip's T1s are found,
-- and dropping the unique one would otherwise leave the column unindexed.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'T1Validation'
      AND INDEX_NAME = 'T1Validation_nominationId_idx') = 0,
  'CREATE INDEX `T1Validation_nominationId_idx` ON `T1Validation`(`nominationId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'T1Validation'
      AND INDEX_NAME = 'T1Validation_nominationId_key') > 0,
  'DROP INDEX `T1Validation_nominationId_key` ON `T1Validation`',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
