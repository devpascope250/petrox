import { Prisma, type PrismaClient } from "../../../../prisma/generated/prisma/client.js";
import { AppError, BusinessError, NotFoundError } from "../../../utils/errors.js";
import { verifyPin } from "../../../utils/crypto.js";
import { fromDate, fromTime, toDate } from "../../shifts/shift-scope.js";

/**
 * The rules every sale at the pump follows, whatever pays for it: ordinary
 * POS sales (initiate/confirm) and fuel sales paid with coupons share them, so
 * both check the equipment, the price, the attendant and the tank the same way.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const money = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value).toDecimalPlaces(2);

/** Rwanda keeps UTC+2 all year; shift hours are local times. */
const BUSINESS_OFFSET_MS = 2 * 60 * 60_000;

/**
 * The nozzle a sale is made on, checked against the device's site: it must be
 * on that pump and draw from that tank, which must hold that product, all active.
 */
export async function loadSaleNozzle(db: Db, input: { itemId: string; cuveId: string; pumpId: string; nozzleId: string }, siteId: string) {
  const nozzle = await db.tblNozzle.findFirst({
    where: { id: input.nozzleId },
    select: {
      id: true, name: true, status: true,
      pump: { select: { id: true, name: true, siteId: true, status: true } },
      cuve: { select: { id: true, name: true, siteId: true, status: true,
        item: { select: { id: true, name: true, status: true, baseUnitId: true } } } },
    },
  });
  if (!nozzle || nozzle.pump.siteId !== siteId) throw new NotFoundError("Nozzle at this site");
  if (nozzle.pump.id !== input.pumpId) throw new BusinessError("NOZZLE_NOT_ON_PUMP", `${nozzle.name} is not on that pump`);
  if (nozzle.cuve.id !== input.cuveId) {
    throw new BusinessError("NOZZLE_CUVE_MISMATCH", `${nozzle.name} draws from ${nozzle.cuve.name}, not the tank sent`);
  }
  if (nozzle.cuve.item.id !== input.itemId) {
    throw new BusinessError("ITEM_CUVE_MISMATCH", `${nozzle.cuve.name} holds ${nozzle.cuve.item.name}, not the product sent`);
  }
  if (nozzle.pump.status !== "active") throw new BusinessError("PUMP_INACTIVE", `${nozzle.pump.name} is not active`);
  if (nozzle.status !== "active") throw new BusinessError("NOZZLE_INACTIVE", `${nozzle.name} is not active`);
  if (nozzle.cuve.status !== "active") throw new BusinessError("CUVE_INACTIVE", `${nozzle.cuve.name} is not active`);
  if (nozzle.cuve.item.status !== "active") throw new BusinessError("ITEM_INACTIVE", `${nozzle.cuve.item.name} is not active`);
  return nozzle;
}

/** The price in force for a product, in the unit its tank is measured in. */
export async function priceInForce(db: Db, item: { id: string; name: string; baseUnitId: string | null }) {
  const price = await db.itemPrice.findFirst({
    where: { status: "active", itemUnit: { status: "active", itemId: item.id, ...(item.baseUnitId ? { unitId: item.baseUnitId } : {}) } },
    orderBy: { createdAt: "desc" },
    select: { price: true },
  });
  if (!price) throw new BusinessError("PRICE_NOT_SET", `${item.name} has no price in force`);
  return price.price;
}

/**
 * The amount the pump shows, against quantity × price. The pump rounds what
 * it shows, so it may be off by up to what 0.01 of a unit costs — never more.
 */
export function checkAmount(quantity: Prisma.Decimal, unitPrice: Prisma.Decimal, amount: Prisma.Decimal) {
  const expected = money(quantity.times(unitPrice));
  if (amount.minus(expected).abs().greaterThan(unitPrice.times("0.01"))) {
    throw new BusinessError("AMOUNT_MISMATCH",
      `${quantity.toString()} × ${unitPrice.toString()} is ${expected.toString()}, not ${amount.toString()}`,
      422, { expectedAmount: expected.toFixed(2) });
  }
}

/**
 * The company account a sale paid with a client's card or coupons is recorded
 * against: this site's account of that type, or the company's. Such a sale is
 * not paid at the pump — the card or the paper is — but it still has to say
 * how it was paid, or it reads as unpaid on the receipt and in every
 * by-account total.
 */
