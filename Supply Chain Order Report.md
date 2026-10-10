# Supply Chain Report — Backend DTO + Frontend Reporting

## Objective

Implement a professional Supply Chain Report for the complete supply-chain lifecycle.

The current backend response contains deeply nested Prisma/database data. Do **not** expose this raw structure directly to the frontend or use it directly for PDF/Excel generation.

Create a dedicated **report DTO / reporting view model** on the backend containing only the business data required for reporting.

The frontend must consume the report DTO and present it in a clean, readable structure using:

* Summary cards
* Supply-chain flow
* Business tables
* Reconciliation tables
* Timeline
* PDF-friendly layout
* Excel-friendly tabular data

The report must be understandable by a business user without knowledge of database IDs or Prisma relationships.

---

# 1. First: Inspect the Existing Project

Before making changes:

1. Inspect the existing backend structure.
2. Identify:

   * Supply/order module
   * Cargo entities
   * Stock entities
   * Nomination entities
   * Loading data
   * PFI data
   * T1 validation data
   * Customs/extra validation data
   * Timeline/event data
   * Supplier
   * Item/product
   * Vehicle
   * Driver
3. Inspect existing:

   * Prisma schema
   * Services
   * Repositories
   * Controllers/routes
   * Zod schemas
   * DTO conventions
   * Existing report endpoints
4. Inspect the frontend report implementation.
5. Identify existing table, card, export, PDF, and Excel components.
6. Reuse the existing project architecture and naming conventions.

Do not introduce a new architecture if the project already has an established reporting pattern.

---

# 2. Important Architecture Rule

Separate these three layers:

```text
DATABASE / PRISMA
       ↓
REPORT SERVICE
       ↓
REPORT DTO
       ↓
FRONTEND REPORT UI
       ↓
PDF / EXCEL
```

Do not make the frontend understand the Prisma/database relationship structure.

Do not make PDF/Excel exporters traverse nested database objects.

The report DTO is the contract between backend and frontend.

---

# 3. Why a Dedicated Report DTO Is Required

The existing API response contains:

* UUIDs
* nested Prisma relations
* duplicated nominations
* duplicated vehicle information
* duplicated stock information
* internal status IDs
* database timestamps
* implementation-specific fields

This structure is useful for application/database operations but is not appropriate for reporting.

For example, the frontend should receive:

```ts
{
  orderCode: "ORD-DAA1E940E71D",
  product: "AGO",
  supplier: "YYUSSA",
  orderedQuantity: 1000,
  receivedQuantity: 1000,
  nominatedQuantity: 950,
  remainingQuantity: 50,
  currentStage: "stockReceived"
}
```

instead of having to navigate:

```text
order
 → cargos
   → stocks
     → nominations
       → driverVehicle
       → pfis
       → t1Validations
       → extraValidations
```

The backend owns the responsibility of transforming the database model into a reporting model.

---

# 4. Create Supply Chain Report DTO

Create a dedicated DTO/type similar to:

```ts
export interface SupplyChainReportDto {
  summary: SupplyChainSummaryDto;
  order: SupplyChainOrderDto;
  cargoes: SupplyChainCargoDto[];
  stocks: SupplyChainStockDto[];
  nominations: SupplyChainNominationDto[];
  loading: SupplyChainLoadingDto[];
  pfis: SupplyChainPfiDto[];
  t1Validations: SupplyChainT1Dto[];
  customs: SupplyChainCustomsDto[];
  reconciliation: SupplyChainReconciliationDto;
  timeline: SupplyChainTimelineDto[];
}
```

Use the project's existing DTO/Zod conventions.

If the project uses Zod schemas for API contracts, create the corresponding Zod schemas and inferred TypeScript types.

---

# 5. Summary DTO

Create:

```ts
interface SupplyChainSummaryDto {
  orderCode: string;
  product: string;
  supplier: string;
  orderDate: string;

  orderedQuantity: number;
  cargoReceivedQuantity: number;
  stockReceivedQuantity: number;
  nominatedQuantity: number;
  remainingQuantity: number;

  t1ValidatedQuantityAt20C: number;

  cargoCount: number;
  nominationCount: number;
  pfiCount: number;
  t1Count: number;

  currentStage: string;
  currentStageLevel: number;
}
```

The summary should contain business-level information only.

---

# 6. Order DTO

Create:

