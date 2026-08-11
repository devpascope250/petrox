-- AlterTable
ALTER TABLE `Item` ADD COLUMN `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE `ItemUnit` ADD COLUMN `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE `Supplier` ADD COLUMN `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE `SupplierType` ADD COLUMN `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE `Unit` ADD COLUMN `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active';
