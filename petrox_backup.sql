--
-- PostgreSQL database dump
--

\restrict NcFjI348UPZntSjYvh9t5eITSi7pwV5CjRC4G20QsPeNWXR6kgtK6F0rhyXAXyL

-- Dumped from database version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: LocationType; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."LocationType" AS ENUM (
    'DEPOT',
    'STATION',
    'SUPPLIER'
);


ALTER TYPE public."LocationType" OWNER TO petrox;

--
-- Name: PurchaseOrderStatus; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."PurchaseOrderStatus" AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'CONFIRMED',
    'PARTIALLY_FULFILLED',
    'FULFILLED',
    'CANCELLED'
);


ALTER TYPE public."PurchaseOrderStatus" OWNER TO petrox;

--
-- Name: ScopeLevel; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."ScopeLevel" AS ENUM (
    'COMPANY',
    'STATION'
);


ALTER TYPE public."ScopeLevel" OWNER TO petrox;

--
-- Name: ShiftStatus; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."ShiftStatus" AS ENUM (
    'OPEN',
    'CLOSED'
);


ALTER TYPE public."ShiftStatus" OWNER TO petrox;

--
-- Name: ShipmentStatus; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."ShipmentStatus" AS ENUM (
    'CREATED',
    'APPROVED',
    'LOADED',
    'DISPATCHED',
    'IN_TRANSIT',
    'ARRIVED',
    'RECEIVED',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE public."ShipmentStatus" OWNER TO petrox;

--
-- Name: ShipmentType; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."ShipmentType" AS ENUM (
    'SUPPLIER_TO_DEPOT',
    'SUPPLIER_TO_STATION',
    'DEPOT_TO_STATION',
    'STATION_TO_STATION'
);


ALTER TYPE public."ShipmentType" OWNER TO petrox;

--
-- Name: StockAdjustmentReason; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."StockAdjustmentReason" AS ENUM (
    'EVAPORATION',
    'SPILLAGE',
    'MEASUREMENT_CORRECTION',
    'THEFT_SUSPECTED',
    'OTHER'
);


ALTER TYPE public."StockAdjustmentReason" OWNER TO petrox;

--
-- Name: StockMovementType; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."StockMovementType" AS ENUM (
    'RECEIPT',
    'DISPATCH',
    'DISPENSED',
    'ADJUSTMENT'
);


ALTER TYPE public."StockMovementType" OWNER TO petrox;

--
-- Name: SyncEventStatus; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."SyncEventStatus" AS ENUM (
    'PENDING',
    'APPLIED',
    'FAILED'
);


ALTER TYPE public."SyncEventStatus" OWNER TO petrox;

--
-- Name: SyncEventType; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."SyncEventType" AS ENUM (
    'SHIFT_START',
    'SHIFT_END',
    'METER_READING',
    'TANK_DIP',
    'STOCK_RECEIPT'
);


ALTER TYPE public."SyncEventType" OWNER TO petrox;

--
-- Name: TankStatus; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."TankStatus" AS ENUM (
    'ACTIVE',
    'MAINTENANCE',
    'OUT_OF_SERVICE',
    'DECOMMISSIONED'
);


ALTER TYPE public."TankStatus" OWNER TO petrox;

--
-- Name: TripStatus; Type: TYPE; Schema: public; Owner: petrox
--

CREATE TYPE public."TripStatus" AS ENUM (
    'PLANNED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE public."TripStatus" OWNER TO petrox;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Carrier; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Carrier" (
    id text NOT NULL,
    name text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    address text,
    email text,
    "isOwnFleet" boolean DEFAULT false NOT NULL,
    notes text,
    phone text,
    "taxId" text
);


ALTER TABLE public."Carrier" OWNER TO petrox;

--
-- Name: CompanySettings; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."CompanySettings" (
    id text DEFAULT 'singleton'::text NOT NULL,
    "companyName" text DEFAULT ''::text NOT NULL,
    address text,
    phone text,
    email text,
    "taxId" text,
    currency text DEFAULT 'USD'::text NOT NULL,
    "logoPath" text,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."CompanySettings" OWNER TO petrox;

--
-- Name: Depot; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Depot" (
    id text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    address text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL
);


ALTER TABLE public."Depot" OWNER TO petrox;

--
-- Name: Driver; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Driver" (
    id text NOT NULL,
    name text NOT NULL,
    phone text,
    "licenseNumber" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Driver" OWNER TO petrox;

--
-- Name: MeterReading; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."MeterReading" (
    id text NOT NULL,
    "nozzleId" text NOT NULL,
    "shiftId" text NOT NULL,
    "openingReading" numeric(12,2) NOT NULL,
    "closingReading" numeric(12,2) NOT NULL,
    "litersDispensed" numeric(12,2) NOT NULL,
    "recordedAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."MeterReading" OWNER TO petrox;

--
-- Name: Nozzle; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Nozzle" (
    id text NOT NULL,
    "pumpId" text NOT NULL,
    "tankId" text NOT NULL,
    "productId" text NOT NULL,
    label text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Nozzle" OWNER TO petrox;

--
-- Name: PasswordResetToken; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."PasswordResetToken" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "tokenHash" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "usedAt" timestamp(3) without time zone
);


ALTER TABLE public."PasswordResetToken" OWNER TO petrox;

--
-- Name: Permission; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Permission" (
    id text NOT NULL,
    entity text NOT NULL,
    action text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Permission" OWNER TO petrox;

--
-- Name: Product; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Product" (
    id text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "unitId" text NOT NULL
);


ALTER TABLE public."Product" OWNER TO petrox;

--
-- Name: Pump; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Pump" (
    id text NOT NULL,
    "stationId" text NOT NULL,
    name text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Pump" OWNER TO petrox;

--
-- Name: PurchaseOrder; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."PurchaseOrder" (
    id text NOT NULL,
    "supplierId" text NOT NULL,
    "destinationType" public."LocationType" NOT NULL,
    "destinationDepotId" text,
    "destinationStationId" text,
    status public."PurchaseOrderStatus" DEFAULT 'DRAFT'::public."PurchaseOrderStatus" NOT NULL,
    "orderedById" text NOT NULL,
    "orderedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expectedDeliveryAt" timestamp(3) without time zone,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."PurchaseOrder" OWNER TO petrox;

--
-- Name: PurchaseOrderLine; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."PurchaseOrderLine" (
    id text NOT NULL,
    "purchaseOrderId" text NOT NULL,
    "productId" text NOT NULL,
    "quantityLiters" numeric(12,2) NOT NULL,
    "unitPrice" numeric(12,4)
);


ALTER TABLE public."PurchaseOrderLine" OWNER TO petrox;

--
-- Name: RefreshToken; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."RefreshToken" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "tokenHash" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "revokedAt" timestamp(3) without time zone
);


ALTER TABLE public."RefreshToken" OWNER TO petrox;

--
-- Name: Role; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Role" (
    id text NOT NULL,
    name text NOT NULL,
    "isFixed" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Role" OWNER TO petrox;

--
-- Name: RolePermission; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."RolePermission" (
    id text NOT NULL,
    role text NOT NULL,
    "permissionId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."RolePermission" OWNER TO petrox;

--
-- Name: RoleScope; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."RoleScope" (
    role text NOT NULL,
    scope public."ScopeLevel" NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."RoleScope" OWNER TO petrox;

--
-- Name: Shift; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Shift" (
    id text NOT NULL,
    "stationId" text NOT NULL,
    "attendantId" text NOT NULL,
    "startedAt" timestamp(3) without time zone NOT NULL,
    "endedAt" timestamp(3) without time zone,
    status public."ShiftStatus" DEFAULT 'OPEN'::public."ShiftStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Shift" OWNER TO petrox;

--
-- Name: Shipment; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Shipment" (
    id text NOT NULL,
    "purchaseOrderId" text,
    type public."ShipmentType" NOT NULL,
    "originType" public."LocationType" NOT NULL,
    "originSupplierId" text,
    "originDepotId" text,
    "originStationId" text,
    "originTankId" text,
    "destinationType" public."LocationType" NOT NULL,
    "destinationDepotId" text,
    "destinationStationId" text,
    status public."ShipmentStatus" DEFAULT 'CREATED'::public."ShipmentStatus" NOT NULL,
    "dispatchedAt" timestamp(3) without time zone,
    "estimatedArrivalAt" timestamp(3) without time zone,
    "deliveredAt" timestamp(3) without time zone,
    "createdById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "truckId" text,
    "driverId" text,
    "plannedDispatchAt" timestamp(3) without time zone
);


ALTER TABLE public."Shipment" OWNER TO petrox;

--
-- Name: ShipmentLine; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."ShipmentLine" (
    id text NOT NULL,
    "shipmentId" text NOT NULL,
    "productId" text NOT NULL,
    "dispatchedVolumeLiters" numeric(12,2) NOT NULL
);


ALTER TABLE public."ShipmentLine" OWNER TO petrox;

--
-- Name: ShipmentStatusEvent; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."ShipmentStatusEvent" (
    id text NOT NULL,
    "shipmentId" text NOT NULL,
    status public."ShipmentStatus" NOT NULL,
    note text,
    "occurredAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "recordedById" text NOT NULL
);


ALTER TABLE public."ShipmentStatusEvent" OWNER TO petrox;

--
-- Name: Station; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Station" (
    id text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    address text,
    email text NOT NULL,
    phone text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Station" OWNER TO petrox;

--
-- Name: StockAdjustment; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."StockAdjustment" (
    id text NOT NULL,
    "tankId" text NOT NULL,
    "quantityLiters" numeric(12,2) NOT NULL,
    reason public."StockAdjustmentReason" NOT NULL,
    notes text,
    "adjustedById" text NOT NULL,
    "adjustedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "productId" text NOT NULL
);


ALTER TABLE public."StockAdjustment" OWNER TO petrox;

--
-- Name: StockMovement; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."StockMovement" (
    id text NOT NULL,
    "tankId" text NOT NULL,
    type public."StockMovementType" NOT NULL,
    "quantityLiters" numeric(12,2) NOT NULL,
    "referenceType" text NOT NULL,
    "referenceId" text NOT NULL,
    "occurredAt" timestamp(3) without time zone NOT NULL,
    "recordedById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "productId" text NOT NULL
);


ALTER TABLE public."StockMovement" OWNER TO petrox;

--
-- Name: StockReceipt; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."StockReceipt" (
    id text NOT NULL,
    "shipmentId" text NOT NULL,
    "receivedById" text NOT NULL,
    "receivedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."StockReceipt" OWNER TO petrox;

--
-- Name: StockReceiptLine; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."StockReceiptLine" (
    id text NOT NULL,
    "stockReceiptId" text NOT NULL,
    "productId" text NOT NULL,
    "destinationTankId" text NOT NULL,
    "receivedVolumeLiters" numeric(12,2) NOT NULL
);


ALTER TABLE public."StockReceiptLine" OWNER TO petrox;

--
-- Name: Supplier; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Supplier" (
    id text NOT NULL,
    name text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    address text,
    email text,
    notes text,
    "paymentTerms" text,
    phone text,
    "taxId" text,
    country text
);


ALTER TABLE public."Supplier" OWNER TO petrox;

--
-- Name: SyncEvent; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."SyncEvent" (
    id text NOT NULL,
    type public."SyncEventType" NOT NULL,
    "stationId" text NOT NULL,
    "createdByUserId" text NOT NULL,
    payload jsonb NOT NULL,
    "deviceCreatedAt" timestamp(3) without time zone NOT NULL,
    "receivedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "appliedAt" timestamp(3) without time zone,
    status public."SyncEventStatus" DEFAULT 'PENDING'::public."SyncEventStatus" NOT NULL,
    "errorMessage" text
);


ALTER TABLE public."SyncEvent" OWNER TO petrox;

--
-- Name: Tank; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Tank" (
    id text NOT NULL,
    "stationId" text,
    "depotId" text,
    "productId" text NOT NULL,
    name text NOT NULL,
    "capacityLiters" numeric(12,2) NOT NULL,
    status public."TankStatus" DEFAULT 'ACTIVE'::public."TankStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "reorderLevelLiters" numeric(12,2),
    CONSTRAINT "Tank_station_xor_depot_check" CHECK (((("stationId" IS NOT NULL) AND ("depotId" IS NULL)) OR (("stationId" IS NULL) AND ("depotId" IS NOT NULL))))
);


