-- An optional name on an order.
--
-- `orderCode` stays the identifier and stays generated; this is what people
-- call the order among themselves, and what they search for when the code is
-- no help. Nullable, so every order already on record is untouched.
--
-- Written so it can be run again after a part-way failure — MySQL has no
-- transactional DDL, so the step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'name') = 0,
  'ALTER TABLE `orders` ADD COLUMN `name` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
