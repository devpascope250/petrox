-- User.siteId becomes a real relation to the site they work at now.
-- Fails if a user points at a site that does not exist: clear or fix those first.

-- CreateIndex
CREATE INDEX `User_siteId_idx` ON `User`(`siteId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