```ts
interface SupplyChainOrderDto {
  orderCode: string;
  orderDate: string;

  product: {
    name: string;
    unit: string;
  };

  supplier: {
    name: string;
    address?: string | null;
    phone?: string | null;
    tinNumber?: string | null;
  };

  orderedQuantity: number;

  plan?: {
    name: string;
    startDate: string;
    endDate: string;
    status: string;
  } | null;

  createdBy?: string | null;
}
```

Do not include database UUIDs unless they are specifically required for technical/audit purposes.

---

# 7. Cargo DTO

Each cargo must become one flat reporting row.

Example:

```ts
interface SupplyChainCargoDto {
  vesselName: string;
  depot: string;
  depotLocation?: string | null;

  blReference?: string | null;
  tansisReference?: string | null;
  outurnReference?: string | null;

  quantityLitres: number;
  quantityKg: number;

  receivedDate?: string | null;
  expirationDate?: string | null;

  status: string;
}
```

Example frontend table:

| Vessel     | Depot | BL Reference |    Quantity |     KG | Status   |
| ---------- | ----- | ------------ | ----------: | -----: | -------- |
| Vessel N-T | DR    | 7uuytt       |       500 L |     23 | Approved |
| Vessel N-K | DR    | reggr        |       500 L |     26 | Approved |
| **Total**  |       |              | **1,000 L** | **49** |          |

---

# 8. Stock DTO

Create one row for each stock receipt:

```ts
interface SupplyChainStockDto {
  vesselName: string;
  depot: string;
  quantity: number;
  receivedDate: string;
  status: string;
}
```

Frontend:

| Vessel     | Depot |    Quantity | Received Date | Status   |
| ---------- | ----- | ----------: | ------------- | -------- |
| Vessel N-T | DR    |       500 L | 23 Sep 2026   | Received |
| Vessel N-K | DR    |       500 L | 23 Sep 2026   | Received |
| **Total**  |       | **1,000 L** |               |          |

---

# 9. Nomination DTO

Flatten the nomination and transportation information.

```ts
interface SupplyChainNominationDto {
  nominationId: string;

  destination: string;
  nominatedQuantity: number;
  remainingQuantity: number;

  expectedLoadingDate?: string | null;

  driver?: {
    name: string;
    phone?: string | null;
    licence?: string | null;
  } | null;

  vehicle?: {
    plateNumber: string;
    truckNumber?: string | null;
    trailerNumber?: string | null;
    model?: string | null;
    tankCapacity?: number | null;
  } | null;

  currentStage: string;
  currentStageLevel: number;
}
```

Only expose the nomination ID if it is useful for business/audit purposes.

---

# 10. Loading DTO

Every loading record must become a separate row.

```ts
interface SupplyChainLoadingDto {
  vesselName: string;
  blReference?: string | null;
  quantity: number;
  loadedAt: string;
}
```

For the provided example:

| Vessel     | BL Reference | Loaded Quantity | Loaded At   |
| ---------- | ------------ | --------------: | ----------- |
| Vessel N-T | 7uuytt       |           450 L | 24 Sep 2026 |
| Vessel N-K | reggr        |           400 L | 24 Sep 2026 |
| Vessel N-K | reggr        |           100 L | 24 Sep 2026 |
| **Total**  |              |       **950 L** |             |

---

# 11. PFI DTO

Create:

```ts
interface SupplyChainPfiDto {
  pfiCode: string;
  pfiReference?: string | null;

  currency: string;
  unitPrice: number;
  amount: number;

  vehiclePlate?: string | null;

  createdAt: string;
}
```

Frontend:

| PFI Code      | Reference | Currency | Unit Price | Amount | Vehicle  |
| ------------- | --------- | -------- | ---------: | -----: | -------- |
| PFI7A5351954F | PFIfff099 | RWF      |        595 |    200 | RAB2234C |

---

# 12. T1 DTO

Create:

```ts
interface SupplyChainT1Dto {
  exportingCountry: string;
  quantityAt20C: number;

  supportingDocument?: string | null;

  createdAt: string;
}
```

Frontend:

| Exporting Country | Quantity @20°C | Date        |
| ----------------- | -------------: | ----------- |
| Rwanda            |          945 L | 24 Sep 2026 |

---

# 13. Customs DTO

Flatten `extraValidations`.

```ts
interface SupplyChainCustomsDto {
  customsOffice: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}
```

