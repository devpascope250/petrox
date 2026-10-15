-- CreateTable
CREATE TABLE `Backup` (
    `id` VARCHAR(191) NOT NULL,
    `status` ENUM('queued', 'running', 'completed', 'failed', 'expired') NOT NULL DEFAULT 'queued',
    `trigger` ENUM('manual', 'scheduled') NOT NULL DEFAULT 'manual',
    `fileName` VARCHAR(191) NULL,
    `sizeBytes` BIGINT NULL,
    `sha256` CHAR(64) NULL,
    `keyId` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `downloadCount` INTEGER NOT NULL DEFAULT 0,
    `lastDownloadedAt` DATETIME(3) NULL,
    `lastDownloadedBy` VARCHAR(191) NULL,

    INDEX `Backup_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Backup_createdBy_idx`(`createdBy`),
    INDEX `Backup_lastDownloadedBy_idx`(`lastDownloadedBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Backup` ADD CONSTRAINT `Backup_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Backup` ADD CONSTRAINT `Backup_lastDownloadedBy_fkey` FOREIGN KEY (`lastDownloadedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