ALTER TABLE public."Tank" OWNER TO petrox;

--
-- Name: TankDip; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."TankDip" (
    id text NOT NULL,
    "tankId" text NOT NULL,
    "dippedLiters" numeric(12,2) NOT NULL,
    "dippedById" text NOT NULL,
    "dippedAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "productId" text NOT NULL
);


ALTER TABLE public."TankDip" OWNER TO petrox;

--
-- Name: Trip; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Trip" (
    id text NOT NULL,
    "shipmentId" text NOT NULL,
    "transportRevenue" numeric(12,2) DEFAULT 0 NOT NULL,
    "fuelCost" numeric(12,2) DEFAULT 0 NOT NULL,
    "driverAllowance" numeric(12,2) DEFAULT 0 NOT NULL,
    "maintenanceCost" numeric(12,2) DEFAULT 0 NOT NULL,
    "otherCost" numeric(12,2) DEFAULT 0 NOT NULL,
    status public."TripStatus" DEFAULT 'PLANNED'::public."TripStatus" NOT NULL,
    remarks text,
    "createdById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Trip" OWNER TO petrox;

--
-- Name: Truck; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Truck" (
    id text NOT NULL,
    "plateNumber" text NOT NULL,
    name text,
    "deviceId" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "carrierId" text,
    model text,
    "capacityLiters" numeric(12,2),
    "insuranceExpiryAt" timestamp(3) without time zone,
    "mileageKm" integer,
    "nextServiceKm" integer
);


ALTER TABLE public."Truck" OWNER TO petrox;

--
-- Name: TruckPosition; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."TruckPosition" (
    id text NOT NULL,
    "truckId" text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    "recordedAt" timestamp(3) without time zone NOT NULL,
    "recordedById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."TruckPosition" OWNER TO petrox;

--
-- Name: Unit; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."Unit" (
    id text NOT NULL,
    name text NOT NULL,
    symbol text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Unit" OWNER TO petrox;

--
-- Name: User; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    "passwordHash" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "firstName" text NOT NULL,
    "lastName" text NOT NULL,
    "roleId" text NOT NULL,
    phone text
);


ALTER TABLE public."User" OWNER TO petrox;

--
-- Name: UserStationAccess; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public."UserStationAccess" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "stationId" text NOT NULL
);


ALTER TABLE public."UserStationAccess" OWNER TO petrox;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: petrox
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO petrox;

--
-- Data for Name: Carrier; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Carrier" (id, name, "isActive", "createdAt", "updatedAt", address, email, "isOwnFleet", notes, phone, "taxId") FROM stdin;
\.