Frontend:

| Customs Office | Status    | Date        |
| -------------- | --------- | ----------- |
| KANAMBO        | Confirmed | 24 Sep 2026 |

---

# 14. Reconciliation DTO

This is one of the most important parts of the report.

Create:

```ts
interface SupplyChainReconciliationDto {
  ordered: number;
  cargoReceived: number;
  stockReceived: number;
  nominated: number;
  remaining: number;

  t1ValidatedAt20C: number;

  nominationVsT1Variance: number;
}
```

For the supplied data:

```text
Ordered                 1,000 L
Cargo received          1,000 L
Stock received          1,000 L
Nominated                 950 L
Remaining                  50 L
T1 @20°C                  945 L
Nomination/T1 variance      5 L
```

Do not silently hide differences.

If a calculation produces a discrepancy, expose it clearly in the report.

---

# 15. Timeline DTO

Convert the database timeline/events into a flat chronological list.

```ts
interface SupplyChainTimelineDto {
  at: string;
  stage: string;
  title: string;
  detail?: string | null;
  performedBy?: string | null;
}
```

Example:

| Date/Time    | Stage         | Activity           | Details               | By                   |
| ------------ | ------------- | ------------------ | --------------------- | -------------------- |
| 23 Sep 08:33 | Order         | Order raised       | 1,000 AGO from YYUSSA | System Administrator |
| 23 Sep 12:26 | Cargo         | Cargo recorded     | Vessel N-T, 500 L     | —                    |
| 23 Sep 12:28 | Cargo         | Cargo recorded     | Vessel N-K, 500 L     | —                    |
| 23 Sep 12:45 | Stock         | Stock received     | 500 L from N-T        | —                    |
| 23 Sep 12:47 | Stock         | Stock received     | 500 L from N-K        | —                    |
| 24 Sep 10:05 | Nomination    | Nomination created | 950 L → Kigali        | System Administrator |
| 24 Sep 10:28 | PFI           | PFI raised         | 200 RWF               | System Administrator |
| 24 Sep 12:21 | T1            | T1 validation      | 945 L @20°C           | System Administrator |
| 24 Sep 12:21 | Customs       | Customs confirmed  | KANAMBO               | —                    |
| 24 Sep 12:23 | Central Stock | Stock received     | RAB2234C → Kigali     | System Administrator |

Sort this chronologically on the backend.

---

# 16. Backend Service

Create a dedicated method such as:

```ts
async getSupplyChainReport(orderId: string): Promise<SupplyChainReportDto>
```

Responsibilities:

1. Fetch only the required relations/fields.
2. Avoid selecting unnecessary database fields.
3. Avoid exposing UUIDs that are not useful to the report.
4. Deduplicate nested relationships.
5. Normalize numeric database values.
6. Normalize dates.
7. Flatten nested relationships.
8. Calculate reconciliation values.
9. Build timeline.
10. Return the final DTO.

Do not simply do:

```ts
return prisma.order.findUnique(...)
```

The service must explicitly construct the report DTO.

---

# 17. Avoid Duplicate Data

The provided response demonstrates an important problem:

The same nomination appears multiple times because it is reachable through multiple cargo/stock relationships.

Do NOT produce duplicate report rows.

For example, if the same nomination ID appears three times in the database response, the report must contain:

```text
1 nomination
```

not:

```text
3 nominations
```

Use appropriate maps/sets/grouping where necessary.

Likewise, do not duplicate:

* Driver
* Vehicle
* PFI
* T1
* Customs
* Timeline events

just because they are reachable through different Prisma relations.

---

# 18. Number Handling

Database numeric/decimal values may arrive as:

```ts
"1000"
"950"
"945"
```

or Prisma Decimal objects.

Convert them into numbers in the report DTO.

Do not send inconsistent numeric representations to the frontend.

Example:

```ts
orderedQuantity: 1000
```

not:

```ts
orderedQuantity: "1000"
```

unless the existing API contract specifically requires strings for precision.

If financial Decimal values require precision, follow the project's existing Decimal strategy and do not introduce floating-point errors.

---

# 19. Date Handling

Return ISO dates/timestamps from the API.

Frontend should format them for display.

Example API:

```text
2026-09-24T12:23:25.350Z
```

Frontend:

```text
24 Sep 2026, 14:23
```

