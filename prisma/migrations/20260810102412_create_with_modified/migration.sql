/*
  Warnings:

  - A unique constraint covering the columns `[unitId,itemId]` on the table `ItemUnit` will be added. If there are existing duplicate values, this will fail.
  - Made the column `baseUnitId` on table `Item` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `Item` DROP FOREIGN KEY `Item_baseUnitId_fkey`;

-- DropIndex
DROP INDEX `Item_baseUnitId_fkey` ON `Item`;

-- AlterTable
ALTER TABLE `Item` MODIFY `baseUnitId` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `ItemUnit_unitId_itemId_key` ON `ItemUnit`(`unitId`, `itemId`);

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_baseUnitId_fkey` FOREIGN KEY (`baseUnitId`) REFERENCES `Unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
