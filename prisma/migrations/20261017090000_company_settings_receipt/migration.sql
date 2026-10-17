-- Receipt details for the company profile printed on POS receipts.
ALTER TABLE `CompanySettings` ADD COLUMN `receiptFooter` VARCHAR(255) NULL,
    ADD COLUMN `website` VARCHAR(191) NULL;