Do not permanently format dates in the backend if the API is also consumed by other clients.

---

# 20. Frontend Report Structure

Build the report in this order:

```text
Supply Chain Report
│
├── Report Header
│
├── Summary
│
├── Supply Chain Flow
│
├── Order Information
│
├── Cargo Receipts
│
├── Stock Receipts
│
├── Nomination & Transport
│
├── Loading Breakdown
│
├── PFI
│
├── T1 Validation
│
├── Customs
│
├── Reconciliation
│
└── Activity Timeline
```

---

# 21. Summary UI

Use summary cards:

```text
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Ordered      │ │ Received     │ │ Nominated    │
│ 1,000 L      │ │ 1,000 L      │ │ 950 L        │
└──────────────┘ └──────────────┘ └──────────────┘

┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Remaining    │ │ T1 @20°C     │ │ Current Stage│
│ 50 L         │ │ 945 L        │ │ Stock Rec.   │
└──────────────┘ └──────────────┘ └──────────────┘
```

Use the project's existing UI component library.

---

# 22. Supply Chain Flow

Create a visual flow:

```text
ORDER
1,000 L
   ↓
CARGO
1,000 L
   ↓
STOCK
1,000 L
   ↓
NOMINATION
950 L
   ↓
LOADING
950 L
   ↓
T1
945 L @20°C
   ↓
CUSTOMS
KANAMBO ✓
   ↓
CENTRAL STOCK
KIGALI
```

This should be compact and printable.

Do not create an unnecessarily complex graphical visualization.

---

# 23. Tables

All major datasets should use proper tables.

Required tables:

### Cargo

```text
Vessel | Depot | BL | Quantity | KG | Status
```

### Stock

```text
Vessel | Depot | Quantity | Received Date | Status
```

### Loading

```text
Vessel | BL | Quantity | Loaded At
```

### PFI

```text
PFI Code | Reference | Currency | Unit Price | Amount | Vehicle
```

### T1

```text
Country | Quantity @20°C | Date
```

### Customs

```text
Office | Status | Date
```

### Timeline

```text
Date/Time | Stage | Activity | Details | By
```

---

# 24. PDF Requirements

The report must be printable and readable.

Requirements:

* A4-friendly layout
* Landscape where wide tables require it
* Repeat table headers across pages
* Avoid tables overflowing the page
* Use consistent typography
* Use clear section headings
* Use page numbers
* Include report generation date
* Include order code in header/footer
* Avoid printing UUIDs unless necessary
* Keep rows together where possible
* Do not split important summary blocks awkwardly
* Make totals visually obvious
* Ensure the report remains readable when printed in grayscale

The PDF should look like a professional operational/business report, not a debug dump.

---

# 25. Excel Requirements

Generate a workbook with separate sheets:

```text
Summary
Order
Cargo
Stock
Nominations
Loading
PFI
T1 & Customs
Reconciliation
Timeline
```

Each sheet should contain a proper flat table.

Do not put nested JSON into Excel cells.

Use:

* Header formatting
* Freeze panes
* Auto filters
* Appropriate column widths
* Number formats
* Date formats
* Total rows
* Consistent naming
* No UUID columns unless useful for audit/technical purposes

The `Summary` sheet should be the first sheet.

---

# 26. Export Architecture

Use the same report DTO for both exports:

```text
Prisma
   ↓
SupplyChainReportService
   ↓
SupplyChainReportDto
   ├───────────────┐
   ↓               ↓
Frontend UI      Export
                  ├── PDF
                  └── Excel
```

Do not create different business calculations for PDF and Excel.

For example, `remainingQuantity` must be calculated once by the report service, not independently by:

```text
PDF exporter
Excel exporter
Frontend
```

This prevents inconsistent reports.

---

# 27. Backend API

Create or update an endpoint following the existing project conventions, for example:

```http
GET /orders/:orderId/supply-chain-report
```

Response:

```json
{
  "success": true,
  "data": {
    "summary": {},
    "order": {},
    "cargoes": [],
    "stocks": [],
    "nominations": [],
    "loading": [],
    "pfis": [],
    "t1Validations": [],
    "customs": [],
    "reconciliation": {},
    "timeline": []
  }
}
```

Follow the existing response envelope and authentication/authorization conventions.

Do not invent a new authentication mechanism.

---

# 28. Data Selection Optimization

