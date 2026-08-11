-- DropForeignKey
ALTER TABLE `Item` DROP FOREIGN KEY `Item_baseUnitId_fkey`;

-- DropIndex
DROP INDEX `Item_baseUnitId_fkey` ON `Item`;

-- AlterTable
ALTER TABLE `Item` MODIFY `baseUnitId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_baseUnitId_fkey` FOREIGN KEY (`baseUnitId`) REFERENCES `Unit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
