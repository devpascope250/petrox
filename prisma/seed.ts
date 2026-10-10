/**
 * The one PetroX seed. Run it on an empty database or an existing one: every
 * step is an upsert, so running it again changes nothing and never deletes.
 *
 *   pnpm prisma:seed            reference data only — what every environment needs
 *   pnpm prisma:seed --demo     reference data plus a complete test dataset
 *                               (or SEED_DEMO=true)
 *
 * Reference data
 *   - the whole sidebar: every module, and on each page module its
 *     read / create / edit / delete / manage permissions — the codes the API
 *     checks (a grouping module shows on its own once any child is permitted)
 *   - roles: System Administrator (everything), PSS MANAGER, Client, Client user
 *   - the administrator account, and the nomination timeline statuses
 *
 * Test dataset (--demo): one working station, NYABUGOGO, ready for the admin
 * panel and the POS end to end — products with units and prices, tanks,
 * pumps, displays and nozzles, shifts, payment accounts, card types and their
 * rules, cards held by two clients (a main card, its copy, a postpaid card),
 * the clients' cars assigned to those cards, and staff: a site manager, a POS
 * attendant (phone + PIN) and a client administrator.
 *
 * Passwords and PINs come from the environment. In production the defaults
 * are refused, so a public server never gets a known password:
 *   SEED_ADMIN_EMAIL (admin@petrox.local), SEED_ADMIN_PASSWORD, SEED_ADMIN_PIN,
 *   SEED_DEMO_PASSWORD (all demo users), SEED_DEMO_PIN (attendant and manager).
 * Card PINs are the default card PIN, 123456, as for any newly assigned card.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient, type Prisma, type TimeLineStatus } from "./generated/prisma/client.js";
import { loadConfig } from "../src/config/env.js";
import { hashPin } from "../src/utils/crypto.js";
import { DEFAULT_CARD_PIN, hashCardPin } from "../src/modules/cards/card-pin.js";

/* ------------------------------------------------------------------------ */
/* Module catalogue                                                          */
/* ------------------------------------------------------------------------ */

export const PERMISSION_ACTIONS = ["read", "create", "edit", "delete", "manage"] as const;

export interface ModuleNode {
  /** Kept from the original catalogue, so databases seeded before keep their ids. */
  id?: string;
  code: string;
  name: string;
  icon: string;
  /** Permission code prefix for a page module (`cards` → `cards.read` …). Grouping modules have none. */
  prefix?: string;
  children?: ModuleNode[];
}

/**
 * The sidebar, top to bottom. Codes are the ones the admin panel's module
 * registry maps to its pages; prefixes are the permission codes the API's
 * routes check.
 */
