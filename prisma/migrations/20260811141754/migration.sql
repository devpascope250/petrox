-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
