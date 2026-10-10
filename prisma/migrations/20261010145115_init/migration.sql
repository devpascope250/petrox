-- CreateTable
CREATE TABLE `Role` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isFixed` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Role_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompanySettings` (
    `id` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NOT NULL DEFAULT '',
    `address` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `taxId` VARCHAR(191) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `logoPath` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Module` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `icon` VARCHAR(191) NULL,
    `code` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `sorting` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Module_code_key`(`code`),
    INDEX `Module_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` VARCHAR(191) NOT NULL,
    `moduleId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Permission_code_key`(`code`),
    INDEX `Permission_moduleId_idx`(`moduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermissions` (
    `id` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,

    INDEX `RolePermissions_roleId_idx`(`roleId`),
    INDEX `RolePermissions_permissionId_idx`(`permissionId`),
    UNIQUE INDEX `RolePermissions_roleId_permissionId_key`(`roleId`, `permissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `pinHash` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `roleId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `siteId` VARCHAR(191) NULL,
    `position` ENUM('superAdmin', 'siteManager', 'clientAdmin', 'clientUser', 'others') NOT NULL DEFAULT 'siteManager',

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_roleId_idx`(`roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Client` (
    `id` VARCHAR(191) NOT NULL,
    `clientCode` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `idTino` VARCHAR(191) NULL,
    `province` VARCHAR(191) NULL,
    `district` VARCHAR(191) NULL,
    `sector` VARCHAR(191) NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `subsidyAllowed` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `Client_clientCode_key`(`clientCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `RefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `RefreshToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordResetToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PasswordResetToken_tokenHash_key`(`tokenHash`),
    INDEX `PasswordResetToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Item` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `descriptions` VARCHAR(191) NULL,
    `parentId` VARCHAR(191) NULL,
    `baseUnitId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    INDEX `Item_id_idx`(`id`),
    INDEX `Item_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Unit` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    INDEX `Unit_id_idx`(`id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ItemUnit` (
    `id` VARCHAR(191) NOT NULL,
    `unitId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `factorialValue` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    INDEX `ItemUnit_id_idx`(`id`),
    INDEX `ItemUnit_unitId_idx`(`unitId`),
    INDEX `ItemUnit_itemId_idx`(`itemId`),
    UNIQUE INDEX `ItemUnit_unitId_itemId_key`(`unitId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ItemPrice` (
    `id` VARCHAR(191) NOT NULL,
    `itemUnitId` VARCHAR(191) NOT NULL,
    `price` DECIMAL(18, 2) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Supplier` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `tinNumber` VARCHAR(191) NULL,
    `supplierTypeId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    INDEX `Supplier_id_idx`(`id`),
    INDEX `Supplier_supplierTypeId_idx`(`supplierTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierType` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    INDEX `SupplierType_id_idx`(`id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderPlan` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `status` ENUM('active', 'closed', 'terminated', 'force_closed') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `OrderPlan_id_idx`(`id`),
    INDEX `OrderPlan_startDate_endDate_idx`(`startDate`, `endDate`),
    INDEX `OrderPlan_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` VARCHAR(191) NOT NULL,
    `orderCode` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `orderDate` DATETIME(3) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `orderPlanId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_orderCode_key`(`orderCode`),
    INDEX `orders_id_idx`(`id`),
    INDEX `orders_orderCode_idx`(`orderCode`),
    INDEX `orders_supplierId_idx`(`supplierId`),
    INDEX `orders_createdByUserId_idx`(`createdByUserId`),
    INDEX `orders_orderPlanId_idx`(`orderPlanId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Deport` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('local', 'foreign', 'international') NOT NULL DEFAULT 'local',
    `location` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Deport_id_idx`(`id`),
    INDEX `Deport_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transporter` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `tinNumber` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Transporter_id_idx`(`id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Vehicle` (
    `id` VARCHAR(191) NOT NULL,
    `platNumber` VARCHAR(191) NOT NULL,
    `transporterId` VARCHAR(191) NOT NULL,
    `truckNumber` VARCHAR(191) NOT NULL,
    `trailerNumber` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `tankCapacity` DECIMAL(18, 2) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Vehicle_id_idx`(`id`),
    INDEX `Vehicle_transporterId_idx`(`transporterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Driver` (
    `id` VARCHAR(191) NOT NULL,
    `names` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `lisence` VARCHAR(191) NOT NULL,
    `passport` VARCHAR(191) NOT NULL,
    `transporterId` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Driver_id_idx`(`id`),
    INDEX `Driver_transporterId_idx`(`transporterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DriverVehicles` (
    `id` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive', 'occupied') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DriverVehicles_driverId_idx`(`driverId`),
    INDEX `DriverVehicles_vehicleId_idx`(`vehicleId`),
    INDEX `DriverVehicles_driverId_vehicleId_idx`(`driverId`, `vehicleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoadingOrder` (
    `id` VARCHAR(191) NOT NULL,
    `driverVehicleId` VARCHAR(191) NOT NULL,
    `totalQuantity` DECIMAL(18, 2) NOT NULL,
    `authoriserCount` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('pending', 'received', 'cancelled') NOT NULL DEFAULT 'pending',
    `authorizationStatus` ENUM('pending', 'approved') NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LoadingOrder_driverVehicleId_idx`(`driverVehicleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoadedOrder` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `loadingOrderId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoadedOrder_orderId_idx`(`orderId`),
    INDEX `LoadedOrder_loadingOrderId_idx`(`loadingOrderId`),
    UNIQUE INDEX `LoadedOrder_loadingOrderId_orderId_key`(`loadingOrderId`, `orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderReception` (
    `id` VARCHAR(191) NOT NULL,
    `loadingOrderId` VARCHAR(191) NOT NULL,
    `cuveId` VARCHAR(191) NOT NULL,
    `expectedQty` DECIMAL(18, 2) NOT NULL,
    `receivedQty` DECIMAL(18, 2) NOT NULL,
    `receivedBy` VARCHAR(191) NOT NULL,
    `comment` VARCHAR(191) NULL,
    `status` ENUM('pending', 'received', 'cancelled') NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderReception_loadingOrderId_idx`(`loadingOrderId`),
    INDEX `OrderReception_cuveId_idx`(`cuveId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoadingOrderAuthorizer` (
    `id` VARCHAR(191) NOT NULL,
    `loadingOrderId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `authorizerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoadingOrderAuthorizer_loadingOrderId_idx`(`loadingOrderId`),
    INDEX `LoadingOrderAuthorizer_userId_idx`(`userId`),
    INDEX `LoadingOrderAuthorizer_authorizerId_idx`(`authorizerId`),
    UNIQUE INDEX `LoadingOrderAuthorizer_loadingOrderId_userId_key`(`loadingOrderId`, `userId`),
    UNIQUE INDEX `LoadingOrderAuthorizer_loadingOrderId_authorizerId_key`(`loadingOrderId`, `authorizerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Authorizers` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('LOADING_ORDER') NOT NULL,
    `levels` INTEGER NOT NULL DEFAULT 1,
    `roleId` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Authorizers_roleId_idx`(`roleId`),
    UNIQUE INDEX `Authorizers_type_roleId_key`(`type`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Cargo` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `deportId` VARCHAR(191) NOT NULL,
    `vesselName` VARCHAR(191) NOT NULL,
    `receivedDate` DATETIME(3) NOT NULL,
    `expirationDate` DATETIME(3) NOT NULL,
    `quantityInKg` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `quantityInLitre` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `blRef` VARCHAR(191) NOT NULL,
    `supportingDocUrl` VARCHAR(191) NULL,
    `tansisRef` VARCHAR(191) NULL,
    `outurnRef` VARCHAR(191) NULL,
    `status` ENUM('pending', 'approved', 'cancelled') NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Cargo_orderId_idx`(`orderId`),
    INDEX `Cargo_blRef_idx`(`blRef`),
    INDEX `Cargo_tansisRef_idx`(`tansisRef`),
    INDEX `Cargo_receivedDate_idx`(`receivedDate`),
    INDEX `Cargo_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Stock` (
    `id` VARCHAR(191) NOT NULL,
    `deportId` VARCHAR(191) NOT NULL,
    `cargoId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `receivedDate` DATETIME(3) NOT NULL,
    `status` ENUM('awaiting', 'cancelled', 'returned', 'received') NOT NULL DEFAULT 'awaiting',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Stock_deportId_idx`(`deportId`),
    INDEX `Stock_cargoId_idx`(`cargoId`),
    INDEX `Stock_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Nomination` (
    `id` VARCHAR(191) NOT NULL,
    `driverVehicleId` VARCHAR(191) NOT NULL,
    `ambQuantity` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `destination` VARCHAR(191) NOT NULL,
    `expectedLoadingDate` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Nomination_driverVehicleId_idx`(`driverVehicleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NominationVessel` (
    `id` VARCHAR(191) NOT NULL,
    `nominationId` VARCHAR(191) NOT NULL,
    `stockId` VARCHAR(191) NOT NULL,
    `ambQuantity` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NominationVessel_stockId_idx`(`stockId`),
    INDEX `NominationVessel_nominationId_idx`(`nominationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Currency` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `rate` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Pfi` (
    `id` VARCHAR(191) NOT NULL,
    `currencyId` VARCHAR(191) NOT NULL,
    `nominationId` VARCHAR(191) NOT NULL,
    `currancyCode` VARCHAR(191) NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `supportingDocUrl` VARCHAR(191) NULL,
    `pifCode` VARCHAR(191) NOT NULL,
    `pfiReference` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Pfi_pifCode_key`(`pifCode`),
    UNIQUE INDEX `Pfi_pfiReference_key`(`pfiReference`),
    INDEX `Pfi_nominationId_idx`(`nominationId`),
    INDEX `Pfi_id_idx`(`id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NominationTimeLine` (
    `id` VARCHAR(191) NOT NULL,
    `nominationId` VARCHAR(191) NOT NULL,
    `timeLineStatusId` VARCHAR(191) NOT NULL,
    `changedBy` VARCHAR(191) NULL,
    `descriptions` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NominationTimeLine_nominationId_idx`(`nominationId`),
    INDEX `NominationTimeLine_timeLineStatusId_idx`(`timeLineStatusId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NominationTimeLineStatus` (
    `id` VARCHAR(191) NOT NULL,
    `status` ENUM('awaiting', 'underLoading', 't1Pending', 't1Confirmed', 'stockReceived') NOT NULL,
    `level` INTEGER NOT NULL,
    `descriptions` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NominationTimeLineStatus_status_key`(`status`),
    INDEX `NominationTimeLineStatus_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `T1Validation` (
    `id` VARCHAR(191) NOT NULL,
    `nominationId` VARCHAR(191) NOT NULL,
    `exportingCountry` VARCHAR(191) NOT NULL,
    `quantityAt20C` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `supportingDocUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `T1Validation_nominationId_key`(`nominationId`),
    INDEX `T1Validation_nominationId_idx`(`nominationId`),
    INDEX `T1Validation_id_idx`(`id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExtraT1Validation` (
    `id` VARCHAR(191) NOT NULL,
    `t1ValidationId` VARCHAR(191) NOT NULL,
    `customOffice` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'cancelled', 'confirmed') NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ExtraT1Validation_t1ValidationId_idx`(`t1ValidationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CentralStock` (
    `id` VARCHAR(191) NOT NULL,
    `deportId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `ambQuantity` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `quantityAt20C` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `receiptNumber` VARCHAR(191) NULL,
    `supportingDocUrl` VARCHAR(191) NULL,
    `t1ValidationId` VARCHAR(191) NOT NULL,
    `status` ENUM('inStock', 'stockOut') NOT NULL DEFAULT 'inStock',
    `toleranceRate` DECIMAL(12, 2) NULL,
    `lossQty` DECIMAL(18, 2) NULL,
    `gainQty` DECIMAL(18, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CentralStock_id_idx`(`id`),
    INDEX `CentralStock_deportId_idx`(`deportId`),
    INDEX `CentralStock_itemId_idx`(`itemId`),
    INDEX `CentralStock_t1ValidationId_idx`(`t1ValidationId`),
    INDEX `CentralStock_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `centralStockId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `note` VARCHAR(191) NULL,
    `supportingDocUrl` VARCHAR(191) NULL,
    `type` ENUM('saleOut', 'reconcilliationIn', 'reconcilliationOut', 'received') NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StockTransaction_id_idx`(`id`),
    INDEX `StockTransaction_centralStockId_idx`(`centralStockId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockClearance` (
    `id` VARCHAR(191) NOT NULL,
    `centralStockId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `fees` DECIMAL(18, 2) NULL,
    `amount` DECIMAL(18, 2) NULL,
    `status` ENUM('cleared', 'uncleared') NOT NULL DEFAULT 'uncleared',
    `clearedBy` VARCHAR(191) NULL,
    `agentId` VARCHAR(191) NULL,
    `supportingDocUrl` VARCHAR(191) NULL,
    `dmsDocUrl` VARCHAR(191) NULL,
    `assessmentDocUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StockClearance_id_idx`(`id`),
    INDEX `StockClearance_centralStockId_idx`(`centralStockId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClearingAgent` (
    `id` VARCHAR(191) NOT NULL,
    `names` VARCHAR(191) NOT NULL,
    `fees` DECIMAL(18, 2) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CentralStockOrder` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NULL,
    `clearanceId` VARCHAR(191) NOT NULL,
    `centralStockId` VARCHAR(191) NOT NULL,
    `orderType` ENUM('internal', 'b2b') NOT NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `unitPrice` DECIMAL(18, 2) NOT NULL,
    `totalPrice` DECIMAL(18, 2) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CentralStockOrder_centralStockId_idx`(`centralStockId`),
    INDEX `CentralStockOrder_clearanceId_idx`(`clearanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TblSite` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TblSite_id_idx`(`id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_provisioning_keys` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `keyHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `usedByDeviceId` VARCHAR(191) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `site_provisioning_keys_keyHash_key`(`keyHash`),
    INDEX `site_provisioning_keys_siteId_createdAt_idx`(`siteId`, `createdAt`),
    INDEX `site_provisioning_keys_expiresAt_idx`(`expiresAt`),
    INDEX `site_provisioning_keys_usedByDeviceId_idx`(`usedByDeviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_devices` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `deviceUuid` VARCHAR(128) NOT NULL,
    `deviceName` VARCHAR(80) NOT NULL,
    `status` ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
    `refreshTokenHash` VARCHAR(191) NULL,
    `refreshTokenExpiresAt` DATETIME(3) NULL,
    `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    `lastSeenAt` DATETIME(3) NULL,
    `provisionedAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `site_devices_deviceUuid_key`(`deviceUuid`),
    UNIQUE INDEX `site_devices_refreshTokenHash_key`(`refreshTokenHash`),
    INDEX `site_devices_siteId_status_idx`(`siteId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSites` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserSites_userId_siteId_key`(`userId`, `siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TblCuve` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `minimum` DECIMAL(18, 2) NOT NULL,
    `maximum` DECIMAL(18, 2) NOT NULL,
    `deadStock` DECIMAL(18, 2) NOT NULL,
    `balance` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TblCuve_id_idx`(`id`),
    INDEX `TblCuve_siteId_idx`(`siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CuveTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `cuveId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `type` ENUM('received', 'sold') NOT NULL DEFAULT 'received',
    `direction` ENUM('IN', 'OUT') NOT NULL DEFAULT 'IN',
    `note` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NULL,
    `orderReceptionId` VARCHAR(191) NULL,
    `generalTransactionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CuveTransaction_saleId_key`(`saleId`),
    UNIQUE INDEX `CuveTransaction_orderReceptionId_key`(`orderReceptionId`),
    UNIQUE INDEX `CuveTransaction_generalTransactionId_key`(`generalTransactionId`),
    INDEX `CuveTransaction_cuveId_idx`(`cuveId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FuelSale` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `nozzleId` VARCHAR(191) NULL,
    `pumpId` VARCHAR(191) NOT NULL,
    `shiftId` VARCHAR(191) NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `unitPrice` DECIMAL(18, 2) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `dateOn` DATE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FuelSale_siteId_dateOn_idx`(`siteId`, `dateOn`),
    INDEX `FuelSale_nozzleId_idx`(`nozzleId`),
    INDEX `FuelSale_shiftId_idx`(`shiftId`),
    INDEX `FuelSale_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FuelSalePayment` (
    `id` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `reference` VARCHAR(191) NULL,
    `referenceDocUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FuelSalePayment_saleId_idx`(`saleId`),
    INDEX `FuelSalePayment_accountId_idx`(`accountId`),
    UNIQUE INDEX `FuelSalePayment_saleId_accountId_key`(`saleId`, `accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TblPump` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TblPump_id_idx`(`id`),
    INDEX `TblPump_siteId_idx`(`siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TblDisplay` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `pumpId` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TblDisplay_id_idx`(`id`),
    INDEX `TblDisplay_pumpId_idx`(`pumpId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TblNozzle` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nozzleCode` VARCHAR(191) NOT NULL,
    `pumpId` VARCHAR(191) NOT NULL,
    `displayId` VARCHAR(191) NOT NULL,
    `cuveId` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TblNozzle_nozzleCode_key`(`nozzleCode`),
    INDEX `TblNozzle_id_idx`(`id`),
    INDEX `TblNozzle_pumpId_idx`(`pumpId`),
    INDEX `TblNozzle_displayId_idx`(`displayId`),
    INDEX `TblNozzle_cuveId_idx`(`cuveId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Location` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Location_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompanyAccount` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('cash', 'bank', 'mobileMoney', 'transfer', 'card') NOT NULL,
    `siteId` VARCHAR(191) NULL,
    `requiredReference` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAtBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CompanyAccount_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientWallet` (
    `id` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `clientId` VARCHAR(191) NOT NULL,
    `createdAtBy` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ClientWallet_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `walletTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `clientWalletId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `referenceId` VARCHAR(191) NULL,
    `type` ENUM('DEPOSIT', 'PAYMENT', 'REFUND', 'LOAN', 'WITHDRAWAL', 'TRANSFER', 'ADJUSTMENT') NOT NULL,
    `direction` ENUM('IN', 'OUT') NOT NULL,
    `supportingDocUrl` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `walletTransaction_clientWalletId_idx`(`clientWalletId`),
    INDEX `walletTransaction_accountId_idx`(`accountId`),
    INDEX `walletTransaction_referenceId_idx`(`referenceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Card` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cardNumber` VARCHAR(191) NULL,
    `serialNumber` VARCHAR(191) NULL,
    `cardCode` VARCHAR(191) NULL,
    `balance` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `availability` BOOLEAN NOT NULL DEFAULT true,
    `cardTypeId` VARCHAR(191) NULL,
    `securityCategory` INTEGER NULL,
    `state` INTEGER NOT NULL DEFAULT 0,
    `swapStatus` INTEGER NULL,
    `inventoryStatus` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Card_cardNumber_key`(`cardNumber`),
    UNIQUE INDEX `Card_serialNumber_key`(`serialNumber`),
    INDEX `Card_cardNumber_idx`(`cardNumber`),
    INDEX `Card_cardTypeId_idx`(`cardTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardType` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CardType_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardSetting` (
    `id` VARCHAR(191) NOT NULL,
    `cardTypeId` VARCHAR(191) NOT NULL,
    `requirePin` BOOLEAN NOT NULL DEFAULT true,
    `requirePlateNumber` BOOLEAN NOT NULL DEFAULT false,
    `capturePlatePicture` BOOLEAN NOT NULL DEFAULT false,
    `requireOdometer` BOOLEAN NOT NULL DEFAULT false,
    `allowCredit` BOOLEAN NOT NULL DEFAULT false,
    `hasLimit` BOOLEAN NOT NULL DEFAULT false,
    `showBalance` BOOLEAN NOT NULL DEFAULT true,
    `captureDisplay` BOOLEAN NOT NULL DEFAULT false,
    `limitAmount` DECIMAL(18, 2) NULL,
    `limitPeriod` ENUM('transaction', 'daily', 'weekly', 'monthly') NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CardSetting_cardTypeId_key`(`cardTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardCopy` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `clientId` VARCHAR(191) NOT NULL,
    `cardId` BIGINT NOT NULL,
    `cardCopyId` BIGINT NULL,
    `lastIndex` INTEGER NOT NULL DEFAULT 1,
    `pin` VARCHAR(191) NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CardCopy_clientId_idx`(`clientId`),
    INDEX `CardCopy_cardId_idx`(`cardId`),
    INDEX `CardCopy_cardCopyId_idx`(`cardCopyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardCopyTransaction` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `carfdCopyId` BIGINT NOT NULL,
    `type` ENUM('DEPOSIT', 'PAYMENT', 'REFUND', 'LOAN', 'WITHDRAWAL', 'TRANSFER', 'ADJUSTMENT') NOT NULL,
    `direction` ENUM('IN', 'OUT') NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CardCopyTransaction_carfdCopyId_idx`(`carfdCopyId`),
    INDEX `CardCopyTransaction_carfdCopyId_type_idx`(`carfdCopyId`, `type`),
    INDEX `CardCopyTransaction_carfdCopyId_direction_idx`(`carfdCopyId`, `direction`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Discount` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('fixed', 'ranging') NOT NULL,
    `value` DECIMAL(12, 1) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `clientId` VARCHAR(191) NULL,
    `siteId` VARCHAR(191) NULL,
    `validFrom` DATETIME(3) NOT NULL,
    `validTo` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Discount_clientId_idx`(`clientId`),
    INDEX `Discount_siteId_idx`(`siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RangingDiscount` (
    `id` VARCHAR(191) NOT NULL,
    `from` DECIMAL(12, 1) NOT NULL,
    `to` DECIMAL(12, 1) NOT NULL,
    `amount` DECIMAL(12, 1) NOT NULL,
    `discountId` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NULL,

    INDEX `RangingDiscount_discountId_idx`(`discountId`),
    INDEX `RangingDiscount_siteId_idx`(`siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CargoInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `unitPrice` DECIMAL(18, 2) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currencyCode` VARCHAR(191) NOT NULL,
    `cargoId` VARCHAR(191) NOT NULL,
    `supportingDocUrl` VARCHAR(191) NULL,
    `invoiceCode` VARCHAR(191) NOT NULL,
    `invoiceReference` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CargoInvoice_invoiceCode_key`(`invoiceCode`),
    UNIQUE INDEX `CargoInvoice_invoiceReference_key`(`invoiceReference`),
    INDEX `CargoInvoice_cargoId_idx`(`cargoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ItemToleranceRate` (
    `id` VARCHAR(191) NOT NULL,
    `maxRate` DECIMAL(12, 2) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ItemToleranceRate_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CouponPlan` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CouponPlan_id_idx`(`id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientCoupon` (
    `id` VARCHAR(191) NOT NULL,
    `couponPlanId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `export` BOOLEAN NOT NULL DEFAULT false,
    `amount` DECIMAL(18, 2) NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `printedAt` DATETIME(3) NULL,
    `scannedAt` DATETIME(3) NULL,
    `status` ENUM('available', 'printed', 'scanned', 'expired', 'used', 'called', 'cancelled') NOT NULL DEFAULT 'available',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ClientCoupon_code_key`(`code`),
    INDEX `ClientCoupon_couponPlanId_idx`(`couponPlanId`),
    INDEX `ClientCoupon_clientId_idx`(`clientId`),
    INDEX `ClientCoupon_code_idx`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TblShift` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startAt` TIME(0) NOT NULL,
    `endAt` TIME(0) NOT NULL,
    `status` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TblShiftSite` (
    `id` VARCHAR(191) NOT NULL,
    `shiftId` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `turnonAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` INTEGER NOT NULL DEFAULT 1,

    INDEX `TblShiftSite_shiftId_idx`(`shiftId`),
    INDEX `TblShiftSite_siteId_idx`(`siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TblPumpAttendant` (
    `id` VARCHAR(191) NOT NULL,
    `pumpId` VARCHAR(191) NOT NULL,
    `day` INTEGER NOT NULL,
    `siteShiftId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TblPumpAttendant_pumpId_idx`(`pumpId`),
    INDEX `TblPumpAttendant_siteShiftId_idx`(`siteShiftId`),
    INDEX `TblPumpAttendant_userId_idx`(`userId`),
    INDEX `TblPumpAttendant_siteId_idx`(`siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PumpAttendantNozzle` (
    `id` VARCHAR(191) NOT NULL,
    `pumpAttendantId` VARCHAR(191) NOT NULL,
    `nozzleId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PumpAttendantNozzle_pumpAttendantId_idx`(`pumpAttendantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TblTimeTable` (
    `id` VARCHAR(191) NOT NULL,
    `days` INTEGER NOT NULL,
    `dateOn` DATE NOT NULL,
    `siteShiftId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 0,
    `extraShift` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isChief` BOOLEAN NOT NULL DEFAULT false,
    `isSuport` BOOLEAN NOT NULL DEFAULT false,

    INDEX `TblTimeTable_siteShiftId_idx`(`siteShiftId`),
    INDEX `TblTimeTable_userId_idx`(`userId`),
    INDEX `TblTimeTable_siteId_idx`(`siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientCar` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `plateNo` VARCHAR(191) NOT NULL,
    `trackNo` VARCHAR(191) NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `tancapacity` DECIMAL(18, 2) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ClientCar_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientCarCardAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `clientCarId` VARCHAR(191) NOT NULL,
    `cardCopyId` BIGINT NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `unassignedAt` DATETIME(3) NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    INDEX `ClientCarCardAssignment_clientCarId_idx`(`clientCarId`),
    INDEX `ClientCarCardAssignment_cardCopyId_idx`(`cardCopyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GeneralTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `transactionCode` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `cuveId` VARCHAR(191) NOT NULL,
    `pumpId` VARCHAR(191) NOT NULL,
    `nozzleId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `cardCopyId` BIGINT NULL,
    `platNumber` VARCHAR(191) NULL,
    `platePictureUrl` VARCHAR(191) NULL,
    `quantity` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `unitPrice` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `siteId` VARCHAR(191) NOT NULL,
    `discountAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `shiftId` VARCHAR(191) NULL,
    `displayPictureUrl` VARCHAR(191) NULL,
    `doneBy` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `comments` VARCHAR(191) NULL,
    `printStatus` BOOLEAN NOT NULL DEFAULT false,
    `appVersion` VARCHAR(191) NULL,
    `subsidyRate` DECIMAL(12, 2) NOT NULL DEFAULT 0.0,
    `subsidyAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `status` ENUM('initiated', 'confirmed', 'cancelled') NOT NULL DEFAULT 'initiated',
    `confirmedAt` DATETIME(3) NULL,
    `deviceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GeneralTransaction_transactionCode_key`(`transactionCode`),
    INDEX `GeneralTransaction_siteId_createdAt_idx`(`siteId`, `createdAt`),
    INDEX `GeneralTransaction_siteId_id_idx`(`siteId`, `id`),
    INDEX `GeneralTransaction_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GeneralTransactionPayment` (
    `id` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `reference` VARCHAR(191) NULL,
    `referenceDocUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GeneralTransactionPayment_transactionId_idx`(`transactionId`),
    INDEX `GeneralTransactionPayment_accountId_idx`(`accountId`),
    UNIQUE INDEX `GeneralTransactionPayment_transactionId_accountId_key`(`transactionId`, `accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Module` ADD CONSTRAINT `Module_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Module`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Permission` ADD CONSTRAINT `Permission_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `Module`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermissions` ADD CONSTRAINT `RolePermissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermissions` ADD CONSTRAINT `RolePermissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Client` ADD CONSTRAINT `Client_province_fkey` FOREIGN KEY (`province`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Client` ADD CONSTRAINT `Client_district_fkey` FOREIGN KEY (`district`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Client` ADD CONSTRAINT `Client_sector_fkey` FOREIGN KEY (`sector`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordResetToken` ADD CONSTRAINT `PasswordResetToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_baseUnitId_fkey` FOREIGN KEY (`baseUnitId`) REFERENCES `Unit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemUnit` ADD CONSTRAINT `ItemUnit_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemUnit` ADD CONSTRAINT `ItemUnit_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `Unit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemPrice` ADD CONSTRAINT `ItemPrice_itemUnitId_fkey` FOREIGN KEY (`itemUnitId`) REFERENCES `ItemUnit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemPrice` ADD CONSTRAINT `ItemPrice_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Supplier` ADD CONSTRAINT `Supplier_supplierTypeId_fkey` FOREIGN KEY (`supplierTypeId`) REFERENCES `SupplierType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_orderPlanId_fkey` FOREIGN KEY (`orderPlanId`) REFERENCES `OrderPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vehicle` ADD CONSTRAINT `Vehicle_transporterId_fkey` FOREIGN KEY (`transporterId`) REFERENCES `Transporter`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Driver` ADD CONSTRAINT `Driver_transporterId_fkey` FOREIGN KEY (`transporterId`) REFERENCES `Transporter`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverVehicles` ADD CONSTRAINT `DriverVehicles_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `Driver`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverVehicles` ADD CONSTRAINT `DriverVehicles_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoadingOrder` ADD CONSTRAINT `LoadingOrder_driverVehicleId_fkey` FOREIGN KEY (`driverVehicleId`) REFERENCES `DriverVehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoadedOrder` ADD CONSTRAINT `LoadedOrder_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `CentralStockOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoadedOrder` ADD CONSTRAINT `LoadedOrder_loadingOrderId_fkey` FOREIGN KEY (`loadingOrderId`) REFERENCES `LoadingOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderReception` ADD CONSTRAINT `OrderReception_loadingOrderId_fkey` FOREIGN KEY (`loadingOrderId`) REFERENCES `LoadingOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderReception` ADD CONSTRAINT `OrderReception_cuveId_fkey` FOREIGN KEY (`cuveId`) REFERENCES `TblCuve`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderReception` ADD CONSTRAINT `OrderReception_receivedBy_fkey` FOREIGN KEY (`receivedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoadingOrderAuthorizer` ADD CONSTRAINT `LoadingOrderAuthorizer_loadingOrderId_fkey` FOREIGN KEY (`loadingOrderId`) REFERENCES `LoadingOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoadingOrderAuthorizer` ADD CONSTRAINT `fk_loading_order_authorizer_user` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoadingOrderAuthorizer` ADD CONSTRAINT `LoadingOrderAuthorizer_authorizerId_fkey` FOREIGN KEY (`authorizerId`) REFERENCES `Authorizers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Authorizers` ADD CONSTRAINT `Authorizers_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Cargo` ADD CONSTRAINT `Cargo_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Cargo` ADD CONSTRAINT `Cargo_deportId_fkey` FOREIGN KEY (`deportId`) REFERENCES `Deport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Stock` ADD CONSTRAINT `Stock_deportId_fkey` FOREIGN KEY (`deportId`) REFERENCES `Deport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Stock` ADD CONSTRAINT `Stock_cargoId_fkey` FOREIGN KEY (`cargoId`) REFERENCES `Cargo`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Stock` ADD CONSTRAINT `Stock_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Nomination` ADD CONSTRAINT `Nomination_driverVehicleId_fkey` FOREIGN KEY (`driverVehicleId`) REFERENCES `DriverVehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NominationVessel` ADD CONSTRAINT `NominationVessel_nominationId_fkey` FOREIGN KEY (`nominationId`) REFERENCES `Nomination`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NominationVessel` ADD CONSTRAINT `NominationVessel_stockId_fkey` FOREIGN KEY (`stockId`) REFERENCES `Stock`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Pfi` ADD CONSTRAINT `Pfi_currencyId_fkey` FOREIGN KEY (`currencyId`) REFERENCES `Currency`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Pfi` ADD CONSTRAINT `Pfi_nominationId_fkey` FOREIGN KEY (`nominationId`) REFERENCES `Nomination`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NominationTimeLine` ADD CONSTRAINT `NominationTimeLine_nominationId_fkey` FOREIGN KEY (`nominationId`) REFERENCES `Nomination`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NominationTimeLine` ADD CONSTRAINT `NominationTimeLine_timeLineStatusId_fkey` FOREIGN KEY (`timeLineStatusId`) REFERENCES `NominationTimeLineStatus`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NominationTimeLine` ADD CONSTRAINT `NominationTimeLine_changedBy_fkey` FOREIGN KEY (`changedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `T1Validation` ADD CONSTRAINT `T1Validation_nominationId_fkey` FOREIGN KEY (`nominationId`) REFERENCES `Nomination`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExtraT1Validation` ADD CONSTRAINT `ExtraT1Validation_t1ValidationId_fkey` FOREIGN KEY (`t1ValidationId`) REFERENCES `T1Validation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CentralStock` ADD CONSTRAINT `CentralStock_deportId_fkey` FOREIGN KEY (`deportId`) REFERENCES `Deport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CentralStock` ADD CONSTRAINT `CentralStock_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CentralStock` ADD CONSTRAINT `CentralStock_t1ValidationId_fkey` FOREIGN KEY (`t1ValidationId`) REFERENCES `T1Validation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransaction` ADD CONSTRAINT `StockTransaction_centralStockId_fkey` FOREIGN KEY (`centralStockId`) REFERENCES `CentralStock`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransaction` ADD CONSTRAINT `StockTransaction_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockClearance` ADD CONSTRAINT `StockClearance_centralStockId_fkey` FOREIGN KEY (`centralStockId`) REFERENCES `CentralStock`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockClearance` ADD CONSTRAINT `StockClearance_clearedBy_fkey` FOREIGN KEY (`clearedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockClearance` ADD CONSTRAINT `StockClearance_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `ClearingAgent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CentralStockOrder` ADD CONSTRAINT `CentralStockOrder_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CentralStockOrder` ADD CONSTRAINT `CentralStockOrder_clearanceId_fkey` FOREIGN KEY (`clearanceId`) REFERENCES `StockClearance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CentralStockOrder` ADD CONSTRAINT `CentralStockOrder_centralStockId_fkey` FOREIGN KEY (`centralStockId`) REFERENCES `CentralStock`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CentralStockOrder` ADD CONSTRAINT `CentralStockOrder_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CentralStockOrder` ADD CONSTRAINT `CentralStockOrder_approvedBy_fkey` FOREIGN KEY (`approvedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_provisioning_keys` ADD CONSTRAINT `site_provisioning_keys_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_provisioning_keys` ADD CONSTRAINT `site_provisioning_keys_usedByDeviceId_fkey` FOREIGN KEY (`usedByDeviceId`) REFERENCES `site_devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_provisioning_keys` ADD CONSTRAINT `site_provisioning_keys_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_devices` ADD CONSTRAINT `site_devices_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_devices` ADD CONSTRAINT `site_devices_revokedBy_fkey` FOREIGN KEY (`revokedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSites` ADD CONSTRAINT `UserSites_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSites` ADD CONSTRAINT `UserSites_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblCuve` ADD CONSTRAINT `TblCuve_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblCuve` ADD CONSTRAINT `TblCuve_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CuveTransaction` ADD CONSTRAINT `CuveTransaction_cuveId_fkey` FOREIGN KEY (`cuveId`) REFERENCES `TblCuve`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CuveTransaction` ADD CONSTRAINT `CuveTransaction_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CuveTransaction` ADD CONSTRAINT `CuveTransaction_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `FuelSale`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CuveTransaction` ADD CONSTRAINT `CuveTransaction_orderReceptionId_fkey` FOREIGN KEY (`orderReceptionId`) REFERENCES `OrderReception`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CuveTransaction` ADD CONSTRAINT `CuveTransaction_generalTransactionId_fkey` FOREIGN KEY (`generalTransactionId`) REFERENCES `GeneralTransaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelSale` ADD CONSTRAINT `FuelSale_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelSale` ADD CONSTRAINT `FuelSale_nozzleId_fkey` FOREIGN KEY (`nozzleId`) REFERENCES `TblNozzle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelSale` ADD CONSTRAINT `FuelSale_pumpId_fkey` FOREIGN KEY (`pumpId`) REFERENCES `TblPump`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelSale` ADD CONSTRAINT `FuelSale_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `TblShiftSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelSale` ADD CONSTRAINT `FuelSale_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelSalePayment` ADD CONSTRAINT `FuelSalePayment_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `FuelSale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelSalePayment` ADD CONSTRAINT `FuelSalePayment_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `CompanyAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblPump` ADD CONSTRAINT `TblPump_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblDisplay` ADD CONSTRAINT `TblDisplay_pumpId_fkey` FOREIGN KEY (`pumpId`) REFERENCES `TblPump`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblNozzle` ADD CONSTRAINT `TblNozzle_pumpId_fkey` FOREIGN KEY (`pumpId`) REFERENCES `TblPump`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblNozzle` ADD CONSTRAINT `TblNozzle_displayId_fkey` FOREIGN KEY (`displayId`) REFERENCES `TblDisplay`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblNozzle` ADD CONSTRAINT `TblNozzle_cuveId_fkey` FOREIGN KEY (`cuveId`) REFERENCES `TblCuve`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Location` ADD CONSTRAINT `Location_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompanyAccount` ADD CONSTRAINT `CompanyAccount_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompanyAccount` ADD CONSTRAINT `CompanyAccount_createdAtBy_fkey` FOREIGN KEY (`createdAtBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientWallet` ADD CONSTRAINT `ClientWallet_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientWallet` ADD CONSTRAINT `ClientWallet_createdAtBy_fkey` FOREIGN KEY (`createdAtBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `walletTransaction` ADD CONSTRAINT `walletTransaction_clientWalletId_fkey` FOREIGN KEY (`clientWalletId`) REFERENCES `ClientWallet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `walletTransaction` ADD CONSTRAINT `walletTransaction_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `CompanyAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Card` ADD CONSTRAINT `Card_cardTypeId_fkey` FOREIGN KEY (`cardTypeId`) REFERENCES `CardType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CardType` ADD CONSTRAINT `CardType_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CardSetting` ADD CONSTRAINT `CardSetting_cardTypeId_fkey` FOREIGN KEY (`cardTypeId`) REFERENCES `CardType`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CardCopy` ADD CONSTRAINT `CardCopy_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CardCopy` ADD CONSTRAINT `CardCopy_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `Card`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CardCopy` ADD CONSTRAINT `CardCopy_cardCopyId_fkey` FOREIGN KEY (`cardCopyId`) REFERENCES `Card`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CardCopyTransaction` ADD CONSTRAINT `CardCopyTransaction_carfdCopyId_fkey` FOREIGN KEY (`carfdCopyId`) REFERENCES `CardCopy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CardCopyTransaction` ADD CONSTRAINT `CardCopyTransaction_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Discount` ADD CONSTRAINT `Discount_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Discount` ADD CONSTRAINT `Discount_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Discount` ADD CONSTRAINT `Discount_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RangingDiscount` ADD CONSTRAINT `RangingDiscount_discountId_fkey` FOREIGN KEY (`discountId`) REFERENCES `Discount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RangingDiscount` ADD CONSTRAINT `RangingDiscount_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CargoInvoice` ADD CONSTRAINT `CargoInvoice_cargoId_fkey` FOREIGN KEY (`cargoId`) REFERENCES `Cargo`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemToleranceRate` ADD CONSTRAINT `ItemToleranceRate_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientCoupon` ADD CONSTRAINT `ClientCoupon_couponPlanId_fkey` FOREIGN KEY (`couponPlanId`) REFERENCES `CouponPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientCoupon` ADD CONSTRAINT `ClientCoupon_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblShiftSite` ADD CONSTRAINT `TblShiftSite_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `TblShift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblShiftSite` ADD CONSTRAINT `TblShiftSite_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblPumpAttendant` ADD CONSTRAINT `TblPumpAttendant_pumpId_fkey` FOREIGN KEY (`pumpId`) REFERENCES `TblPump`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblPumpAttendant` ADD CONSTRAINT `TblPumpAttendant_siteShiftId_fkey` FOREIGN KEY (`siteShiftId`) REFERENCES `TblShiftSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblPumpAttendant` ADD CONSTRAINT `TblPumpAttendant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblPumpAttendant` ADD CONSTRAINT `TblPumpAttendant_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PumpAttendantNozzle` ADD CONSTRAINT `PumpAttendantNozzle_pumpAttendantId_fkey` FOREIGN KEY (`pumpAttendantId`) REFERENCES `TblPumpAttendant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PumpAttendantNozzle` ADD CONSTRAINT `PumpAttendantNozzle_nozzleId_fkey` FOREIGN KEY (`nozzleId`) REFERENCES `TblNozzle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblTimeTable` ADD CONSTRAINT `TblTimeTable_siteShiftId_fkey` FOREIGN KEY (`siteShiftId`) REFERENCES `TblShiftSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblTimeTable` ADD CONSTRAINT `TblTimeTable_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TblTimeTable` ADD CONSTRAINT `TblTimeTable_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientCar` ADD CONSTRAINT `ClientCar_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientCar` ADD CONSTRAINT `ClientCar_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientCarCardAssignment` ADD CONSTRAINT `ClientCarCardAssignment_clientCarId_fkey` FOREIGN KEY (`clientCarId`) REFERENCES `ClientCar`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientCarCardAssignment` ADD CONSTRAINT `ClientCarCardAssignment_cardCopyId_fkey` FOREIGN KEY (`cardCopyId`) REFERENCES `CardCopy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransaction` ADD CONSTRAINT `GeneralTransaction_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransaction` ADD CONSTRAINT `GeneralTransaction_cuveId_fkey` FOREIGN KEY (`cuveId`) REFERENCES `TblCuve`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransaction` ADD CONSTRAINT `GeneralTransaction_pumpId_fkey` FOREIGN KEY (`pumpId`) REFERENCES `TblPump`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransaction` ADD CONSTRAINT `GeneralTransaction_nozzleId_fkey` FOREIGN KEY (`nozzleId`) REFERENCES `TblNozzle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransaction` ADD CONSTRAINT `GeneralTransaction_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransaction` ADD CONSTRAINT `GeneralTransaction_cardCopyId_fkey` FOREIGN KEY (`cardCopyId`) REFERENCES `CardCopy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransaction` ADD CONSTRAINT `GeneralTransaction_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransaction` ADD CONSTRAINT `GeneralTransaction_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `TblShiftSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransaction` ADD CONSTRAINT `GeneralTransaction_doneBy_fkey` FOREIGN KEY (`doneBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransaction` ADD CONSTRAINT `GeneralTransaction_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `site_devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransactionPayment` ADD CONSTRAINT `GeneralTransactionPayment_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `GeneralTransaction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralTransactionPayment` ADD CONSTRAINT `GeneralTransactionPayment_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `CompanyAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