export async function accountOfType(db: Db, siteId: string, type: "card" | "coupon") {
  const account = await db.companyAccount.findFirst({
    where: { type, status: "active", OR: [{ siteId }, { siteId: null }] },
    // This site's own account first, then the company-wide one.
    orderBy: [{ siteId: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
  if (!account) {
    throw new BusinessError(type === "card" ? "CARD_ACCOUNT_MISSING" : "COUPON_ACCOUNT_MISSING",
      `No active company account of type ${type}: add one on the web before selling against ${type === "card" ? "cards" : "coupons"}`);
  }
  return account;
}

/**
 * Checks payments into company accounts — each account once, active, at this
 * site or shared, with a reference when it needs one — and returns their total.
 */
export async function checkPayments(db: Db, payments: Array<{ accountId: string; amount: number; reference?: string }>, siteId: string) {
  const accountIds = payments.map((payment) => payment.accountId);
  if (new Set(accountIds).size !== accountIds.length) {
    throw new BusinessError("DUPLICATE_PAYMENT_ACCOUNT", "Each account can only be used once per sale");
  }
  const accounts = await db.companyAccount.findMany({ where: { id: { in: accountIds } } });
  let paid = new Prisma.Decimal(0);
  for (const payment of payments) {
    const account = accounts.find((row) => row.id === payment.accountId);
    if (!account) throw new NotFoundError("Company account");
    if (account.status !== "active") throw new BusinessError("ACCOUNT_INACTIVE", `${account.name} is not active`);
    if (account.siteId && account.siteId !== siteId) {
      throw new BusinessError("ACCOUNT_NOT_AT_SITE", `${account.name} belongs to another site`);
    }
    if (account.requiredReference && !payment.reference) {
      throw new BusinessError("PAYMENT_REFERENCE_REQUIRED", `${account.name} needs a reference number`);
    }
    paid = paid.plus(money(payment.amount));
  }
  return paid;
}

/**
 * The attendant signing with phone and PIN: the active user with that phone
 * number (phones are unique), working at the site — on its staff list or
 * based there — whose PIN matches. One answer for an unknown phone and a wrong
 * PIN, so neither can be probed.
 */
export async function attendantBy(db: Db, phone: string, pin: string, siteId: string, pinSecret: string) {
  const user = await db.user.findFirst({
    where: { phone, isActive: true, pinHash: { not: null },
      OR: [{ siteId }, { sites: { some: { siteId, status: "active" } } }] },
    select: { id: true, pinHash: true },
  });
  if (!user || !verifyPin(pin, user.pinHash!, pinSecret)) {
    throw new AppError(422, "INVALID_ATTENDANT", "Wrong phone number or PIN");
  }
  return user.id;
}

/** Takes litres out of a tank, only if it holds enough, so two sales at once cannot overdraw it. */
export async function drawFromTank(db: Db, cuve: { id: string; name: string }, quantity: Prisma.Decimal) {
  const drawn = await db.tblCuve.updateMany({
    where: { id: cuve.id, balance: { gte: quantity } },
    data: { balance: { decrement: quantity } },
  });
  if (drawn.count === 0) {
    const current = await db.tblCuve.findUniqueOrThrow({ where: { id: cuve.id }, select: { balance: true } });
    throw new BusinessError("INSUFFICIENT_CUVE_STOCK", `${cuve.name} only holds ${current.balance.toString()}; cannot sell ${quantity.toString()}`);
  }
}

/** `TblTimeTable.status`: 0 planned, 1 present, 2 absent. */
const ABSENT = 2;

/**
 * The site shift an attendant is working that nozzle in right now, in two steps.
 *
 * **When** comes from the time table (`TblTimeTable`), which is the roster: a
 * row putting this attendant on a site shift on this date, not marked absent,
 * in a shift that is switched on at the site and whose hours include the time
 * now in Rwanda. A shift that runs past midnight belongs to the date it
 * started on, so in its small hours yesterday's roster applies — and its own
 * date is the working day the sale counts towards.
 *
 * **Where** comes from the pump rota (`TblPumpAttendant`), which now says only
 * which pump and nozzles an attendant handles in a shift, not which days he
 * works: the roster decides that.
 */
export async function pumpAssignment(db: Db, userId: string, siteId: string,
  nozzle: { id: string; name: string; pump: { id: string; name: string } }, now = new Date()) {
  const local = new Date(now.getTime() + BUSINESS_OFFSET_MS);
  const clock = local.toISOString().slice(11, 16);
  const today = local.toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
  const rostered = await db.tblTimeTable.findMany({
    where: { userId, siteId, dateOn: { in: [toDate(today), toDate(yesterday)] }, status: { not: ABSENT }, shiftSite: { status: 1 } },
    select: { dateOn: true, siteShiftId: true,
      shiftSite: { select: { shift: { select: { name: true, startAt: true, endAt: true } } } } },
  });
  const working = rostered.filter(({ dateOn, shiftSite: { shift } }) => {
    const day = fromDate(dateOn);
    const start = fromTime(shift.startAt);
    const end = fromTime(shift.endAt);
    if (start < end) return day === today && clock >= start && clock < end;
    // Overnight: the evening part on its own date, the small hours on the next.
    return (day === today && clock >= start) || (day === yesterday && clock < end);
  });
  if (working.length === 0) {
    throw new BusinessError("ATTENDANT_NOT_ON_SHIFT",
      `You are not on the time table for the shift running now (${clock})`);
  }
  const assignments = await db.tblPumpAttendant.findMany({
    where: { userId, siteId, pumpId: nozzle.pump.id, siteShiftId: { in: working.map((row) => row.siteShiftId) } },
    select: { siteShiftId: true, pumpAttendantNozzles: { select: { nozzleId: true } } },
  });
  if (assignments.length === 0) {
    throw new BusinessError("ATTENDANT_NOT_ON_PUMP",
      `You are not on the rota for ${nozzle.pump.name} in the shift running now (${clock})`);
  }
  const onNozzle = assignments.find((row) => row.pumpAttendantNozzles.some(({ nozzleId }) => nozzleId === nozzle.id));
  if (!onNozzle) {
    throw new BusinessError("ATTENDANT_NOT_ON_NOZZLE", `${nozzle.name} is not one of your nozzles on ${nozzle.pump.name} in this shift`);
  }
  // The roster row's own date: a night shift's small hours still count towards the day it started.
  const workingDay = fromDate(working.find((row) => row.siteShiftId === onNozzle.siteShiftId)!.dateOn);
  return { siteShiftId: onNozzle.siteShiftId, workingDay };
}

/** `<prefix>` + the moment, by the server's clock: `PSST20261008-092056-536`. */
export function codeAt(prefix: string, at: Date) {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${prefix}${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
    + `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}-${pad(at.getMilliseconds(), 3)}`;
}
