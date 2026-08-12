-- AlterTable
ALTER TABLE `OrderPlan` MODIFY `status` ENUM('active', 'closed', 'terminated', 'force_closed') NOT NULL DEFAULT 'active';