export const MODULE_TREE: ModuleNode[] = [
  { id: "e805d56d-893b-4e36-8872-29d567a4bc5e", code: "GENERAL_SETTINGS", name: "General Settings", icon: "Settings", children: [
    { id: "87280ccc-09e6-4daf-902d-ceae513c0ba9", code: "SYSTEM_SETTINGS", name: "System Settings", icon: "Cog", children: [
      { id: "479396de-59be-487e-8210-8d35e44f4b59", code: "MODULES", name: "Modules", icon: "Blocks", prefix: "modules" },
      { id: "dd8b6546-baca-4f59-aa5f-c4df163bf354", code: "ROLES", name: "Roles", icon: "ShieldCheck", prefix: "roles" },
      { id: "099b14e7-d52d-4f8b-b5be-64bbae585ffe", code: "USERS", name: "Users", icon: "Users", prefix: "users" },
      { id: "a5ef8f60-cf84-4b2e-9b66-370f01be08a8", code: "ITEMS", name: "Items", icon: "Boxes", prefix: "items" },
      { code: "ITEM_PRICE", name: "Item Price", icon: "Tags", prefix: "item.price" },
      { code: "ITEM_UNITS", name: "Item Units", icon: "Layers", prefix: "item.units" },
      { id: "e201a84e-0df4-4adb-abd0-605f690f4a19", code: "UNITS", name: "Units", icon: "Ruler", prefix: "units" },
      { id: "61c48621-8852-4ac9-b311-cc5693944409", code: "COMPANY_ACCOUNT", name: "Company Account", icon: "Landmark", prefix: "company.account" },
      { code: "CLIENTS", name: "Clients", icon: "Contact", prefix: "clients" },
      { code: "CLIENT_CARS", name: "Client Cars", icon: "Car", prefix: "client.cars" },
      { id: "089c52a4-2410-4d20-b28e-928774577699", code: "CARDS", name: "Cards", icon: "IdCard", prefix: "cards" },
      { code: "CARD_TYPES", name: "Card Types", icon: "Tags", prefix: "card.types" },
      { id: "24977f79-d7f5-4992-97da-a53e77945375", code: "CARDS_COPY", name: "Card Copies", icon: "Copy", prefix: "cards.copy" },
      { id: "dc9d46aa-34d8-47e1-af13-09337412f428", code: "DISCOUNTS", name: "Discounts", icon: "Percent", prefix: "discounts" },
    ] },
  ] },
  { code: "CLIENT_MANAGEMENT", name: "Client Management", icon: "BriefcaseBusiness", children: [
    { code: "WALLETS", name: "Wallets", icon: "HandCoins", children: [
      { id: "761593dd-c11d-4cc2-bd80-0357d890282d", code: "CLIENT_WALLETS", name: "Client Wallets", icon: "Wallet", prefix: "client.wallets" },
    ] },
    { id: "7e9e820a-3b87-45ca-8b9d-2b9f8382b3b9", code: "COUPON_PLANS", name: "Coupon Plans", icon: "Tags", prefix: "coupon.plans" },
    { id: "7f49a972-e3bb-4c7d-a6a8-ed61678d9f60", code: "CLIENT_COUPONS", name: "Client Coupons", icon: "Stamp", prefix: "client.coupons" },
    { id: "cd3af1b2-3506-4269-9534-ff5da96a7431", code: "COUPON_SALES", name: "Coupon Sales", icon: "Ticket", prefix: "coupon.sales" },
  ] },
  { id: "a3d0a204-7a15-451a-baac-ae78815a16ef", code: "SUPPLY_CHAIN", name: "Supply Chain", icon: "Workflow", children: [
    { id: "349089d1-bc1e-49f8-b337-3b0e5470bddd", code: "SUPPLY_CHAIN_SETTINGS", name: "Supply Chain Settings", icon: "SlidersHorizontal", children: [
      { id: "f4fa5e12-e5d9-4bc1-9102-664d9e2c3066", code: "SUPPLIERS", name: "Suppliers", icon: "Building2", prefix: "suppliers" },
      { id: "b2edf75e-6219-4947-8cd6-54485efa609e", code: "SUPPLIERS_TYPE", name: "Suppliers Type", icon: "Tags", prefix: "suppliers.type" },
      { code: "CLEARANCE_AGENT", name: "Clearance Agent", icon: "UserCheck", prefix: "clearance.agent" },
      { id: "32483c51-caeb-4eda-a9d8-a0891e9c624b", code: "TRANSPORTERS", name: "Transporters", icon: "Container", prefix: "transporters" },
      { id: "3db24ea1-8c54-4947-b607-d88ccffa5c36", code: "VEHICLES", name: "Vehicles", icon: "Truck", prefix: "vehicles" },
      { id: "f33369c4-bf68-4eee-9a96-0094540c41f8", code: "DRIVERS", name: "Drivers", icon: "IdCard", prefix: "drivers" },
      { id: "9e7fcf78-a2ac-47f5-bc33-9a1f515662df", code: "DEPORTS", name: "Deports", icon: "Warehouse", prefix: "deports" },
    ] },
    { id: "9308490d-4f55-4e3f-8eaf-f06b5b7e2597", code: "SUPPLY_CHAIN_IMPORT_TRANSIT_DEPOT_AND_WAREHOUSE", name: "Import, Transit, Depot and Warehouse", icon: "Route", children: [
      { id: "8d2e1f75-6254-4a17-ad5f-9bf77a98a6ab", code: "ORDERS", name: "Orders", icon: "ClipboardList", prefix: "orders" },
      { id: "65fe5578-09c2-44ad-a3d8-3463aea9d092", code: "ORDERS_PLAN", name: "Orders Plan", icon: "CalendarRange", prefix: "orders.plan" },
      { id: "8d6d5d2b-e55e-47f0-910e-18d1943b5c9c", code: "CARGO", name: "Cargo", icon: "Ship", prefix: "cargo" },
      { code: "CARGO_INVOICE", name: "Cargo Invoice", icon: "FileSpreadsheet", prefix: "cargo.invoice" },
      { id: "3ad3846a-d0e3-4a8f-a2e8-1f3a191de41e", code: "STOCK", name: "Stock", icon: "Layers", prefix: "stock" },
      { id: "1413952f-3403-4679-aeae-7b725760d755", code: "NOMINATIONS", name: "Nominations", icon: "FileSignature", prefix: "nominations" },
      { id: "50528f20-becc-4071-9e60-8f08ed7c215b", code: "PFI", name: "PFI", icon: "ReceiptText", prefix: "pfi" },
      { id: "cb4686eb-ecc7-4109-95d0-00122a02d12a", code: "T1_VALIDATION", name: "T1 Validation", icon: "BadgeCheck", prefix: "t1.validation" },
      { id: "ebeb5c15-2f47-4f81-8d5c-f89f4339259b", code: "CENTRAL_STOCK", name: "Central Stock", icon: "PackageOpen", prefix: "central.stock" },
      { id: "76b0d611-e1d4-4d1f-a09e-de2b7ebda1b0", code: "STOCK_MANAGEMENT", name: "Stock Management", icon: "PackageSearch", children: [
        { code: "PSS_STOCK", name: "PSS Stock", icon: "PackagePlus", children: [
          { code: "LOADING_ORDERS", name: "Loading Orders", icon: "Forklift", prefix: "loading.orders" },
          { code: "CUVE_STOCK", name: "Cuve Stock", icon: "Fuel", prefix: "cuve.stock" },
          { code: "SALES", name: "Sales", icon: "ReceiptText", children: [
            { code: "FUEL_SALES", name: "Fuel Sales", icon: "Droplets", prefix: "fuel.sales" },
            { code: "FUEL_SALES_REPORT", name: "Fuel Sales Report", icon: "ChartColumn", prefix: "fuel.sales.report" },
          ] },
        ] },
      ] },
    ] },
    { code: "SUPPLY_CHAIN_REPORT", name: "Supply Chain Report", icon: "ChartColumn", children: [
      { code: "ORDER_REPORT", name: "Order Report", icon: "ChartColumn", prefix: "order.report" },
      { code: "CENTRAL_STOCK_REPORT", name: "Central Stock Report", icon: "ChartLine", prefix: "central.stock.report" },
    ] },
  ] },
  { id: "1bda9386-4d3a-4069-abf8-b1c6aadffda2", code: "PSS_OPERATION_FORECOURT", name: "PSS Operation Forecourt", icon: "Fuel", children: [
    { id: "c8003089-02f2-4dc7-aad3-ae7a95437ceb", code: "PSS_OPERATION_FORECOURT_SERVICE_BAY_SHOP_CAR_WASH", name: "Forecourt, Service Bay, Shop and Car Wash", icon: "Store", children: [
      { id: "6f2c7fd8-81d3-46dc-82e0-915d4b133bbb", code: "PSS", name: "PSS", icon: "MapPin", prefix: "pss" },
      { id: "597f165e-7f65-4c26-a9f6-447202187556", code: "PUMP", name: "Pump", icon: "Gauge", prefix: "pump" },
      { id: "f3656dae-73a7-468c-a45c-5339f976c250", code: "DISPLAY", name: "Display", icon: "MonitorSmartphone", prefix: "display" },
      { id: "2c6e4e6f-b4e3-4644-a8e6-e613e7253c1b", code: "NOZZLE", name: "Nozzle", icon: "Droplets", prefix: "nozzle" },
      { id: "e144bc35-8fb4-443f-8beb-52cefffb21c4", code: "CUVE", name: "Cuve", icon: "Container", prefix: "cuve" },
      { code: "MOBILE_DEVICES", name: "Mobile Devices", icon: "Smartphone", prefix: "mobile.devices" },
      { code: "SHIFTS", name: "Shifts", icon: "CalendarClock", prefix: "shifts" },
    ] },
    { id: "5ad8d068-de07-42f9-bbf9-73142395eead", code: "PSS_STOCK_MANAGEMENT", name: "PSS Stock Management", icon: "ClipboardCheck", children: [
      { id: "24488b2b-ff26-4bac-ae0e-9d39e246bc02", code: "STOCKOUT_ORDERS", name: "Stockout Orders", icon: "ShoppingCart", prefix: "stockout.orders" },
      { code: "STOCK_CLEARANCE", name: "Stock Clearance", icon: "FileCheck", prefix: "stock.clearance" },
      { code: "AUTHORIZERS", name: "Authorizers", icon: "Stamp", prefix: "authorizers" },
    ] },
  ] },
];