Do not fetch the entire Prisma graph just because it is available.

Use Prisma `select` to retrieve only fields needed for the report.

Avoid:

```ts
include: {
  everything: true
}
```

Prefer targeted selections.

The goal is:

```text
Database
   ↓
Only required fields
   ↓
Report transformation
   ↓
Small clean DTO
```

This reduces:

* API response size
* memory usage
* frontend processing
* duplicated data
* PDF/Excel complexity

---

# 29. Important Business Rules

Implement these calculations explicitly:

### Ordered

```ts
ordered = order.quantity
```

### Cargo received

```ts
cargoReceived = sum(cargo.quantityInLitre)
```

### Stock received

```ts
stockReceived = sum(stock.quantity)
```

### Nominated

Use the unique nomination quantities.

```ts
nominated = sum(uniqueNomination.fromThisOrder)
```

or the project's established business rule if `fromThisOrder` is not the authoritative field.

### Remaining

```ts
remaining = ordered - nominated
```

### T1 variance

```ts
nominationVsT1Variance =
  nominated - t1ValidatedQuantityAt20C
```

For the provided example:

```text
950 - 945 = 5 L
```

Never hide this discrepancy.

---

# 30. Current Stage

Determine the current stage from the highest/latest valid timeline stage.

Example:

```text
awaiting       level 1
underLoading   level 2
t1Pending      level 3
t1Confirmed   level 4
stockReceived  level 5
```

The report should show:

```text
Current Stage: Stock Received
```

not:

```text
Current Stage: stockReceived
```

Use a display-label mapping.

Keep the underlying status value available if needed by the frontend logic.

---

# 31. Empty States

The report must handle missing data.

Examples:

```text
No PFI recorded
No T1 validation recorded
No customs validation recorded
No nomination recorded
No loading records
```

Do not crash because an optional relationship is null or an array is empty.

For tables with no records, show a clean empty state.

---

# 32. Do Not Change Business Logic Unnecessarily

This task is primarily a reporting transformation.

Do not modify:

* Order creation logic
* Cargo creation logic
* Stock logic
* Nomination logic
* PFI workflow
* T1 workflow
* Customs workflow

unless a clear bug is discovered that directly prevents reporting.

If an existing field has ambiguous business meaning, inspect how it is currently used before changing it.

---

# 33. Testing

Add tests for the report service.

At minimum test:

### Complete supply chain

```text
1 order
2 cargoes
2 stocks
1 nomination
3 loading records
1 PFI
1 T1
1 customs validation
```

Verify:

```text
ordered = 1000
cargoReceived = 1000
stockReceived = 1000
nominated = 950
remaining = 50
t1 = 945
variance = 5
```

### No nomination

Verify:

```text
nominated = 0
remaining = ordered
```

### Partial cargo

Verify reconciliation correctly shows outstanding quantity.

### Multiple nominations

Ensure each nomination appears once.

### Shared nomination references

Ensure duplicate nested relationships do not create duplicate report rows.

### Missing PFI

Report still works.

### Missing T1

Report still works.

### Missing customs

Report still works.

### Empty cargo

Report still works.

---

# 34. Final Implementation Rule

Before finishing, verify that the final architecture is:

```text
                 ┌───────────────┐
                 │    Prisma     │
                 └───────┬───────┘
                         │
                         ▼
             ┌─────────────────────┐
             │ SupplyChainReport   │
             │      Service        │
             └──────────┬──────────┘
                        │
                        ▼
             ┌─────────────────────┐
             │ SupplyChainReport   │
             │        DTO          │
             └──────────┬──────────┘
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
       ┌─────────────┐     ┌──────────────┐
       │  Frontend   │     │   Exporters  │
       │   Report    │     │              │
       └─────────────┘     │ PDF / Excel  │
                           └──────────────┘
```

The report must answer these business questions immediately:

1. What was ordered?
2. From whom?
3. What cargo arrived?
4. How much entered stock?
5. How much was nominated?
6. Which vehicle and driver are responsible?
7. How was the load distributed across vessels?
8. What PFI was created?
9. What quantity was validated at 20°C?
10. Which customs office handled it?
11. What is the current stage?
12. Is there any quantity discrepancy?
13. What happened and when?

Do not expose the complexity of the database model to the report consumer.

The final result should be a **clear operational supply-chain report**, not a formatted copy of the API JSON.