--
-- Data for Name: CompanySettings; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."CompanySettings" (id, "companyName", address, phone, email, "taxId", currency, "logoPath", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Depot; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Depot" (id, name, code, address, "isActive", "createdAt", "updatedAt", latitude, longitude) FROM stdin;
\.


--
-- Data for Name: Driver; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Driver" (id, name, phone, "licenseNumber", "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: MeterReading; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."MeterReading" (id, "nozzleId", "shiftId", "openingReading", "closingReading", "litersDispensed", "recordedAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: Nozzle; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Nozzle" (id, "pumpId", "tankId", "productId", label, "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: PasswordResetToken; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."PasswordResetToken" (id, "userId", "tokenHash", "expiresAt", "createdAt", "usedAt") FROM stdin;
\.


--
-- Data for Name: Permission; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Permission" (id, entity, action, "createdAt") FROM stdin;
034ee8a4-6168-4054-8dcc-d2b670df22f3	User	create	2026-08-06 06:44:55.206
88bc5687-a73a-4909-98a5-b9074da2ffd6	User	read	2026-08-06 06:44:55.288
4d84222f-442f-4a9d-b776-fb9e06dd8bbe	User	update	2026-08-06 06:44:55.314
5f71d8d1-8284-49b4-bda8-06a48fc4c8e4	User	deactivate	2026-08-06 06:44:55.331
0962e68f-bde1-420c-b004-0d5999e93c65	User	reactivate	2026-08-06 06:44:55.348
7689bf73-b18a-4041-b697-193654a39aef	Station	create	2026-08-06 06:44:55.383
92674cec-85db-48ea-aea6-4243aba7ccea	Station	read	2026-08-06 06:44:55.401
bb3ee917-d5af-46ba-9c2c-1b32ab916a25	Station	update	2026-08-06 06:44:55.43
2c5738c2-af33-4a92-8a33-36df860c29db	Station	deactivate	2026-08-06 06:44:55.461
77dc578e-a207-42dc-9af8-a77e64d8fb13	Station	reactivate	2026-08-06 06:44:55.488
8eda0510-accf-45f1-a377-ed4226face92	Depot	create	2026-08-06 06:44:55.515
89409871-31c2-4eed-88d2-ac3355257e4c	Depot	read	2026-08-06 06:44:55.541
10526917-eae6-4720-933f-0a086e24ce43	Depot	update	2026-08-06 06:44:55.574
1ba282ec-873a-4e65-bbcb-7bce09e2fbc7	Depot	deactivate	2026-08-06 06:44:55.613
014e8264-4b36-4e74-8614-1fd58c94587f	Depot	reactivate	2026-08-06 06:44:55.629
c5590a5a-7e23-4286-8102-1dad2600eac9	Product	create	2026-08-06 06:44:55.646
e76ee20c-8681-4a48-8851-491fa908c709	Product	read	2026-08-06 06:44:55.663
208b3a93-5498-49d7-89fb-5439f62d0c7c	Product	update	2026-08-06 06:44:55.68
26d26aac-9929-4502-b93c-229dbe8f8574	Product	deactivate	2026-08-06 06:44:55.697
c294ab32-69e1-4ae1-9d27-ce2e96b767d5	Product	reactivate	2026-08-06 06:44:55.714
88dde5cd-843e-4ddf-862e-64f9b2d04729	Unit	create	2026-08-06 06:44:55.731
41170959-2dde-4cf8-aa04-1bc05e2196d0	Unit	read	2026-08-06 06:44:55.748
79fa6189-c636-4487-8466-e538ea471d50	Unit	update	2026-08-06 06:44:55.765
c496cc00-24eb-4c4f-9fa9-3e377e16f18f	Unit	deactivate	2026-08-06 06:44:55.782
dca85f1e-eeef-4e0a-b6f9-5928ee63061f	Unit	reactivate	2026-08-06 06:44:55.799
b6d40be2-0097-4310-acbf-06fe4c0c683e	Supplier	create	2026-08-06 06:44:55.817
ad8914ac-71cd-4ad6-b77f-d589715b8661	Supplier	read	2026-08-06 06:44:55.833
d2546e08-08a0-4f7f-92a2-2bcdc2179365	Supplier	update	2026-08-06 06:44:55.85
8cf07648-dd08-4e61-8364-e309b7cd24c0	Supplier	deactivate	2026-08-06 06:44:55.867
59d56226-9deb-4848-ac3e-9bdf2b25de00	Supplier	reactivate	2026-08-06 06:44:55.91
c4075146-8596-494a-8011-43a3bc0142f9	StationTank	create	2026-08-06 06:44:56.179
886357eb-e672-44f2-a89f-84f570169773	StationTank	read	2026-08-06 06:44:56.439
46e5cc1b-7e2f-4fbc-ba00-feed607a44f0	StationTank	update	2026-08-06 06:44:56.945
03261bc4-d3ca-4478-9a19-84d13d3a7910	DepotTank	create	2026-08-06 06:44:56.973
285b3915-7f30-494e-bad8-58ffb2f3cc8c	DepotTank	update	2026-08-06 06:44:56.999
ed40c028-d791-4253-9642-dec69e4fceab	DepotTank	read	2026-08-06 06:44:57.028
9d79f674-955e-4ffc-a5f8-9f6b1a826f46	Pump	create	2026-08-06 06:44:57.055
1ed6b3f0-342a-4c81-9832-2ca89dc59c55	Pump	read	2026-08-06 06:44:57.085
7ca2967c-75ab-44fc-b285-a2ca03d7ea62	Pump	update	2026-08-06 06:44:57.112
f01c5ab2-0744-4f6a-a454-3ab83cdf05e3	Pump	deactivate	2026-08-06 06:44:57.14
73f894dd-6694-43b5-84ab-5d607e89aea8	Pump	reactivate	2026-08-06 06:44:57.168
7d4b11da-b8e2-4cdf-b6a2-a872c4502c66	Nozzle	create	2026-08-06 06:44:57.197
23f954fd-05d8-498d-9ab1-8f6704d46465	Nozzle	update	2026-08-06 06:44:57.22
ae31b9a1-add0-454b-8363-efdc2d7e3e85	Nozzle	deactivate	2026-08-06 06:44:57.237
3c12121d-1869-4c83-9b49-cadbb6e71d5c	Nozzle	reactivate	2026-08-06 06:44:57.254
3e5b66d7-c0e1-44a1-a9b7-36bf35cb6656	Reconciliation	read	2026-08-06 06:44:57.271
dc57d440-74ce-429d-acbd-a37ac7af7bf0	Reconciliation	depotOverview	2026-08-06 06:44:57.288
de41de26-bfb3-4e93-b33c-3ed1cf83b91a	Reconciliation	companyOverview	2026-08-06 06:44:57.309
919f9953-fee7-4424-af51-24bb5f95d301	Shipment	create	2026-08-06 06:44:57.336
e1f65d19-174b-4c56-a571-330265d41703	Shipment	read	2026-08-06 06:44:57.364
d97e54a6-b754-4b78-a94b-0fb062312af7	Shipment	update	2026-08-06 06:44:57.389
cc281a6f-9084-4dc5-aa20-8b291ae5a8d8	Shipment	approve	2026-08-06 06:44:57.407
a2c06cfc-feca-4b51-8740-e0653a98666b	Shipment	load	2026-08-06 06:44:57.48
e64a07e3-76fc-4b4d-9e1c-cf83876260c7	Shipment	dispatch	2026-08-06 06:44:57.51
0840105f-b172-455f-b85c-75bdf3d75171	Shipment	markArrived	2026-08-06 06:44:57.538
545dfab0-728d-4ec0-8313-2217ea2f98f7	Shipment	complete	2026-08-06 06:44:57.596
a35d1d81-d9ff-4863-bebd-45cc321c8883	Shipment	cancel	2026-08-06 06:44:57.625
2d773459-14f1-44d7-86f1-4d1fbfd053e5	Shipment	addStatusEvent	2026-08-06 06:44:57.659
756cb5dd-4379-4827-a8e8-d836844b2cdf	PurchaseOrder	create	2026-08-06 06:44:57.682
7d8a8b43-39a8-4f4a-b51f-a3902fa5acdc	PurchaseOrder	read	2026-08-06 06:44:57.709
f5502750-5c0d-44dc-96c4-96cc0495ff52	PurchaseOrder	submit	2026-08-06 06:44:57.725
94edb14d-ab1c-4507-a5ee-e81349d78230	PurchaseOrder	confirm	2026-08-06 06:44:57.743
3309542e-00cc-4136-bd72-3c596023c1c8	PurchaseOrder	cancel	2026-08-06 06:44:57.759
fec806f8-9f57-4b42-8dfc-d07664228935	StockAdjustment	create	2026-08-06 06:44:57.776
1fc62760-6cff-4434-95b8-312fda1e697b	StockAdjustment	read	2026-08-06 06:44:57.793
b8d80c96-f921-46ce-a3a4-64deaa95a3ff	StockMovement	read	2026-08-06 06:44:57.81
0636ba33-9082-409c-aab2-c42e6bb2a56b	StockReceipt	create	2026-08-06 06:44:57.838
063a4b7f-213b-44e3-a38b-a060a4873416	StockReceipt	read	2026-08-06 06:44:57.857
669a9103-949e-45e8-b4ac-dd97fbe87667	Dip	create	2026-08-06 06:44:57.874
00c885ad-4def-4c57-ae26-c7afc8b0667f	Dip	read	2026-08-06 06:44:57.903
3efb8ab7-4bcc-4415-ad6a-6d422346ebe1	MeterReading	create	2026-08-06 06:44:57.929
aca16289-6f16-4d35-bacf-215d99154405	MeterReading	read	2026-08-06 06:44:57.958
ceb142df-faa7-41ac-b288-3713265787a7	Shift	read	2026-08-06 06:44:57.987
72db679b-1ab6-44cc-b975-5c3a2022e2e9	Shift	startForOther	2026-08-06 06:44:58.015
a8419630-60e0-458b-ad14-cd185d5efdb4	Shift	close	2026-08-06 06:44:58.045
90e6ce7b-d54f-4e28-9e03-76f92a42f1b7	Permission	read	2026-08-06 06:44:58.076
efa25aaf-36d2-4844-a5a8-83efbda07a2d	Permission	manage	2026-08-06 06:44:58.12
073813a9-794c-4a27-ba28-090b431b3dca	Role	create	2026-08-06 06:44:58.169
bddedf95-dc0f-4d9d-a11e-8a4a84c3a9ad	Role	update	2026-08-06 06:44:58.205
5e54ad58-8af4-4d09-960d-5f7b4cb8a07c	Role	deactivate	2026-08-06 06:44:58.232
ef9e2082-c534-4f80-b372-5cfc665117cd	Role	reactivate	2026-08-06 06:44:58.261
527e01cb-5754-4c65-afe1-8729755a707b	Truck	create	2026-08-06 06:44:58.298
d50d0fbc-983f-4f81-969c-535ed1a37155	Truck	read	2026-08-06 06:44:58.328
dc5ef919-468b-4e32-a5ab-0ca6913e1549	Truck	update	2026-08-06 06:44:58.36
3be42155-5adc-43e3-a423-ab55afddda6b	Truck	deactivate	2026-08-06 06:44:58.395
d6ccda60-e9fd-4e74-8c77-f82d74748f55	Truck	reactivate	2026-08-06 06:44:58.423
b3ef218a-a369-4ae0-b1e8-9b3f33f95f60	Truck	reportPosition	2026-08-06 06:44:58.452
4640d0e8-4b9c-4bf7-8a64-9abe75ce45da	Truck	recordMileage	2026-08-06 06:44:58.479
b8ecabbd-6d3f-4c28-ae33-634ee29fb090	Truck	updateNextService	2026-08-06 06:44:58.508
5c061176-4464-414f-9a88-9a072ba0966a	Carrier	create	2026-08-06 06:44:58.536
fba21d20-712b-4e85-9ddc-20a1326e1dfa	Carrier	read	2026-08-06 06:44:58.558
1b4a8ca8-dc50-4043-a073-e37e602a3b38	Carrier	update	2026-08-06 06:44:58.575
fa05241f-2033-479c-bda3-65b255b0eae3	Carrier	deactivate	2026-08-06 06:44:58.592
fb74baae-0eeb-4979-8b39-b97a419bfbc1	Carrier	reactivate	2026-08-06 06:44:58.609
411e15e8-7c9d-491c-bd0c-d9eef3067dc8	Driver	create	2026-08-06 06:44:58.625
59afafd9-9e95-4a5c-bd18-be2a8b5a77cb	Driver	read	2026-08-06 06:44:58.643
41138a39-953d-4e34-9428-6f1d36bb94f6	Driver	update	2026-08-06 06:44:58.66
00886528-d1df-4c74-b6fb-405aae36771e	Driver	deactivate	2026-08-06 06:44:58.679
9fd94546-77af-4702-9bb3-4996a4822178	Driver	reactivate	2026-08-06 06:44:58.709
c1d1cbf6-fe89-4af7-b25d-a5b7190d68a3	Trip	create	2026-08-06 06:44:58.737
8dbc582d-6471-41c2-8602-20149947277e	Trip	read	2026-08-06 06:44:58.764
f03e3e8b-fa82-45f7-af4e-6c24ef4f1c1c	Trip	update	2026-08-06 06:44:58.793
dff3f6dc-5624-4ab2-b6be-9e860a64b814	Settings	read	2026-08-06 06:44:58.82
e808fae5-f936-4695-afbe-fc4f9bca5dec	Settings	update	2026-08-06 06:44:58.851
\.


--
-- Data for Name: Product; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Product" (id, name, code, "isActive", "createdAt", "updatedAt", "unitId") FROM stdin;
\.


--
-- Data for Name: Pump; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Pump" (id, "stationId", name, "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: PurchaseOrder; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."PurchaseOrder" (id, "supplierId", "destinationType", "destinationDepotId", "destinationStationId", status, "orderedById", "orderedAt", "expectedDeliveryAt", notes, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: PurchaseOrderLine; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."PurchaseOrderLine" (id, "purchaseOrderId", "productId", "quantityLiters", "unitPrice") FROM stdin;
\.


--
-- Data for Name: RefreshToken; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."RefreshToken" (id, "userId", "tokenHash", "expiresAt", "createdAt", "revokedAt") FROM stdin;
\.


--
-- Data for Name: Role; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Role" (id, name, "isFixed", "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: RolePermission; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."RolePermission" (id, role, "permissionId", "createdAt") FROM stdin;
b0882720-39f0-4cd1-9b4a-4af4bf7296b5	ADMINISTRATOR	034ee8a4-6168-4054-8dcc-d2b670df22f3	2026-08-06 06:44:59.081
1c8ce543-558a-4431-8d03-c04d611c7cf9	ADMINISTRATOR	88bc5687-a73a-4909-98a5-b9074da2ffd6	2026-08-06 06:44:59.148
c5bbbc61-348f-48fb-a403-2ae2553319bc	ADMINISTRATOR	4d84222f-442f-4a9d-b776-fb9e06dd8bbe	2026-08-06 06:44:59.174
60b3721a-6464-485b-ae34-80765f0242bf	ADMINISTRATOR	5f71d8d1-8284-49b4-bda8-06a48fc4c8e4	2026-08-06 06:44:59.201
65980aa6-8698-4216-a43b-b0350f04e6f3	ADMINISTRATOR	0962e68f-bde1-420c-b004-0d5999e93c65	2026-08-06 06:44:59.218
bb6fa27c-07bb-4e7c-8b7f-9a7b912a4e72	ADMINISTRATOR	7689bf73-b18a-4041-b697-193654a39aef	2026-08-06 06:44:59.236
0804097e-35c8-42fa-8daa-78d61f07f4a5	ADMINISTRATOR	92674cec-85db-48ea-aea6-4243aba7ccea	2026-08-06 06:44:59.253
1ec5ad29-5182-4504-98ae-b27b3b76963b	ADMINISTRATOR	bb3ee917-d5af-46ba-9c2c-1b32ab916a25	2026-08-06 06:44:59.27
79a18bc0-dfa8-4cf6-bf32-ae8059a264a3	ADMINISTRATOR	2c5738c2-af33-4a92-8a33-36df860c29db	2026-08-06 06:44:59.286
7a7b4a3c-96d4-48e0-ba5a-a648bf2f944a	ADMINISTRATOR	77dc578e-a207-42dc-9af8-a77e64d8fb13	2026-08-06 06:44:59.303
74e87532-b492-427a-9d11-acd6af97c25d	ADMINISTRATOR	8eda0510-accf-45f1-a377-ed4226face92	2026-08-06 06:44:59.32
a6d4c679-46b6-4162-82fe-8521d8d40e7e	ADMINISTRATOR	89409871-31c2-4eed-88d2-ac3355257e4c	2026-08-06 06:44:59.339
93589bd3-515f-45e6-b880-15a75e74bcc5	ADMINISTRATOR	10526917-eae6-4720-933f-0a086e24ce43	2026-08-06 06:44:59.359
8800ae06-f511-4144-a372-dfc6455b3030	ADMINISTRATOR	1ba282ec-873a-4e65-bbcb-7bce09e2fbc7	2026-08-06 06:44:59.393
3dd3d608-c76e-4ddc-9fac-82efe905c843	ADMINISTRATOR	014e8264-4b36-4e74-8614-1fd58c94587f	2026-08-06 06:44:59.432
47ec2f01-81f3-47f9-bff8-314cb031e39c	ADMINISTRATOR	c5590a5a-7e23-4286-8102-1dad2600eac9	2026-08-06 06:44:59.471
cf8a3b48-53e9-4958-aad2-2c00bb5e6d72	ADMINISTRATOR	e76ee20c-8681-4a48-8851-491fa908c709	2026-08-06 06:45:00.016
6b3422db-fad0-46ce-ad90-40eaa98df10b	ADMINISTRATOR	208b3a93-5498-49d7-89fb-5439f62d0c7c	2026-08-06 06:45:00.26
bd7c68e7-42f5-4870-939a-ed56749cd795	ADMINISTRATOR	26d26aac-9929-4502-b93c-229dbe8f8574	2026-08-06 06:45:00.505
e961dfcb-5a66-4321-a72a-c5c497600579	ADMINISTRATOR	c294ab32-69e1-4ae1-9d27-ce2e96b767d5	2026-08-06 06:45:00.736
f3196d82-f751-4aeb-abbe-3764c0333f8d	ADMINISTRATOR	88dde5cd-843e-4ddf-862e-64f9b2d04729	2026-08-06 06:45:00.965
5e802656-0c9a-4de4-8016-dd79840e5796	ADMINISTRATOR	41170959-2dde-4cf8-aa04-1bc05e2196d0	2026-08-06 06:45:01.185
c24eeb8d-648c-408b-9fb7-86353532cb18	ADMINISTRATOR	79fa6189-c636-4487-8466-e538ea471d50	2026-08-06 06:45:01.417
7031eae1-9caf-4e89-ae35-69c7e708ffbf	ADMINISTRATOR	c496cc00-24eb-4c4f-9fa9-3e377e16f18f	2026-08-06 06:45:01.644
4bc69283-3b83-42bf-8acf-bd303fb4fe68	ADMINISTRATOR	dca85f1e-eeef-4e0a-b6f9-5928ee63061f	2026-08-06 06:45:01.882
38dfda74-536e-4e44-8f9e-a5b290ec6a22	ADMINISTRATOR	b6d40be2-0097-4310-acbf-06fe4c0c683e	2026-08-06 06:45:02.103
9243f5c5-7590-4751-912a-bbe47093ab9d	ADMINISTRATOR	ad8914ac-71cd-4ad6-b77f-d589715b8661	2026-08-06 06:45:02.358
35903565-efb5-4d09-b476-423627e50b28	ADMINISTRATOR	d2546e08-08a0-4f7f-92a2-2bcdc2179365	2026-08-06 06:45:02.591
b614a6ec-900b-41a2-a3c4-e183fd905724	ADMINISTRATOR	8cf07648-dd08-4e61-8364-e309b7cd24c0	2026-08-06 06:45:02.811
a204e62d-b8e8-4d3e-89ad-b847ad8dfb6e	ADMINISTRATOR	59d56226-9deb-4848-ac3e-9bdf2b25de00	2026-08-06 06:45:03.056
221caf83-d737-40be-b785-42a38cd68da7	ADMINISTRATOR	c4075146-8596-494a-8011-43a3bc0142f9	2026-08-06 06:45:03.32
6e1e4d60-fe57-4da2-899c-533de752a4a7	ADMINISTRATOR	886357eb-e672-44f2-a89f-84f570169773	2026-08-06 06:45:03.577
81dcaedf-a669-4435-a07d-01bdd01146b4	ADMINISTRATOR	46e5cc1b-7e2f-4fbc-ba00-feed607a44f0	2026-08-06 06:45:03.818
34d34a57-26d5-48f4-826d-3af9686941fa	ADMINISTRATOR	03261bc4-d3ca-4478-9a19-84d13d3a7910	2026-08-06 06:45:04.079
18287dad-c913-4aae-9523-8df3d022b649	ADMINISTRATOR	285b3915-7f30-494e-bad8-58ffb2f3cc8c	2026-08-06 06:45:04.314
d2e61215-f7d9-4d2c-83c3-17cd0711325c	ADMINISTRATOR	ed40c028-d791-4253-9642-dec69e4fceab	2026-08-06 06:45:04.563
f0f0acc0-49ca-49e7-8266-ecb72d753324	ADMINISTRATOR	9d79f674-955e-4ffc-a5f8-9f6b1a826f46	2026-08-06 06:45:04.825
5881c3fe-bfd1-4e53-b0c4-9c4add89932d	ADMINISTRATOR	1ed6b3f0-342a-4c81-9832-2ca89dc59c55	2026-08-06 06:45:05.106
748e73de-06be-48a3-afe7-67cd1c042bce	ADMINISTRATOR	7ca2967c-75ab-44fc-b285-a2ca03d7ea62	2026-08-06 06:45:05.356
5d38d4e2-ae8c-4c8f-aabe-4926d7530ee3	ADMINISTRATOR	f01c5ab2-0744-4f6a-a454-3ab83cdf05e3	2026-08-06 06:45:05.626
fc2f9b62-612e-44b4-87ec-70df88d63b00	ADMINISTRATOR	73f894dd-6694-43b5-84ab-5d607e89aea8	2026-08-06 06:45:05.655
ecb9d232-eccf-4662-9cf2-537e5129e313	ADMINISTRATOR	7d4b11da-b8e2-4cdf-b6a2-a872c4502c66	2026-08-06 06:45:05.685
ee75b973-1aaa-4dc7-9d28-286775be15fc	ADMINISTRATOR	23f954fd-05d8-498d-9ab1-8f6704d46465	2026-08-06 06:45:05.722
b8d382ba-0faf-42e9-ac28-8e4b5324ae49	ADMINISTRATOR	ae31b9a1-add0-454b-8363-efdc2d7e3e85	2026-08-06 06:45:05.751
10b0fee5-de16-43a4-88c5-c9bda5b12594	ADMINISTRATOR	3c12121d-1869-4c83-9b49-cadbb6e71d5c	2026-08-06 06:45:05.789
bea41e28-4516-426b-90d5-149944f7f756	ADMINISTRATOR	3e5b66d7-c0e1-44a1-a9b7-36bf35cb6656	2026-08-06 06:45:05.818
93c2b62d-4348-45ed-91a8-574a50368cef	ADMINISTRATOR	dc57d440-74ce-429d-acbd-a37ac7af7bf0	2026-08-06 06:45:05.845
7d442327-57a2-4ffc-b9f7-4b86c14e2b65	ADMINISTRATOR	de41de26-bfb3-4e93-b33c-3ed1cf83b91a	2026-08-06 06:45:05.875
59101f78-bb65-41fd-8e9f-14467a75206c	ADMINISTRATOR	919f9953-fee7-4424-af51-24bb5f95d301	2026-08-06 06:45:05.913
7d858911-b7f0-42c1-b1e3-6c2a36f62fa6	ADMINISTRATOR	e1f65d19-174b-4c56-a571-330265d41703	2026-08-06 06:45:06.017
22fd3d23-2cac-49d3-b883-ba89de46fa42	ADMINISTRATOR	d97e54a6-b754-4b78-a94b-0fb062312af7	2026-08-06 06:45:06.057
23b263ed-d67c-4b3e-93c5-6dc1b28f0f29	ADMINISTRATOR	cc281a6f-9084-4dc5-aa20-8b291ae5a8d8	2026-08-06 06:45:06.084
964f00cc-f685-4d43-bf1c-b8274d3d069b	ADMINISTRATOR	a2c06cfc-feca-4b51-8740-e0653a98666b	2026-08-06 06:45:06.389
2391239e-e23d-46ce-aa39-33d6e235f964	ADMINISTRATOR	e64a07e3-76fc-4b4d-9e1c-cf83876260c7	2026-08-06 06:45:06.705
95fdb4f0-5743-4ac3-8c35-9baef90b4d97	ADMINISTRATOR	0840105f-b172-455f-b85c-75bdf3d75171	2026-08-06 06:45:07.281
fef7b392-3df9-497f-af91-8f069dfcf9b2	ADMINISTRATOR	545dfab0-728d-4ec0-8313-2217ea2f98f7	2026-08-06 06:45:07.314
1367580b-a2b3-4ccd-a40b-b98279777dfb	ADMINISTRATOR	a35d1d81-d9ff-4863-bebd-45cc321c8883	2026-08-06 06:45:07.343
6bbe423c-23f2-4566-a6b0-0b171a7b6f78	ADMINISTRATOR	2d773459-14f1-44d7-86f1-4d1fbfd053e5	2026-08-06 06:45:07.37
c185f9ce-a689-4f39-8aaf-09be93b99979	ADMINISTRATOR	756cb5dd-4379-4827-a8e8-d836844b2cdf	2026-08-06 06:45:07.398
47dfadf8-e667-4e2d-958e-f4d47f72e82a	ADMINISTRATOR	7d8a8b43-39a8-4f4a-b51f-a3902fa5acdc	2026-08-06 06:45:07.426
76b4faa7-b4d8-468a-895d-7c8591ae8eb6	ADMINISTRATOR	f5502750-5c0d-44dc-96c4-96cc0495ff52	2026-08-06 06:45:07.457
472fecd0-fa08-494f-8d72-6877e851fe7f	ADMINISTRATOR	94edb14d-ab1c-4507-a5ee-e81349d78230	2026-08-06 06:45:07.495
3132f071-5d0b-4545-be24-01576dcbd8bc	ADMINISTRATOR	3309542e-00cc-4136-bd72-3c596023c1c8	2026-08-06 06:45:07.532
1f0b0da6-8a9c-4a46-8d53-16126157cec3	ADMINISTRATOR	fec806f8-9f57-4b42-8dfc-d07664228935	2026-08-06 06:45:07.562
7c2279c0-8972-41ad-b94d-8330796feb52	ADMINISTRATOR	1fc62760-6cff-4434-95b8-312fda1e697b	2026-08-06 06:45:07.588
75bd5aba-56d2-442d-865a-d7484c4a2720	ADMINISTRATOR	b8d80c96-f921-46ce-a3a4-64deaa95a3ff	2026-08-06 06:45:07.617
da9ff917-d35c-46a1-b54a-ae8bcd14eecf	ADMINISTRATOR	0636ba33-9082-409c-aab2-c42e6bb2a56b	2026-08-06 06:45:07.655
4ba80b5c-d729-4c4c-ab2f-624b128771ef	ADMINISTRATOR	063a4b7f-213b-44e3-a38b-a060a4873416	2026-08-06 06:45:07.677
0f6851b4-2acf-4125-a84d-769898c30c55	ADMINISTRATOR	669a9103-949e-45e8-b4ac-dd97fbe87667	2026-08-06 06:45:07.693
024fc9ea-6951-4934-bdad-07a9ec01d1bf	ADMINISTRATOR	00c885ad-4def-4c57-ae26-c7afc8b0667f	2026-08-06 06:45:07.711
fb2ed7eb-6b05-43c4-8f81-fb34f857de33	ADMINISTRATOR	3efb8ab7-4bcc-4415-ad6a-6d422346ebe1	2026-08-06 06:45:07.727
b60000d4-e09d-42c8-aa2c-feac9ace7402	ADMINISTRATOR	aca16289-6f16-4d35-bacf-215d99154405	2026-08-06 06:45:07.745
15df12c8-e1f1-4fed-bd4a-a723eb74d735	ADMINISTRATOR	ceb142df-faa7-41ac-b288-3713265787a7	2026-08-06 06:45:07.762
c512f8ba-c1ca-41d6-bea4-83c4710e494b	ADMINISTRATOR	72db679b-1ab6-44cc-b975-5c3a2022e2e9	2026-08-06 06:45:07.78
f89167cb-2ae6-40ba-b08b-eab611520c72	ADMINISTRATOR	a8419630-60e0-458b-ad14-cd185d5efdb4	2026-08-06 06:45:07.805
faa47587-f6ba-4b7c-aa0a-71de9c339ecd	ADMINISTRATOR	90e6ce7b-d54f-4e28-9e03-76f92a42f1b7	2026-08-06 06:45:07.821
6a3b56f6-4e8e-48dd-9378-b096d0a5091e	ADMINISTRATOR	efa25aaf-36d2-4844-a5a8-83efbda07a2d	2026-08-06 06:45:07.838
cdda728e-0337-4524-ab00-0abe1efbf081	ADMINISTRATOR	073813a9-794c-4a27-ba28-090b431b3dca	2026-08-06 06:45:07.855
7baca716-2a29-44b5-85f2-2b290a7bb1d0	ADMINISTRATOR	bddedf95-dc0f-4d9d-a11e-8a4a84c3a9ad	2026-08-06 06:45:07.872
a0487165-26a6-4b5c-a25e-4105768cf344	ADMINISTRATOR	5e54ad58-8af4-4d09-960d-5f7b4cb8a07c	2026-08-06 06:45:07.889
9e6a3283-6cff-4b5a-9f25-2da5e47e5d7e	ADMINISTRATOR	ef9e2082-c534-4f80-b372-5cfc665117cd	2026-08-06 06:45:07.907
8d03332e-6519-418d-9d6a-7175ab663416	ADMINISTRATOR	527e01cb-5754-4c65-afe1-8729755a707b	2026-08-06 06:45:07.924
226f3e02-64eb-4701-920f-c30135ec0b17	ADMINISTRATOR	d50d0fbc-983f-4f81-969c-535ed1a37155	2026-08-06 06:45:07.946
d4cfae94-2d4a-466f-80c9-b31fc169787e	ADMINISTRATOR	dc5ef919-468b-4e32-a5ab-0ca6913e1549	2026-08-06 06:45:07.974
65201134-33cb-4b99-901c-9c4360295033	ADMINISTRATOR	3be42155-5adc-43e3-a423-ab55afddda6b	2026-08-06 06:45:07.997
949c5667-8229-440f-bcfe-8229ac537e3a	ADMINISTRATOR	d6ccda60-e9fd-4e74-8c77-f82d74748f55	2026-08-06 06:45:08.013
4222071c-3d75-4507-8558-d0e9c9f2678f	ADMINISTRATOR	b3ef218a-a369-4ae0-b1e8-9b3f33f95f60	2026-08-06 06:45:08.033
6fb4db2f-3cb0-4570-8848-9760bbfe78d2	ADMINISTRATOR	4640d0e8-4b9c-4bf7-8a64-9abe75ce45da	2026-08-06 06:45:08.059
f1eb3cce-7ff7-46bf-b63f-49b0953abe7a	ADMINISTRATOR	b8ecabbd-6d3f-4c28-ae33-634ee29fb090	2026-08-06 06:45:08.078
5224115f-4d75-4de6-8568-94c417cb28d1	ADMINISTRATOR	5c061176-4464-414f-9a88-9a072ba0966a	2026-08-06 06:45:08.107
8e62e002-c4a2-49cd-8f06-06fb682f5029	ADMINISTRATOR	fba21d20-712b-4e85-9ddc-20a1326e1dfa	2026-08-06 06:45:08.134
15a7e999-9e61-4988-9b89-992a1cdf3894	ADMINISTRATOR	1b4a8ca8-dc50-4043-a073-e37e602a3b38	2026-08-06 06:45:08.162
31927222-ddd8-43d5-b289-eea201c2340b	ADMINISTRATOR	fa05241f-2033-479c-bda3-65b255b0eae3	2026-08-06 06:45:08.19
e24277e5-209e-4a0a-8017-ce0196537682	ADMINISTRATOR	fb74baae-0eeb-4979-8b39-b97a419bfbc1	2026-08-06 06:45:08.219
2a885827-2aec-4a0c-b057-9be9f3a490c3	ADMINISTRATOR	411e15e8-7c9d-491c-bd0c-d9eef3067dc8	2026-08-06 06:45:08.247
f8be4a92-7422-46ce-ada2-51054a46df3d	ADMINISTRATOR	59afafd9-9e95-4a5c-bd18-be2a8b5a77cb	2026-08-06 06:45:08.278
fa931bc9-5f30-439a-8cf0-1356768c7078	ADMINISTRATOR	41138a39-953d-4e34-9428-6f1d36bb94f6	2026-08-06 06:45:08.307
ed97e367-1fa1-41c7-8fd1-3d0e78c7ecb1	ADMINISTRATOR	00886528-d1df-4c74-b6fb-405aae36771e	2026-08-06 06:45:08.336
1f0c3a33-388b-4354-89f2-c55e93c97337	ADMINISTRATOR	9fd94546-77af-4702-9bb3-4996a4822178	2026-08-06 06:45:08.367
c3359188-18db-4f78-b546-9cec3b8fbe41	ADMINISTRATOR	c1d1cbf6-fe89-4af7-b25d-a5b7190d68a3	2026-08-06 06:45:08.383
bf61f56c-e67a-454c-9ce0-1ae8d173ee67	ADMINISTRATOR	8dbc582d-6471-41c2-8602-20149947277e	2026-08-06 06:45:08.4
df5523fd-b405-4f67-b071-c6251e310048	ADMINISTRATOR	f03e3e8b-fa82-45f7-af4e-6c24ef4f1c1c	2026-08-06 06:45:08.417
7e786cbd-9f9b-4d8d-b89c-922a690b9eec	ADMINISTRATOR	dff3f6dc-5624-4ab2-b6be-9e860a64b814	2026-08-06 06:45:08.435
3893da7f-612e-479a-999c-07b0b0a58e59	ADMINISTRATOR	e808fae5-f936-4695-afbe-fc4f9bca5dec	2026-08-06 06:45:08.452
\.


--
-- Data for Name: RoleScope; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."RoleScope" (role, scope, "updatedAt") FROM stdin;
ADMINISTRATOR	COMPANY	2026-08-06 06:45:08.474
\.


--
-- Data for Name: Shift; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Shift" (id, "stationId", "attendantId", "startedAt", "endedAt", status, "createdAt") FROM stdin;
\.


--
-- Data for Name: Shipment; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Shipment" (id, "purchaseOrderId", type, "originType", "originSupplierId", "originDepotId", "originStationId", "originTankId", "destinationType", "destinationDepotId", "destinationStationId", status, "dispatchedAt", "estimatedArrivalAt", "deliveredAt", "createdById", "createdAt", "updatedAt", "truckId", "driverId", "plannedDispatchAt") FROM stdin;
\.


--
-- Data for Name: ShipmentLine; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."ShipmentLine" (id, "shipmentId", "productId", "dispatchedVolumeLiters") FROM stdin;
\.


--
-- Data for Name: ShipmentStatusEvent; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."ShipmentStatusEvent" (id, "shipmentId", status, note, "occurredAt", "recordedById") FROM stdin;
\.


--
-- Data for Name: Station; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Station" (id, name, code, address, email, phone, latitude, longitude, timezone, "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: StockAdjustment; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."StockAdjustment" (id, "tankId", "quantityLiters", reason, notes, "adjustedById", "adjustedAt", "createdAt", "productId") FROM stdin;
\.


--
-- Data for Name: StockMovement; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."StockMovement" (id, "tankId", type, "quantityLiters", "referenceType", "referenceId", "occurredAt", "recordedById", "createdAt", "productId") FROM stdin;
\.


--
-- Data for Name: StockReceipt; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."StockReceipt" (id, "shipmentId", "receivedById", "receivedAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: StockReceiptLine; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."StockReceiptLine" (id, "stockReceiptId", "productId", "destinationTankId", "receivedVolumeLiters") FROM stdin;
\.


--
-- Data for Name: Supplier; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Supplier" (id, name, "isActive", "createdAt", "updatedAt", address, email, notes, "paymentTerms", phone, "taxId", country) FROM stdin;
\.


--
-- Data for Name: SyncEvent; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."SyncEvent" (id, type, "stationId", "createdByUserId", payload, "deviceCreatedAt", "receivedAt", "appliedAt", status, "errorMessage") FROM stdin;
\.


--
-- Data for Name: Tank; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Tank" (id, "stationId", "depotId", "productId", name, "capacityLiters", status, "createdAt", "updatedAt", "reorderLevelLiters") FROM stdin;
\.


--
-- Data for Name: TankDip; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."TankDip" (id, "tankId", "dippedLiters", "dippedById", "dippedAt", "createdAt", "productId") FROM stdin;
\.


--
-- Data for Name: Trip; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Trip" (id, "shipmentId", "transportRevenue", "fuelCost", "driverAllowance", "maintenanceCost", "otherCost", status, remarks, "createdById", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Truck; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Truck" (id, "plateNumber", name, "deviceId", "isActive", "createdAt", "updatedAt", "carrierId", model, "capacityLiters", "insuranceExpiryAt", "mileageKm", "nextServiceKm") FROM stdin;
\.


--
-- Data for Name: TruckPosition; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."TruckPosition" (id, "truckId", latitude, longitude, "recordedAt", "recordedById", "createdAt") FROM stdin;
\.


--
-- Data for Name: Unit; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."Unit" (id, name, symbol, "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."User" (id, email, "passwordHash", "isActive", "createdAt", "updatedAt", "firstName", "lastName", "roleId", phone) FROM stdin;
\.


--
-- Data for Name: UserStationAccess; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public."UserStationAccess" (id, "userId", "stationId") FROM stdin;
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: petrox
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
40dd034d-d1b3-4a4a-ad77-1bfe0c1b470b	aae298b219486a105907fd572d3faf00ed2a0a6a83e996a003481d5adf4ebbdb	2026-08-05 15:42:05.906727+02	20260712135045_init	\N	\N	2026-08-05 15:41:51.860906+02	1
5c2b8fb4-9871-4c77-a1be-d17e876cce35	e5c1bb16a2bb803a1b6e4b960fd1fea75ac657f7070ca017379df8cb9b002227	2026-08-05 15:42:26.067613+02	20260723185842_carriers	\N	\N	2026-08-05 15:42:25.811649+02	1
438337fc-2696-4c5d-ae4d-6261f12d319f	8bc6090f2f53609795382b7ee2fb496eb973f5b7423de24b7bfcb2d6da3d440b	2026-08-05 15:42:05.974654+02	20260712135100_tank_location_check	\N	\N	2026-08-05 15:42:05.92418+02	1
36ed217f-a88e-4331-9720-105251350e55	4661c4d6e60b206e1f29dc32746608e85b56ff893997ed0ce948c757560fba0f	2026-08-05 15:42:06.110578+02	20260722173335_split_user_full_name	\N	\N	2026-08-05 15:42:05.992263+02	1
af8baee3-9d9c-437e-957b-bc3c02c540f7	7c91452fa6a1158372a2bf4a62f30132af05a291698aba676e06899d7f4ee7ac	2026-08-05 15:42:28.689342+02	20260724145043_snapshot_product_on_history	\N	\N	2026-08-05 15:42:28.503043+02	1
ca0093e4-0b71-4712-9224-910ed7d1ad86	b9448934d23c21a444d9c9757af33264f9d74981337eb7d9bf361da9a21126ef	2026-08-05 15:42:06.229919+02	20260722175900_depot_lat_lng	\N	\N	2026-08-05 15:42:06.128342+02	1
58d9681d-eef3-4ed4-bc6d-81412f1de60a	1446e7387eda2b37fd6de63ed005d82e5b165d2919269c83a826925728d913ff	2026-08-05 15:42:26.135275+02	20260723185843_carrier_details	\N	\N	2026-08-05 15:42:26.084855+02	1
b1a3769a-16e4-4925-95a8-06cb60576d8a	1ffad6a84bc699ae250f51329a473b0ace8807359ee6d21cb3c72d72e41fe1a8	2026-08-05 15:42:07.602274+02	20260722183416_permission_engine	\N	\N	2026-08-05 15:42:06.24681+02	1
bd2449a6-eab2-419e-aec6-7bf07696dd0e	8883e79eecc719a51108991acc60723e3b7eba6c9362965cf30860eccfc0d6e1	2026-08-05 15:42:07.808111+02	20260722185842_role_scope	\N	\N	2026-08-05 15:42:07.620555+02	1
ca108eb2-bee8-4625-a7af-062fc035a88e	bc5f802f0194a30ac0fbc14dcf2d00a1f7fc0934e5089da46ba333f29df60b41	2026-08-05 15:42:07.872938+02	20260722193749_administrator_role	\N	\N	2026-08-05 15:42:07.824937+02	1
56cadb08-eedc-475a-a574-be8dfc14bf82	f7dd01c3888c7471c93a69e7386b8c41765e3475bef85faf269463346a4b466d	2026-08-05 15:42:26.534543+02	20260723190000_trucks_rename	\N	\N	2026-08-05 15:42:26.153032+02	1
33a87082-05ff-42d2-8cd5-5c3d7e1cf4f1	1f8d2127e781ae744ae12dd1e37e4bf8220b6e6af449f488e196c8f9a07049e2	2026-08-05 15:42:09.816404+02	20260722195901_dynamic_roles	\N	\N	2026-08-05 15:42:07.89047+02	1
99939427-4beb-4a42-87f1-a70638288251	02718a88c712f88af4103a1e6a8e0ee6e1c4800da4129677b8890b4994d313b8	2026-08-05 15:42:12.739928+02	20260723075702_supplier_extra_fields	\N	\N	2026-08-05 15:42:10.617969+02	1
1ceadacf-6d72-474b-a0b8-a3deb458d589	ff27e743643ebf5cfc500731b44bac70430937eaf1be3a93b70b94e82b7ae08c	2026-08-05 15:42:21.226636+02	20260723145107_vehicles_and_gps_tracking	\N	\N	2026-08-05 15:42:12.987831+02	1
6f5c9e35-3a36-43f7-8c95-de2b4819f603	f22695ffec9cde658084c09047303da1c05967503476cf81863809a472aa0192	2026-08-05 15:42:26.60235+02	20260723190711_supplier_country	\N	\N	2026-08-05 15:42:26.552147+02	1
aaa659b1-199c-426b-9292-e0c1336c064e	7508c05977b0437c001436fa67b0f4978790ecbe92beae43f457490a6a712441	2026-08-05 15:42:24.729812+02	20260723173115_drivers	\N	\N	2026-08-05 15:42:21.477385+02	1
e45b91c0-8b77-44b6-b0a1-e62c0c89e283	79112a986b00e88871f06fd009d54d1d0a81947796c3176d19d86aff8c00c26c	2026-08-05 15:42:25.726352+02	20260723175551_shipment_planned_dispatch	\N	\N	2026-08-05 15:42:24.978953+02	1
263dfbe5-7130-4c54-868a-f41975780eb2	08ea1307fb6730202d50b1518b323ab99d376e34f87ff924fadeddc2f9d7f93a	2026-08-05 15:42:25.794104+02	20260723184718_drop_shipment_carrier_name	\N	\N	2026-08-05 15:42:25.743855+02	1
ff979aaf-27c7-4edd-b318-dc039f51ef61	daf9eb5a5472d446ff50268f59760769b06deade6bfee05edc93881fedf44c08	2026-08-05 15:42:26.67032+02	20260723192415_tank_reorder_level	\N	\N	2026-08-05 15:42:26.619792+02	1
b3ed6472-5554-4740-a0b1-b7c232ff6e12	dbf62f28fb8170ee05bfa13d5acbaf3f8f801d2ba6b9b02d028a13d9b053c9e7	2026-08-05 15:42:26.944128+02	20260723195800_trips	\N	\N	2026-08-05 15:42:26.689747+02	1
c2fa8e92-391f-4f37-9d8b-a5d43a16e0e3	facf6bf901d5a9af94738e88ff047c105b8ecda20ad8d5a22596588dc1136710	2026-08-05 15:42:27.126172+02	20260723202838_company_settings	\N	\N	2026-08-05 15:42:26.96163+02	1
25894a72-55d9-4cab-a664-df5efc143cc9	69f0b6de452c50c745d5bc8ccef74945acbc82e011cd76c5d496924a32037a16	2026-08-05 15:42:28.167437+02	20260724113606_user_phone_and_password_reset_tokens	\N	\N	2026-08-05 15:42:27.144177+02	1
65a89388-a8ef-4e98-9d93-74fba156cbef	97d9f7832ba174cceffd50b4c781d880d2e1eef8d7125a37182b604001024e69	2026-08-05 15:42:28.48602+02	20260724142202_units	\N	\N	2026-08-05 15:42:28.184672+02	1
\.


--
-- Name: Carrier Carrier_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Carrier"
    ADD CONSTRAINT "Carrier_pkey" PRIMARY KEY (id);


--
-- Name: CompanySettings CompanySettings_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."CompanySettings"
    ADD CONSTRAINT "CompanySettings_pkey" PRIMARY KEY (id);


--
-- Name: Depot Depot_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Depot"
    ADD CONSTRAINT "Depot_pkey" PRIMARY KEY (id);


--
-- Name: Driver Driver_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Driver"
    ADD CONSTRAINT "Driver_pkey" PRIMARY KEY (id);


--
-- Name: MeterReading MeterReading_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."MeterReading"
    ADD CONSTRAINT "MeterReading_pkey" PRIMARY KEY (id);


--
-- Name: Nozzle Nozzle_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Nozzle"
    ADD CONSTRAINT "Nozzle_pkey" PRIMARY KEY (id);


--
-- Name: PasswordResetToken PasswordResetToken_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY (id);


--
-- Name: Permission Permission_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Permission"
    ADD CONSTRAINT "Permission_pkey" PRIMARY KEY (id);


--
-- Name: Product Product_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_pkey" PRIMARY KEY (id);


--
-- Name: Pump Pump_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Pump"
    ADD CONSTRAINT "Pump_pkey" PRIMARY KEY (id);


--
-- Name: PurchaseOrderLine PurchaseOrderLine_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."PurchaseOrderLine"
    ADD CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY (id);


--
-- Name: PurchaseOrder PurchaseOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."PurchaseOrder"
    ADD CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY (id);


--
-- Name: RefreshToken RefreshToken_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."RefreshToken"
    ADD CONSTRAINT "RefreshToken_pkey" PRIMARY KEY (id);


--
-- Name: RolePermission RolePermission_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."RolePermission"
    ADD CONSTRAINT "RolePermission_pkey" PRIMARY KEY (id);


--
-- Name: RoleScope RoleScope_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."RoleScope"
    ADD CONSTRAINT "RoleScope_pkey" PRIMARY KEY (role);


--
-- Name: Role Role_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Role"
    ADD CONSTRAINT "Role_pkey" PRIMARY KEY (id);


--
-- Name: Shift Shift_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shift"
    ADD CONSTRAINT "Shift_pkey" PRIMARY KEY (id);


--
-- Name: ShipmentLine ShipmentLine_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."ShipmentLine"
    ADD CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY (id);


--
-- Name: ShipmentStatusEvent ShipmentStatusEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."ShipmentStatusEvent"
    ADD CONSTRAINT "ShipmentStatusEvent_pkey" PRIMARY KEY (id);


--
-- Name: Shipment Shipment_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shipment"
    ADD CONSTRAINT "Shipment_pkey" PRIMARY KEY (id);


--
-- Name: Station Station_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Station"
    ADD CONSTRAINT "Station_pkey" PRIMARY KEY (id);


--
-- Name: StockAdjustment StockAdjustment_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockAdjustment"
    ADD CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY (id);


--
-- Name: StockMovement StockMovement_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_pkey" PRIMARY KEY (id);


--
-- Name: StockReceiptLine StockReceiptLine_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockReceiptLine"
    ADD CONSTRAINT "StockReceiptLine_pkey" PRIMARY KEY (id);


--
-- Name: StockReceipt StockReceipt_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockReceipt"
    ADD CONSTRAINT "StockReceipt_pkey" PRIMARY KEY (id);


--
-- Name: Supplier Supplier_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Supplier"
    ADD CONSTRAINT "Supplier_pkey" PRIMARY KEY (id);


--
-- Name: SyncEvent SyncEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."SyncEvent"
    ADD CONSTRAINT "SyncEvent_pkey" PRIMARY KEY (id);


--
-- Name: TankDip TankDip_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."TankDip"
    ADD CONSTRAINT "TankDip_pkey" PRIMARY KEY (id);


--
-- Name: Tank Tank_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Tank"
    ADD CONSTRAINT "Tank_pkey" PRIMARY KEY (id);


--
-- Name: Trip Trip_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Trip"
    ADD CONSTRAINT "Trip_pkey" PRIMARY KEY (id);


--
-- Name: TruckPosition TruckPosition_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."TruckPosition"
    ADD CONSTRAINT "TruckPosition_pkey" PRIMARY KEY (id);


--
-- Name: Truck Truck_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Truck"
    ADD CONSTRAINT "Truck_pkey" PRIMARY KEY (id);


--
-- Name: Unit Unit_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Unit"
    ADD CONSTRAINT "Unit_pkey" PRIMARY KEY (id);


--
-- Name: UserStationAccess UserStationAccess_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."UserStationAccess"
    ADD CONSTRAINT "UserStationAccess_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: Depot_code_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Depot_code_key" ON public."Depot" USING btree (code);


--
-- Name: MeterReading_nozzleId_recordedAt_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "MeterReading_nozzleId_recordedAt_idx" ON public."MeterReading" USING btree ("nozzleId", "recordedAt");


--
-- Name: MeterReading_shiftId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "MeterReading_shiftId_idx" ON public."MeterReading" USING btree ("shiftId");


--
-- Name: Nozzle_pumpId_label_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Nozzle_pumpId_label_key" ON public."Nozzle" USING btree ("pumpId", label);


--
-- Name: Nozzle_tankId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "Nozzle_tankId_idx" ON public."Nozzle" USING btree ("tankId");


--
-- Name: PasswordResetToken_userId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "PasswordResetToken_userId_idx" ON public."PasswordResetToken" USING btree ("userId");


--
-- Name: Permission_entity_action_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Permission_entity_action_key" ON public."Permission" USING btree (entity, action);


--
-- Name: Product_code_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Product_code_key" ON public."Product" USING btree (code);


--
-- Name: Pump_stationId_name_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Pump_stationId_name_key" ON public."Pump" USING btree ("stationId", name);


--
-- Name: PurchaseOrder_destinationDepotId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "PurchaseOrder_destinationDepotId_idx" ON public."PurchaseOrder" USING btree ("destinationDepotId");


--
-- Name: PurchaseOrder_destinationStationId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "PurchaseOrder_destinationStationId_idx" ON public."PurchaseOrder" USING btree ("destinationStationId");


--
-- Name: RefreshToken_userId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "RefreshToken_userId_idx" ON public."RefreshToken" USING btree ("userId");


--
-- Name: RolePermission_role_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "RolePermission_role_idx" ON public."RolePermission" USING btree (role);


--
-- Name: RolePermission_role_permissionId_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "RolePermission_role_permissionId_key" ON public."RolePermission" USING btree (role, "permissionId");


--
-- Name: Role_name_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Role_name_key" ON public."Role" USING btree (name);


--
-- Name: Shift_stationId_status_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "Shift_stationId_status_idx" ON public."Shift" USING btree ("stationId", status);


--
-- Name: ShipmentStatusEvent_shipmentId_occurredAt_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "ShipmentStatusEvent_shipmentId_occurredAt_idx" ON public."ShipmentStatusEvent" USING btree ("shipmentId", "occurredAt");


--
-- Name: Shipment_destinationDepotId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "Shipment_destinationDepotId_idx" ON public."Shipment" USING btree ("destinationDepotId");


--
-- Name: Shipment_destinationStationId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "Shipment_destinationStationId_idx" ON public."Shipment" USING btree ("destinationStationId");


--
-- Name: Shipment_driverId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "Shipment_driverId_idx" ON public."Shipment" USING btree ("driverId");


--
-- Name: Shipment_status_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "Shipment_status_idx" ON public."Shipment" USING btree (status);


--
-- Name: Shipment_truckId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "Shipment_truckId_idx" ON public."Shipment" USING btree ("truckId");


--
-- Name: Station_code_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Station_code_key" ON public."Station" USING btree (code);


--
-- Name: StockAdjustment_tankId_adjustedAt_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "StockAdjustment_tankId_adjustedAt_idx" ON public."StockAdjustment" USING btree ("tankId", "adjustedAt");


--
-- Name: StockMovement_tankId_occurredAt_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "StockMovement_tankId_occurredAt_idx" ON public."StockMovement" USING btree ("tankId", "occurredAt");


--
-- Name: StockReceipt_shipmentId_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "StockReceipt_shipmentId_key" ON public."StockReceipt" USING btree ("shipmentId");


--
-- Name: SyncEvent_stationId_status_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "SyncEvent_stationId_status_idx" ON public."SyncEvent" USING btree ("stationId", status);


--
-- Name: TankDip_tankId_dippedAt_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "TankDip_tankId_dippedAt_idx" ON public."TankDip" USING btree ("tankId", "dippedAt");


--
-- Name: Tank_depotId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "Tank_depotId_idx" ON public."Tank" USING btree ("depotId");


--
-- Name: Tank_depotId_name_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Tank_depotId_name_key" ON public."Tank" USING btree ("depotId", name);


--
-- Name: Tank_stationId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "Tank_stationId_idx" ON public."Tank" USING btree ("stationId");


--
-- Name: Tank_stationId_name_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Tank_stationId_name_key" ON public."Tank" USING btree ("stationId", name);


--
-- Name: Trip_shipmentId_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Trip_shipmentId_key" ON public."Trip" USING btree ("shipmentId");


--
-- Name: TruckPosition_truckId_recordedAt_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "TruckPosition_truckId_recordedAt_idx" ON public."TruckPosition" USING btree ("truckId", "recordedAt");


--
-- Name: Truck_carrierId_idx; Type: INDEX; Schema: public; Owner: petrox
--

CREATE INDEX "Truck_carrierId_idx" ON public."Truck" USING btree ("carrierId");


--
-- Name: Truck_deviceId_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Truck_deviceId_key" ON public."Truck" USING btree ("deviceId");


--
-- Name: Truck_plateNumber_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Truck_plateNumber_key" ON public."Truck" USING btree ("plateNumber");


--
-- Name: Unit_name_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "Unit_name_key" ON public."Unit" USING btree (name);


--
-- Name: UserStationAccess_userId_stationId_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "UserStationAccess_userId_stationId_key" ON public."UserStationAccess" USING btree ("userId", "stationId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: petrox
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: MeterReading MeterReading_nozzleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."MeterReading"
    ADD CONSTRAINT "MeterReading_nozzleId_fkey" FOREIGN KEY ("nozzleId") REFERENCES public."Nozzle"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MeterReading MeterReading_shiftId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."MeterReading"
    ADD CONSTRAINT "MeterReading_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES public."Shift"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Nozzle Nozzle_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Nozzle"
    ADD CONSTRAINT "Nozzle_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Nozzle Nozzle_pumpId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Nozzle"
    ADD CONSTRAINT "Nozzle_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES public."Pump"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Nozzle Nozzle_tankId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Nozzle"
    ADD CONSTRAINT "Nozzle_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES public."Tank"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PasswordResetToken PasswordResetToken_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Product Product_unitId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES public."Unit"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Pump Pump_stationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Pump"
    ADD CONSTRAINT "Pump_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES public."Station"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PurchaseOrderLine PurchaseOrderLine_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."PurchaseOrderLine"
    ADD CONSTRAINT "PurchaseOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PurchaseOrderLine PurchaseOrderLine_purchaseOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."PurchaseOrderLine"
    ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES public."PurchaseOrder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PurchaseOrder PurchaseOrder_destinationDepotId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."PurchaseOrder"
    ADD CONSTRAINT "PurchaseOrder_destinationDepotId_fkey" FOREIGN KEY ("destinationDepotId") REFERENCES public."Depot"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PurchaseOrder PurchaseOrder_destinationStationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."PurchaseOrder"
    ADD CONSTRAINT "PurchaseOrder_destinationStationId_fkey" FOREIGN KEY ("destinationStationId") REFERENCES public."Station"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PurchaseOrder PurchaseOrder_orderedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."PurchaseOrder"
    ADD CONSTRAINT "PurchaseOrder_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PurchaseOrder PurchaseOrder_supplierId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."PurchaseOrder"
    ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES public."Supplier"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: RefreshToken RefreshToken_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."RefreshToken"
    ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: RolePermission RolePermission_permissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."RolePermission"
    ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES public."Permission"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Shift Shift_attendantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shift"
    ADD CONSTRAINT "Shift_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Shift Shift_stationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shift"
    ADD CONSTRAINT "Shift_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES public."Station"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShipmentLine ShipmentLine_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."ShipmentLine"
    ADD CONSTRAINT "ShipmentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ShipmentLine ShipmentLine_shipmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."ShipmentLine"
    ADD CONSTRAINT "ShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES public."Shipment"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShipmentStatusEvent ShipmentStatusEvent_recordedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."ShipmentStatusEvent"
    ADD CONSTRAINT "ShipmentStatusEvent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ShipmentStatusEvent ShipmentStatusEvent_shipmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."ShipmentStatusEvent"
    ADD CONSTRAINT "ShipmentStatusEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES public."Shipment"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Shipment Shipment_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shipment"
    ADD CONSTRAINT "Shipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Shipment Shipment_destinationDepotId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shipment"
    ADD CONSTRAINT "Shipment_destinationDepotId_fkey" FOREIGN KEY ("destinationDepotId") REFERENCES public."Depot"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Shipment Shipment_destinationStationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shipment"
    ADD CONSTRAINT "Shipment_destinationStationId_fkey" FOREIGN KEY ("destinationStationId") REFERENCES public."Station"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Shipment Shipment_driverId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shipment"
    ADD CONSTRAINT "Shipment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES public."Driver"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Shipment Shipment_originDepotId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shipment"
    ADD CONSTRAINT "Shipment_originDepotId_fkey" FOREIGN KEY ("originDepotId") REFERENCES public."Depot"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Shipment Shipment_originStationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shipment"
    ADD CONSTRAINT "Shipment_originStationId_fkey" FOREIGN KEY ("originStationId") REFERENCES public."Station"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Shipment Shipment_originSupplierId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shipment"
    ADD CONSTRAINT "Shipment_originSupplierId_fkey" FOREIGN KEY ("originSupplierId") REFERENCES public."Supplier"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Shipment Shipment_originTankId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shipment"
    ADD CONSTRAINT "Shipment_originTankId_fkey" FOREIGN KEY ("originTankId") REFERENCES public."Tank"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Shipment Shipment_purchaseOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shipment"
    ADD CONSTRAINT "Shipment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES public."PurchaseOrder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Shipment Shipment_truckId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Shipment"
    ADD CONSTRAINT "Shipment_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES public."Truck"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: StockAdjustment StockAdjustment_adjustedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockAdjustment"
    ADD CONSTRAINT "StockAdjustment_adjustedById_fkey" FOREIGN KEY ("adjustedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockAdjustment StockAdjustment_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockAdjustment"
    ADD CONSTRAINT "StockAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockAdjustment StockAdjustment_tankId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockAdjustment"
    ADD CONSTRAINT "StockAdjustment_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES public."Tank"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StockMovement StockMovement_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockMovement StockMovement_recordedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockMovement StockMovement_tankId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES public."Tank"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StockReceiptLine StockReceiptLine_destinationTankId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockReceiptLine"
    ADD CONSTRAINT "StockReceiptLine_destinationTankId_fkey" FOREIGN KEY ("destinationTankId") REFERENCES public."Tank"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockReceiptLine StockReceiptLine_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockReceiptLine"
    ADD CONSTRAINT "StockReceiptLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockReceiptLine StockReceiptLine_stockReceiptId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockReceiptLine"
    ADD CONSTRAINT "StockReceiptLine_stockReceiptId_fkey" FOREIGN KEY ("stockReceiptId") REFERENCES public."StockReceipt"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StockReceipt StockReceipt_receivedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockReceipt"
    ADD CONSTRAINT "StockReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockReceipt StockReceipt_shipmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."StockReceipt"
    ADD CONSTRAINT "StockReceipt_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES public."Shipment"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TankDip TankDip_dippedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."TankDip"
    ADD CONSTRAINT "TankDip_dippedById_fkey" FOREIGN KEY ("dippedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TankDip TankDip_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."TankDip"
    ADD CONSTRAINT "TankDip_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TankDip TankDip_tankId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."TankDip"
    ADD CONSTRAINT "TankDip_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES public."Tank"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Tank Tank_depotId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Tank"
    ADD CONSTRAINT "Tank_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES public."Depot"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Tank Tank_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Tank"
    ADD CONSTRAINT "Tank_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Tank Tank_stationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Tank"
    ADD CONSTRAINT "Tank_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES public."Station"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Trip Trip_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Trip"
    ADD CONSTRAINT "Trip_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Trip Trip_shipmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Trip"
    ADD CONSTRAINT "Trip_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES public."Shipment"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TruckPosition TruckPosition_recordedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."TruckPosition"
    ADD CONSTRAINT "TruckPosition_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TruckPosition TruckPosition_truckId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."TruckPosition"
    ADD CONSTRAINT "TruckPosition_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES public."Truck"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Truck Truck_carrierId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."Truck"
    ADD CONSTRAINT "Truck_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES public."Carrier"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: UserStationAccess UserStationAccess_stationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."UserStationAccess"
    ADD CONSTRAINT "UserStationAccess_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES public."Station"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserStationAccess UserStationAccess_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."UserStationAccess"
    ADD CONSTRAINT "UserStationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: User User_roleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: petrox
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public."Role"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict NcFjI348UPZntSjYvh9t5eITSi7pwV5CjRC4G20QsPeNWXR6kgtK6F0rhyXAXyL