export interface FlatModule {
  id: string;
  code: string;
  name: string;
  icon: string;
  parentCode: string | null;
  sorting: number;
  permissions: Array<{ code: string; name: string; description: string }>;
}

/** A stable UUID for a seeded row, so reseeding finds the same row again. */
export function seedId(key: string) {
  const h = createHash("sha256").update(`petrox-seed:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function permissionName(code: string) {
  const parts = code.split(".");
  const action = parts.pop() ?? "manage";
  const subject = parts.join(" ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const verb = action === "read" ? "View" : `${action[0]?.toUpperCase() ?? ""}${action.slice(1)}`;
  return `${verb} ${subject}`;
}

/** The tree in insertion order — every parent before its children — with sorting by position. */
export function flattenModules(nodes: ModuleNode[] = MODULE_TREE, parentCode: string | null = null): FlatModule[] {
  return nodes.flatMap((node, index) => [
    {
      id: node.id ?? seedId(`module:${node.code}`),
      code: node.code,
      name: node.name,
      icon: node.icon,
      parentCode,
      sorting: index,
      permissions: node.prefix
        ? PERMISSION_ACTIONS.map((action) => {
          const code = `${node.prefix}.${action}`;
          return { code, name: permissionName(code), description: `${permissionName(code)} permission` };
        })
        : [],
    },
    ...flattenModules(node.children ?? [], node.code),
  ]);
}

export function validateModuleTree(modules: FlatModule[] = flattenModules()) {
  const seen = { id: new Set<string>(), code: new Set<string>(), permission: new Set<string>() };
  for (const module of modules) {
    if (seen.id.has(module.id)) throw new Error(`Duplicate module id: ${module.id}`);
    if (seen.code.has(module.code)) throw new Error(`Duplicate module code: ${module.code}`);
    seen.id.add(module.id);
    seen.code.add(module.code);
    for (const permission of module.permissions) {
      if (seen.permission.has(permission.code)) throw new Error(`Duplicate permission code: ${permission.code}`);
      seen.permission.add(permission.code);
    }
  }
  return modules;
}

/**
 * What each role holds beyond nothing. System Administrator always holds every
 * permission; the others get these, added to whatever was granted on the
 * Roles page (nothing is ever taken away).
 */
export const ROLE_GRANTS: Record<string, string[]> = {
  // Runs a station: its equipment, devices, shifts, sales and stock, and reads
  // what selling needs. The API keeps a site manager to their own site.
  "PSS MANAGER": [
    "pss.read", "pump.read", "pump.create", "pump.edit", "display.read", "display.create", "display.edit",
    "nozzle.read", "nozzle.create", "nozzle.edit", "cuve.read", "cuve.create", "cuve.edit", "cuve.stock.read",
    "mobile.devices.read", "mobile.devices.create", "mobile.devices.edit",
    "shifts.read", "shifts.create", "shifts.edit", "shifts.delete",
    "fuel.sales.read", "fuel.sales.create", "fuel.sales.report.read",
    "stockout.orders.read", "stockout.orders.create",
    "items.read", "item.price.read", "item.units.read", "units.read", "company.account.read",
    "clients.read", "client.cars.read", "cards.read", "cards.copy.read", "card.types.read", "users.read",
  ],
  // A client's administrator: its own users, wallet, cards, cars and discounts.
  Client: [
    "clients.read", "clients.create", "clients.edit", "client.wallets.read", "client.wallets.edit",
    "cards.read", "cards.copy.read", "discounts.read", "client.cars.read", "client.cars.create", "client.cars.edit",
  ],
  // A client's plain user only looks.
  "Client user": ["client.wallets.read", "cards.read", "cards.copy.read", "discounts.read", "client.cars.read"],
};

const ADMIN_ROLE = "System Administrator";

const TIMELINE_STATUSES: Array<{ status: TimeLineStatus; level: number; descriptions: string }> = [
  { status: "awaiting", level: 1, descriptions: "Awaiting loading documents" },
  { status: "underLoading", level: 2, descriptions: "Loading in progress" },
  { status: "t1Pending", level: 3, descriptions: "Release in progress" },
  { status: "t1Confirmed", level: 4, descriptions:
    "Released, In transit from foreign depot to owner, In transit from border to local depot, Parked at local depot" },
  { status: "stockReceived", level: 5, descriptions: "Stock received" },
];

/* ------------------------------------------------------------------------ */
/* Reference data                                                            */
/* ------------------------------------------------------------------------ */

type Db = PrismaClient;

async function seedModules(db: Db) {
  const modules = validateModuleTree();
  const idByCode = new Map<string, string>();
  for (const module of modules) {
    const parentId = module.parentCode ? idByCode.get(module.parentCode)! : null;
    const data = { name: module.name, icon: module.icon, sorting: module.sorting, parentId };
    // By code: a module created earlier on the Modules page keeps its id.
    const row = await db.module.upsert({
      where: { code: module.code },
      update: data,
      create: { id: module.id, code: module.code, ...data },
      select: { id: true },
    });
    idByCode.set(module.code, row.id);
    for (const permission of module.permissions) {
      await db.permission.upsert({
        where: { code: permission.code },
        update: { name: permission.name, description: permission.description, moduleId: row.id },
        create: { ...permission, moduleId: row.id },
      });
    }
  }
  return modules;
}

async function grant(db: Db, roleName: string, codes: string[] | "all", isFixed = false) {
  const role = await db.role.upsert({
    where: { name: roleName },
    update: { isActive: true, ...(isFixed ? { isFixed } : {}) },
    create: { name: roleName, isFixed },
  });
  const permissions = await db.permission.findMany({
    where: codes === "all" ? {} : { code: { in: codes } }, select: { id: true, code: true },
  });
  if (codes !== "all") {
    const missing = codes.filter((code) => !permissions.some((row) => row.code === code));
    if (missing.length) throw new Error(`${roleName}: unknown permission codes ${missing.join(", ")}`);
  }
  await db.rolePermission.createMany({
    data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
    skipDuplicates: true,
  });
  return role;
}

interface Secrets { adminEmail: string; adminPassword: string; adminPin: string; demoPassword: string; demoPin: string }

function secrets(production: boolean): Secrets {
  const env = process.env;
  const read = (name: string, fallback: string) => {
    const value = env[name];
    if (value) return value;
    if (production) throw new Error(`${name} must be set to seed a production database`);
    return fallback;
  };
  return {
    adminEmail: (env.SEED_ADMIN_EMAIL ?? "admin@petrox.local").toLowerCase(),
    adminPassword: read("SEED_ADMIN_PASSWORD", "ChangeMe123!"),
    adminPin: read("SEED_ADMIN_PIN", "1234"),
    demoPassword: env.SEED_DEMO_PASSWORD ?? "",
    demoPin: env.SEED_DEMO_PIN ?? "",
  };
}

/** Creates a user once; reseeding keeps their password and PIN, and only refreshes who they are. */
async function seedUser(db: Db, pinSecret: string, user: {
  email: string; password: string; pin?: string; firstName: string; lastName: string; phone?: string;
  roleId: string | null; position: Prisma.UserCreateInput["position"]; siteId?: string; clientId?: string;
}) {
  const profile = {
    firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? null, roleId: user.roleId,
    position: user.position, isActive: true, siteId: user.siteId ?? null, clientId: user.clientId ?? null,
  };
  const row = await db.user.upsert({
    where: { email: user.email },
    update: profile,
    create: {
      email: user.email, ...profile,
      passwordHash: await bcrypt.hash(user.password, 12),
      pinHash: user.pin ? hashPin(user.pin, pinSecret) : null,
    },
  });
  if (user.siteId) {
    await db.userSites.upsert({
      where: { userId_siteId: { userId: row.id, siteId: user.siteId } },
      update: { status: "active" },
      create: { userId: row.id, siteId: user.siteId },
    });
  }
  return row;
}

async function seedReference(db: Db, pinSecret: string, keys: Secrets) {
  for (const status of TIMELINE_STATUSES) {
    await db.nominationTimeLineStatus.upsert({
      where: { status: status.status },
      update: { level: status.level, descriptions: status.descriptions },
      create: status,
    });
  }
  const modules = await seedModules(db);
  const admin = await grant(db, ADMIN_ROLE, "all", true);
  const roles: Record<string, string> = { [ADMIN_ROLE]: admin.id };
  for (const [name, codes] of Object.entries(ROLE_GRANTS)) roles[name] = (await grant(db, name, codes)).id;

  const administrator = await seedUser(db, pinSecret, {
    email: keys.adminEmail, password: keys.adminPassword, pin: keys.adminPin,
    firstName: "System", lastName: "Administrator", roleId: admin.id, position: "superAdmin",
  });
  const permissionCount = modules.reduce((sum, module) => sum + module.permissions.length, 0);
  console.log(`✔ reference: ${modules.length} modules, ${permissionCount} permissions, ` +
    `${Object.keys(roles).length} roles, ${TIMELINE_STATUSES.length} timeline statuses, administrator ${keys.adminEmail}`);
  return { roles, administrator };
}

/* ------------------------------------------------------------------------ */
/* Test dataset                                                              */
/* ------------------------------------------------------------------------ */

const ID = (key: string) => seedId(`demo:${key}`);
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

async function seedDemo(db: Db, pinSecret: string, keys: Secrets, roles: Record<string, string>, adminId: string) {
  const password = keys.demoPassword || "ChangeMe123!";
  const staffPin = keys.demoPin || "1234";

  /* Products: a Fuel group with its products, sold by the litre. */
  const litre = await db.unit.upsert({ where: { id: ID("unit:litre") }, update: {}, create: { id: ID("unit:litre"), name: "Litre", code: "L" } });
  const fuel = await db.item.upsert({ where: { id: ID("item:fuel") }, update: {}, create: { id: ID("item:fuel"), name: "Fuel", descriptions: "Fuel products" } });
  const products = [
    { key: "pms", name: "PMS", descriptions: "Premium motor spirit (petrol)", price: 3000 },
    { key: "ago", name: "AGO", descriptions: "Automotive gas oil (diesel)", price: 2980 },
  ];
  const item: Record<string, string> = {};
  for (const product of products) {
    const row = await db.item.upsert({
      where: { id: ID(`item:${product.key}`) },
      update: { parentId: fuel.id, baseUnitId: litre.id },
      create: { id: ID(`item:${product.key}`), name: product.name, descriptions: product.descriptions, parentId: fuel.id, baseUnitId: litre.id },
    });
    item[product.key] = row.id;
    const unit = await db.itemUnit.upsert({
      where: { unitId_itemId: { unitId: litre.id, itemId: row.id } },
      update: { status: "active" },
      create: { unitId: litre.id, itemId: row.id, factorialValue: 1 },
    });
    // A price is only added when none is in force, so a price set on the admin panel stays.
    if (!(await db.itemPrice.findFirst({ where: { itemUnitId: unit.id, status: "active" } }))) {
      await db.itemPrice.create({ data: { id: ID(`price:${product.key}`), itemUnitId: unit.id, price: product.price, createdBy: adminId } });
    }
  }

  /* The station and its forecourt. */
  const site = await db.tblSite.upsert({
    where: { id: ID("site:nyabugogo") },
    update: { status: "active" },
    create: { id: ID("site:nyabugogo"), name: "NYABUGOGO", phone: "0788000000", email: "nyabugogo@petrox.local", address: "Nyabugogo, Kigali" },
  });
  const tanks = [
    { key: "tank1", name: "TANK1", product: "ago", balance: 8000 },
    { key: "tank2", name: "TANK2", product: "pms", balance: 12000 },
  ];
  const tank: Record<string, string> = {};
  for (const t of tanks) {
    // Stock is only set when the tank is created; reseeding never resets a balance.
    const row = await db.tblCuve.upsert({
      where: { id: ID(`cuve:${t.key}`) },
      update: {},
      create: { id: ID(`cuve:${t.key}`), name: t.name, siteId: site.id, itemId: item[t.product], minimum: 1000, maximum: 30000, deadStock: 300, balance: t.balance },
    });
    tank[t.product] = row.id;
  }
  let nozzleNo = 0;
  for (const p of [1, 2]) {
    const pump = await db.tblPump.upsert({ where: { id: ID(`pump:${p}`) }, update: {}, create: { id: ID(`pump:${p}`), name: `PUMP${p}`, siteId: site.id } });
    for (const d of [1, 2]) {
      const display = await db.tblDisplay.upsert({
        where: { id: ID(`display:${p}:${d}`) }, update: {},
        create: { id: ID(`display:${p}:${d}`), name: `Display${d}`, code: `P${p}-D${d}`, pumpId: pump.id },
      });
      // Each display has a petrol and a diesel nozzle.
      for (const product of ["pms", "ago"]) {
        nozzleNo += 1;
        await db.tblNozzle.upsert({
          where: { nozzleCode: `NZ-${String(nozzleNo).padStart(4, "0")}` },
          update: {},
          create: { id: ID(`nozzle:${nozzleNo}`), name: `Nozzle${nozzleNo}`, nozzleCode: `NZ-${String(nozzleNo).padStart(4, "0")}`,
            pumpId: pump.id, displayId: display.id, cuveId: tank[product] },
        });
      }
    }
  }

  /* Shifts, all running at the station. */
  for (const s of [
    { key: "morning", name: "Morning", startAt: "06:00", endAt: "14:00" },
    { key: "afternoon", name: "Afternoon", startAt: "14:00", endAt: "22:00" },
    { key: "night", name: "Night", startAt: "22:00", endAt: "06:00" },
  ]) {
    const shift = await db.tblShift.upsert({
      where: { id: ID(`shift:${s.key}`) }, update: {},
      create: { id: ID(`shift:${s.key}`), name: s.name, startAt: time(s.startAt), endAt: time(s.endAt), status: true },
    });
    await db.tblShiftSite.upsert({ where: { id: ID(`shift-site:${s.key}`) }, update: {}, create: { id: ID(`shift-site:${s.key}`), shiftId: shift.id, siteId: site.id } });
  }

  /* Where money goes: cash and mobile money at the station, two banks for every site. */
  for (const account of [
    { code: "CASH-NYA", name: "Cash NYABUGOGO", type: "cash" as const, siteId: site.id, requiredReference: false },
    { code: "MOMO-NYA", name: "MTN MoMo NYABUGOGO", type: "mobileMoney" as const, siteId: site.id, requiredReference: true },
    { code: "Bk0000123", name: "BK ACCOUNT", type: "bank" as const, siteId: null, requiredReference: true },
    { code: "EQ0000123", name: "EQUITY ACCOUNT", type: "bank" as const, siteId: null, requiredReference: true },
  ]) {
    await db.companyAccount.upsert({ where: { code: account.code }, update: {}, create: { ...account, createdAtBy: adminId } });
  }

  /* Card types and the rules their cards follow. */
  const cardType: Record<string, string> = {};
  for (const t of [
    { key: "prepaid", name: "prePaid", description: "Spends a balance loaded in advance",
      setting: { requirePin: true, requirePlateNumber: true, capturePlatePicture: true, showBalance: true } },
    { key: "postpaid", name: "postPaid", description: "Fuels on credit, settled monthly up to a limit",
      setting: { requirePin: true, requirePlateNumber: true, allowCredit: true, hasLimit: true, limitAmount: 2_000_000, limitPeriod: "monthly" as const, captureDisplay: true, showBalance: false } },
  ]) {
    const row = await db.cardType.upsert({ where: { name: t.name }, update: {}, create: { name: t.name, description: t.description, createdBy: adminId } });
    await db.cardSetting.upsert({ where: { cardTypeId: row.id }, update: {}, create: { cardTypeId: row.id, ...t.setting } });
    cardType[t.key] = row.id;
  }

  /* Clients, their cards and their cars. */
  const clients = {
    itec: await db.client.upsert({ where: { clientCode: "CLIENT001" }, update: {}, create: { clientCode: "CLIENT001", name: "ITEC", phone: "0787855303", email: "info@itec.petrox.local", idTino: "100000001" } }),
    uwimana: await db.client.upsert({ where: { clientCode: "CLI-0001" }, update: {}, create: { clientCode: "CLI-0001", name: "uwimana christian", phone: "0781111111", email: "uwimana@petrox.local" } }),
  };
  const cardPin = hashCardPin(DEFAULT_CARD_PIN, pinSecret);
  const cards: Record<number, bigint> = {};
  for (let n = 1; n <= 8; n += 1) {
    const number = `5040 0000 0000 ${String(n).padStart(4, "0")}`;
    const row = await db.card.upsert({
      where: { cardNumber: number }, update: {},
      create: { cardNumber: number, serialNumber: `SN-PX-${String(n).padStart(4, "0")}`, cardCode: `PX${String(n).padStart(4, "0")}`, securityCategory: 1, state: 0, inventoryStatus: 1 },
    });
    cards[n] = row.id;
  }
  // Card 1 is ITEC's prepaid main card and card 2 its copy; card 3 is ITEC's
  // postpaid card; card 4 is uwimana's prepaid card. Cards 5–8 stay free to assign.
  const holdings = [
    { key: "itec-main", client: clients.itec.id, main: 1, copy: null, type: "prepaid", balance: 500_000, lastIndex: 1 },
    { key: "itec-copy", client: clients.itec.id, main: 1, copy: 2, type: "prepaid", balance: 0, lastIndex: 2 },
    { key: "itec-post", client: clients.itec.id, main: 3, copy: null, type: "postpaid", balance: 0, lastIndex: 1 },
    { key: "uwimana-main", client: clients.uwimana.id, main: 4, copy: null, type: "prepaid", balance: 150_000, lastIndex: 1 },
  ];
  const assignment: Record<string, bigint> = {};
  for (const h of holdings) {
    const mainId = cards[h.main], copyId = h.copy ? cards[h.copy] : null;
    let row = await db.cardCopy.findFirst({ where: { clientId: h.client, cardId: mainId, cardCopyId: copyId } });
    if (!row) {
      row = await db.cardCopy.create({ data: { clientId: h.client, cardId: mainId, cardCopyId: copyId, pin: cardPin, lastIndex: h.lastIndex } });
      // Taken out of stock, as assigning a card on the admin panel does; a copy follows its main card's type.
      await db.card.update({ where: { id: copyId ?? mainId }, data: { availability: false, inventoryStatus: 3, cardTypeId: cardType[h.type], ...(copyId ? {} : { balance: h.balance }) } });
    }
    assignment[h.key] = row.id;
  }
  const cars = [
    { key: "raa553v", client: clients.itec.id, plateNo: "RAA553V", product: "pms", tank: 60, on: ["itec-main"] },
    { key: "raf202g", client: clients.itec.id, plateNo: "RAF202G", product: "pms", tank: 70, on: ["itec-main", "itec-copy"] },
    { key: "raa731d", client: clients.itec.id, plateNo: "RAA731D", product: "pms", tank: 55, on: ["itec-copy"] },
    { key: "rac100a", client: clients.itec.id, plateNo: "RAC100A", product: "ago", tank: 200, trackNo: "TRK-01", on: ["itec-post"] },
    { key: "rad200b", client: clients.uwimana.id, plateNo: "RAD200B", product: "pms", tank: 50, on: ["uwimana-main"] },
  ];
  for (const car of cars) {
    const row = await db.clientCar.upsert({
      where: { id: ID(`car:${car.key}`) }, update: {},
      create: { id: ID(`car:${car.key}`), clientId: car.client, plateNo: car.plateNo, trackNo: car.trackNo ?? null, itemId: item[car.product], tancapacity: car.tank },
    });
    for (const holding of car.on) {
      await db.clientCarCardAssignment.upsert({
        where: { id: ID(`car-card:${car.key}:${holding}`) }, update: {},
        create: { id: ID(`car-card:${car.key}:${holding}`), clientCarId: row.id, cardCopyId: assignment[holding] },
      });
    }
  }

  /* Staff. */
  const staff = [
    { email: "manager@petrox.local", firstName: "Site", lastName: "Manager", phone: "0780000001", pin: staffPin,
      roleId: roles["PSS MANAGER"], position: "siteManager" as const, siteId: site.id },
    // Signs POS sales with phone + PIN; holds no admin-panel role.
    { email: "attendant@petrox.local", firstName: "Pump", lastName: "Attendant", phone: "0780000002", pin: staffPin,
      roleId: null, position: "others" as const, siteId: site.id },
    { email: "itec.admin@petrox.local", firstName: "ITEC", lastName: "Administrator", phone: "0780000003",
      roleId: roles.Client, position: "clientAdmin" as const, clientId: clients.itec.id },
  ];
  for (const person of staff) await seedUser(db, pinSecret, { ...person, password });

  console.log(`✔ test dataset: site ${site.name} — 2 products, 2 tanks, 2 pumps, 4 displays, ${nozzleNo} nozzles, 3 shifts, ` +
    `4 accounts, 2 card types, 8 cards (4 assigned), 2 clients, ${cars.length} cars, ${staff.length} users`);
  console.log(`  logins (password ${keys.demoPassword ? "from SEED_DEMO_PASSWORD" : "ChangeMe123!"}): ` +
    `${staff.map((person) => person.email).join(", ")}`);
  console.log(`  POS attendant: phone 0780000002, PIN ${keys.demoPin ? "from SEED_DEMO_PIN" : "1234"}; card PIN ${DEFAULT_CARD_PIN}`);
}

/* ------------------------------------------------------------------------ */

async function main() {
  const config = loadConfig();
  const production = config.NODE_ENV === "production";
  const demo = process.argv.includes("--demo") || process.env.SEED_DEMO === "true";
  const keys = secrets(production);
  if (production && demo && (!keys.demoPassword || !keys.demoPin)) {
    throw new Error("SEED_DEMO_PASSWORD and SEED_DEMO_PIN must be set to seed test data on a production database");
  }
  const db = new PrismaClient();
  try {
    const { roles, administrator } = await seedReference(db, config.PIN_HMAC_SECRET, keys);
    if (demo) await seedDemo(db, config.PIN_HMAC_SECRET, keys, roles, administrator.id);
  } finally {
    await db.$disconnect();
  }
}

// Run when executed (pnpm prisma:seed), not when imported by the tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
