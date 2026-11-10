-- A login waiting on its emailed code.
--
-- A password alone no longer signs anyone in: the password is checked, a row
-- is written here, and a six-digit code goes to the address on the account.
-- Only the HMAC of the code is kept, with the same secret a PIN uses, so a
-- dump of this table hands nobody a working code. `attempts` is what stops a
-- six-digit code from simply being guessed.
--
-- Purely additive: one new table, nothing dropped and no existing row changed.
-- Written so it can be run again after a part-way failure — MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

CREATE TABLE IF NOT EXISTS `LoginOtp` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `codeHash` VARCHAR(191) NOT NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `usedAt` DATETIME(3) NULL,
  INDEX `LoginOtp_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'LoginOtp'
      AND CONSTRAINT_NAME = 'LoginOtp_userId_fkey') = 0,
  'ALTER TABLE `LoginOtp` ADD CONSTRAINT `LoginOtp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
