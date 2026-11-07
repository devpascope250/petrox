-- Departments, the offices under them, and the office a user sits in.
--
-- The office goes on the **user**, not on the role: two accountants in two
-- offices share one role, and `Role.name` is unique with the permissions
-- hanging off it, so an office on the role would mean a cloned role — and a
-- cloned permission set — per office. It mirrors `User.siteId`, the other
-- "where this person works" field.
--
-- `officeId` is nullable because every user already on record predates it, and
-- `ON DELETE SET NULL` so removing an office never takes staff with it.
--
-- A user carries no `departmentId`: the department is reachable through the
-- office, and a second path to the same fact is one that can disagree.
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

CREATE TABLE IF NOT EXISTS `CompanyDepartment` (
    `id` VARCHAR(191) NOT NULL,
    `departmentName` VARCHAR(191) NOT NULL,
    `departmentCode` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CompanyDepartment_departmentCode_key`(`departmentCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `CompanyOffice` (
    `id` VARCHAR(191) NOT NULL,
    `officeName` VARCHAR(191) NOT NULL,
    `officeCode` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CompanyOffice_officeCode_key`(`officeCode`),
    INDEX `CompanyOffice_departmentId_idx`(`departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CompanyOffice'
      AND CONSTRAINT_NAME = 'CompanyOffice_departmentId_fkey') = 0,
  'ALTER TABLE `CompanyOffice` ADD CONSTRAINT `CompanyOffice_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `CompanyDepartment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND COLUMN_NAME = 'officeId') = 0,
  'ALTER TABLE `User` ADD COLUMN `officeId` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND INDEX_NAME = 'User_officeId_idx') = 0,
  'CREATE INDEX `User_officeId_idx` ON `User`(`officeId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User'
      AND CONSTRAINT_NAME = 'User_officeId_fkey') = 0,
  'ALTER TABLE `User` ADD CONSTRAINT `User_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `CompanyOffice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
