-- AlterTable
ALTER TABLE `Item` MODIFY `parentId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
