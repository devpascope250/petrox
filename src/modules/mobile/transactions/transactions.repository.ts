import { Prisma, type GeneralTransactionStatus, type PrismaClient } from "../../../../prisma/generated/prisma/client.js";
import { AppError, BusinessError, NotFoundError } from "../../../utils/errors.js";
import { verifyPin } from "../../../utils/crypto.js";
import { staticUrl } from "../../../utils/static-url.js";
import { dayOfWeek, fromTime } from "../../shifts/shift-scope.js";
import type { ConfirmTransactionInput, InitiateTransactionInput } from "./transactions.schema.js";

const money = (value: number | Prisma.Decimal) => new Prisma.Decimal(value).toDecimalPlaces(2);
const CODE_PREFIX = "PSST";
/** Rwanda keeps UTC+2 all year; shift hours are local times. */
const BUSINESS_OFFSET_MS = 2 * 60 * 60_000;

/** A plate compared by its letters and digits only, so `RAD 123 A`, `rad123a` and `RAD-123-A` are one car. */
const plateKey = (plate: string) => plate.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** `Card.state`: a card is free, or busy with a sale that is still open. */
const CARD_FREE = 0;
const CARD_BUSY = 1;

type Tx = Prisma.TransactionClient;

/**
 * Marks a main card busy for a sale that is starting. Only a free card can
 * be taken, and the check and the change are one statement, so two POS
 * starting a sale on the same card at once cannot both get it. A copy spends
 * from its main card, so it is the main card that is held: while one copy is
 * at a pump, no other copy of it can start a sale.
 */
async function holdCard(tx: Tx, cardId: bigint) {
  const held = await tx.card.updateMany({ where: { id: cardId, state: CARD_FREE }, data: { state: CARD_BUSY } });
  if (held.count === 1) return;

  const card = await tx.card.findUniqueOrThrow({ where: { id: cardId }, select: { state: true, cardNumber: true } });
  if (card.state !== CARD_BUSY) {
    throw new BusinessError("CARD_NOT_AVAILABLE", "This card cannot be used for a sale right now");
  }
  // The open sale holding it says where the card is.
  const open = await tx.generalTransaction.findFirst({
    where: { status: "initiated", cardCopy: { cardId } },
    orderBy: { createdAt: "desc" },
    select: { transactionCode: true, createdAt: true, site: { select: { id: true, name: true } } },
  });
  throw new AppError(409, "CARD_BUSY",
    open ? `This card is in use at ${open.site.name}` : "This card is marked as in use",
    { site: open?.site ?? null, transactionCode: open?.transactionCode ?? null, since: open?.createdAt ?? null });
}

/** Frees a main card once its sale is confirmed or cancelled. */
async function releaseCard(tx: Tx, cardId: bigint) {
  await tx.card.updateMany({ where: { id: cardId, state: CARD_BUSY }, data: { state: CARD_FREE } });
}

/**
 * `PSST` + the moment the sale started, by the server's clock:
 * `PSST20261008-092056-536` is 8 Oct 2026 at 09:20:56 and 536 ms.
 */
export function transactionCode(at: Date) {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${CODE_PREFIX}${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
    + `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}-${pad(at.getMilliseconds(), 3)}`;
}

const settingSelect = {
  select: { requirePin: true, requirePlateNumber: true, capturePlatePicture: true, captureDisplay: true,
    requireOdometer: true, allowCredit: true, hasLimit: true, limitAmount: true, limitPeriod: true, showBalance: true },
} as const;

/** A sale as the POS reads it back. */
const transactionSelect = {
  id: true, transactionCode: true, status: true, siteId: true,
  platNumber: true, platePictureUrl: true, displayPictureUrl: true,
  quantity: true, unitPrice: true, amount: true, discountAmount: true, subsidyRate: true, subsidyAmount: true,
  reason: true, comments: true, printStatus: true, appVersion: true, deviceId: true,
  createdAt: true, confirmedAt: true, updatedAt: true,
  item: { select: { id: true, name: true } },
  // cuve: { select: { id: true, name: true } },
  // pump: { select: { id: true, name: true } },
  nozzle: { select: { id: true, name: true, nozzleCode: true, display: { select: { id: true, name: true, code: true } } } },
  // site: { select: { id: true, name: true } },
  /** The POS that recorded it. */
  // device: { select: { id: true, deviceName: true } },
  cardCopyId: true,
  cardCopy: { select: {
     card: { select: { cardNumber: true, serialNumber: true , cardType: { select: { name: true, status: true}}} }, copyCard: { select: { cardNumber: true, serialNumber: true } } } },
  client: { select: { id: true, clientCode: true, name: true, phone: true } },
  // shift: { select: { id: true, shift: { select: { id: true, name: true } } } },
  // user: { select: { id: true, firstName: true, lastName: true, phone: true } },
  generalTransactionPayments: {
    select: { id: true, amount: true, reference: true, referenceDocUrl: true,
      account: { select: { id: true, code: true, name: true, type: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.GeneralTransactionSelect;

type TransactionRow = Prisma.GeneralTransactionGetPayload<{ select: typeof transactionSelect }>;

function presentRow({  generalTransactionPayments, ...row }: TransactionRow) {
  return {
    ...row,
    cardCopyId: row.cardCopyId?.toString() ?? null,
    /** Who the sale was for: the card holder's name; `null` for a sale without a card. */
    clientName: row.client?.name ?? null,
    /** The physical card used: the copy card for a copy, the main card otherwise. */
    // card: cardCopy ? (cardCopy.copyCard ?? cardCopy.card) : null,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
    amount: Number(row.amount),
    discountAmount: Number(row.discountAmount),
    subsidyRate: Number(row.subsidyRate),
    subsidyAmount: Number(row.subsidyAmount),
    // shift: shift ? { id: shift.id, name: shift.shift.name } : null,
    /** The attendant who confirmed it. */
    // doneBy: user,
    payments: generalTransactionPayments.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
  };
}

export type PresentedTransaction = ReturnType<typeof presentRow> & { expiresAt: Date | null };

/** How many sales a list returns. */
export const LIST_LIMIT = 50;

/** Recorded as the `reason` of a sale cancelled because nobody confirmed it in time. */
const EXPIRED_REASON = "Not confirmed in time";

export class MobileTransactionsRepository {
  private timeoutMs: number;

  /** `timeoutMinutes`: how long a sale may stay initiated before it is cancelled. */
  /** `staticBase` is `STATIC_URL`: picture and document paths are returned as full URLs under it. */
  constructor(private db: PrismaClient, private pinSecret: string, timeoutMinutes = 10, private staticBase?: string) {
    this.timeoutMs = timeoutMinutes * 60_000;
  }

  /** A sale as returned, with `expiresAt`: when an initiated sale will be cancelled if not confirmed. */
  private present(row: TransactionRow): PresentedTransaction {
    const sale = presentRow(row);
    const url = (path: string | null) => staticUrl(this.staticBase, path);
    return {
      ...sale,
      platePictureUrl: url(sale.platePictureUrl),
      displayPictureUrl: url(sale.displayPictureUrl),
      payments: sale.payments.map((payment) => ({ ...payment, referenceDocUrl: url(payment.referenceDocUrl) })),
      expiresAt: row.status === "initiated" ? new Date(row.createdAt.getTime() + this.timeoutMs) : null,
    };
  }

  private cutoff() {
    return new Date(Date.now() - this.timeoutMs);
  }

  /**
   * Cancels sales still initiated past the timeout, and frees their cards.
   * Run every minute in the background, and also just before a sale or card
   * is used, so an overdue sale never blocks anything while it waits for
   * the next sweep. Narrowed to one sale or one main card when given.
   * Returns how many were cancelled.
   */
  async expire(only: { transactionCode?: string; cardId?: bigint } = {}) {
    const stale = await this.db.generalTransaction.findMany({
      where: {
        status: "initiated", createdAt: { lt: this.cutoff() },
        ...(only.transactionCode ? { transactionCode: only.transactionCode } : {}),
        ...(only.cardId !== undefined ? { cardCopy: { cardId: only.cardId } } : {}),
      },
      select: { id: true, cardCopy: { select: { cardId: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    let cancelled = 0;
    for (const sale of stale) {
      await this.db.$transaction(async (tx) => {
        // Conditional, so a sale confirmed in the meantime is left alone.
        const done = await tx.generalTransaction.updateMany({
          where: { id: sale.id, status: "initiated" },
          data: { status: "cancelled", reason: EXPIRED_REASON },
        });
        if (done.count === 1 && sale.cardCopy) await releaseCard(tx, sale.cardCopy.cardId);
        cancelled += done.count;
      });
    }
    return cancelled;
  }

  /** The site's newest sales in one status, newest first — at most `LIST_LIMIT`. */
  async list(siteId: string, status: GeneralTransactionStatus) {
    // Overdue sales are cancelled first, so "initiated" only lists sales that can still be confirmed.
    await this.expire();
    const rows = await this.db.generalTransaction.findMany({
      where: { siteId, status },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIST_LIMIT,
      select: transactionSelect,
    });
    return rows.map((row) => this.present(row));
  }

  async find(code: string, siteId: string) {
    await this.expire({ transactionCode: code });
    const row = await this.db.generalTransaction.findFirst({ where: { transactionCode: code, siteId }, select: transactionSelect });
    if (!row) throw new NotFoundError("Transaction");
    return this.present(row);
  }

  /**
   * Opens a sale. Everything sent is checked against the device's site: the
   * nozzle must be on that pump and draw from that tank, which must hold that
   * product, all active. For a card sale the card must be assigned and its
   * client active, and the card type's plate rules are applied. The price is
   * the product's price in force, fixed now for the rest of the sale. A copy
   * spends from its main card, so the main card must have a balance, unless
   * its type allows credit.
   */
  async initiate(input: InitiateTransactionInput & { platePictureUrl?: string }, siteId: string, deviceId: string) {
    const nozzle = await this.db.tblNozzle.findFirst({
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

    let clientId: string | null = null;
    let mainCardId: bigint | null = null;
    if (input.cardCopyId) {
      const assignment = await this.db.cardCopy.findFirst({
        where: { id: input.cardCopyId, status: true },
        select: { clientId: true, cardId: true, client: { select: { status: true, name: true } },
          // A copy follows its main card's type, and spends from its balance.
          card: { select: { cardNumber: true, balance: true, cardType: { select: { setting: settingSelect } } } },
          // The cars this card is on now: active assignment, active car.
          clientCarCardAssignments: {
            where: { status: "active", clientCar: { status: "active" } },
            select: { clientCar: { select: { plateNo: true, item: { select: { id: true, name: true } } } } },
          } },
      });
      if (!assignment) throw new NotFoundError("Card");
      if (!assignment.client.status) throw new BusinessError("CLIENT_INACTIVE", `${assignment.client.name ?? "This client"} is not active`);
      const setting = assignment.card.cardType?.setting;
      if (!setting?.allowCredit && assignment.card.balance.lessThanOrEqualTo(0)) {
        throw new BusinessError("INSUFFICIENT_CARD_BALANCE", "The main card of this card has no balance",
          422, { cardNumber: assignment.card.cardNumber, balance: assignment.card.balance.toFixed(2) });
      }
      const checksPlate = Boolean(setting?.requirePlateNumber || setting?.capturePlatePicture);
      // A plate picture is only worth taking for a plate that can be checked, so either rule needs the number.
      if (checksPlate && !input.platNumber) {
        throw new BusinessError("PLATE_NUMBER_REQUIRED", "This card needs the vehicle's plate number");
      }
      if (setting?.capturePlatePicture && !input.platePictureUrl) {
        throw new BusinessError("PLATE_PICTURE_REQUIRED", "This card needs a picture of the plate (platePicture)");
      }
      // The vehicle at the pump must be one of the cars the card is assigned to.
      if (checksPlate) {
        const plate = plateKey(input.platNumber!);
        const car = assignment.clientCarCardAssignments.find(({ clientCar }) => plateKey(clientCar.plateNo) === plate)?.clientCar;
        if (!car) {
          throw new BusinessError("CAR_NOT_ASSIGNED_TO_CARD", `The car ${input.platNumber} is not assigned to this card`);
        }
        // And it can only be filled with the product it runs on.
        if (car.item.id !== input.itemId) {
          throw new BusinessError("CAR_ITEM_MISMATCH",
            `The car ${car.plateNo} uses ${car.item.name}, not ${nozzle.cuve.item.name}`,
            422, { car: { plateNo: car.plateNo, item: car.item } });
        }
      }
      clientId = assignment.clientId;
      mainCardId = assignment.cardId;
    }

    // The price in force for the product, in the unit its tank is measured in.
    const price = await this.db.itemPrice.findFirst({
      where: { status: "active", itemUnit: { status: "active", itemId: nozzle.cuve.item.id,
        ...(nozzle.cuve.item.baseUnitId ? { unitId: nozzle.cuve.item.baseUnitId } : {}) } },
      orderBy: { createdAt: "desc" },
      select: { price: true },
    });
    if (!price) throw new BusinessError("PRICE_NOT_SET", `${nozzle.cuve.item.name} has no price in force`);

    // Two sales opened in the same millisecond would share a code; the
    // unique index catches it and the next millisecond is tried.
    // A card held by an overdue sale is let go first.
    if (mainCardId !== null) await this.expire({ cardId: mainCardId });
    const startedAt = Date.now();
    for (let attempt = 0; ; attempt += 1) {
      try {
        // The card is held and the sale written together: if either fails, neither happens.
        const row = await this.db.$transaction(async (tx) => {
          if (mainCardId !== null) await holdCard(tx, mainCardId);
          return tx.generalTransaction.create({
          data: {
            transactionCode: transactionCode(new Date(startedAt + attempt)),
            itemId: input.itemId, cuveId: input.cuveId, pumpId: input.pumpId, nozzleId: input.nozzleId,
            cardCopyId: input.cardCopyId ?? null, clientId,
            platNumber: input.platNumber ?? null, platePictureUrl: input.platePictureUrl ?? null,
            siteId, deviceId, unitPrice: price.price, appVersion: input.appVersion ?? null,
          },
          select: transactionSelect,
          });
        });
        return this.present(row);
      } catch (error) {
        const clash = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
        if (!clash || attempt >= 20) throw error;
      }
    }
  }

  /**
   * The attendant signing with phone and PIN: the active user with that phone
   * number (phones are unique), working at the site — on its staff list or
   * based there — whose PIN matches.
   */
  async attendant(phone: string, pin: string, siteId: string) {
    const user = await this.db.user.findFirst({
      where: { phone, isActive: true, pinHash: { not: null },
        OR: [{ siteId }, { sites: { some: { siteId, status: "active" } } }] },
      select: { id: true, pinHash: true },
    });
    // One answer for an unknown phone and a wrong PIN, so neither can be probed.
    if (!user || !verifyPin(pin, user.pinHash!, this.pinSecret)) {
      throw new AppError(422, "INVALID_ATTENDANT", "Wrong phone number or PIN");
    }
    return user.id;
  }

  /**
   * The site shift an attendant is working that nozzle in right now, from the
   * pump rota (`TblPumpAttendant`): their row for this pump, on today's
   * weekday, in a site shift that is switched on and whose hours include the
   * time now in Rwanda, with the nozzle among theirs. A shift that runs past
   * midnight belongs to the weekday it started on, so in its small hours
   * yesterday's rota applies.
   */
  private async pumpAssignment(db: Tx | PrismaClient, userId: string, siteId: string,
    nozzle: { id: string; name: string; pump: { id: string; name: string } }, now = new Date()) {
    const local = new Date(now.getTime() + BUSINESS_OFFSET_MS);
    const clock = local.toISOString().slice(11, 16);
    const today = dayOfWeek(local);
    const yesterday = today === 1 ? 7 : today - 1;
    const rows = await db.tblPumpAttendant.findMany({
      where: { userId, siteId, pumpId: nozzle.pump.id, day: { in: [today, yesterday] }, siteShift: { status: 1 } },
      select: { day: true, siteShiftId: true,
        siteShift: { select: { shift: { select: { name: true, startAt: true, endAt: true } } } },
        pumpAttendantNozzles: { select: { nozzleId: true } } },
    });
    const working = rows.filter(({ day, siteShift: { shift } }) => {
      const start = fromTime(shift.startAt);
      const end = fromTime(shift.endAt);
      if (start < end) return day === today && clock >= start && clock < end;
      // Overnight: the evening part on its own day, the small hours on the next.
      return (day === today && clock >= start) || (day === yesterday && clock < end);
    });
    if (working.length === 0) {
      throw new BusinessError("ATTENDANT_NOT_ON_PUMP",
        `You are not on the rota for ${nozzle.pump.name} in the shift running now (${clock})`);
    }
    const onNozzle = working.find((row) => row.pumpAttendantNozzles.some(({ nozzleId }) => nozzleId === nozzle.id));
    if (!onNozzle) {
      throw new BusinessError("ATTENDANT_NOT_ON_NOZZLE", `${nozzle.name} is not one of your nozzles on ${nozzle.pump.name} in this shift`);
    }
    return onNozzle.siteShiftId;
  }

  /**
   * Closes an initiated sale in one transaction: the litres come out of the
   * tank (never below zero) with a ledger row, the payments are recorded,
   * and the sale is marked confirmed by the attendant, who must be on the
   * rota for its pump and nozzle in the shift running now; the sale is
   * recorded under that shift. Only one confirm can win: the row is claimed
   * first, so a repeated or concurrent confirm finds it already taken.
   */
  async confirm(code: string, siteId: string, input: ConfirmTransactionInput & { displayPictureUrl?: string; referenceDocs: Record<number, string> }, doneBy: string) {
    // An overdue sale is cancelled now rather than at the next sweep, so it cannot be confirmed late.
    await this.expire({ transactionCode: code });
    const cutoff = this.cutoff();
    return this.db.$transaction(async (tx) => {
      const sale = await tx.generalTransaction.findFirst({
        where: { transactionCode: code, siteId },
        select: { id: true, status: true, unitPrice: true, cuveId: true, cardCopyId: true,
          cuve: { select: { name: true } },
          nozzle: { select: { id: true, name: true, pump: { select: { id: true, name: true } } } },
          cardCopy: { select: { cardId: true, card: { select: { cardType: { select: { setting: settingSelect } } } } } } },
      });
      if (!sale) throw new NotFoundError("Transaction");
      const claimed = await tx.generalTransaction.updateMany({
        where: { id: sale.id, status: "initiated", createdAt: { gte: cutoff } },
        data: { status: "confirmed", confirmedAt: new Date(), doneBy },
      });
      if (claimed.count === 0) {
        const { status, reason } = await tx.generalTransaction.findUniqueOrThrow({ where: { id: sale.id }, select: { status: true, reason: true } });
        // Still initiated means it ran out of time in the moment since the check above.
        if (status === "initiated" || (status === "cancelled" && reason === EXPIRED_REASON)) {
          throw new AppError(409, "TRANSACTION_EXPIRED", "This sale was not confirmed in time and has been cancelled; start a new one");
        }
        throw new AppError(409, status === "cancelled" ? "TRANSACTION_CANCELLED" : "TRANSACTION_ALREADY_CONFIRMED",
          `This sale is already ${status}`);
      }

      const rotaShiftId = await this.pumpAssignment(tx, doneBy, siteId, sale.nozzle);

      const setting = sale.cardCopy?.card.cardType?.setting;
      if (setting?.captureDisplay && !input.displayPictureUrl) {
        throw new BusinessError("DISPLAY_PICTURE_REQUIRED", "This card needs a picture of the pump display (displayPicture)");
      }

      if (input.shiftId) {
        const shift = await tx.tblShiftSite.findFirst({ where: { id: input.shiftId, siteId }, select: { status: true } });
        if (!shift) throw new BusinessError("SHIFT_NOT_AT_SITE", "That shift does not run at this site");
        if (shift.status !== 1) throw new BusinessError("SHIFT_SWITCHED_OFF", "That shift is switched off at this site");
      }

      const quantity = money(input.quantity);
      const unitPrice = money(input.unitPrice);
      const amount = money(input.amount);
      // The price was fixed when the sale started; the POS must charge that one.
      if (!unitPrice.equals(sale.unitPrice)) {
        throw new BusinessError("UNIT_PRICE_MISMATCH",
          `The price of this sale is ${sale.unitPrice.toString()}, not ${unitPrice.toString()}`,
          422, { unitPrice: sale.unitPrice.toFixed(2) });
      }
      // The pump rounds what it shows, so the amount may be off quantity × price
      // by up to what 0.01 of a unit costs — never more.
      const expected = money(quantity.times(unitPrice));
      if (amount.minus(expected).abs().greaterThan(unitPrice.times("0.01"))) {
        throw new BusinessError("AMOUNT_MISMATCH",
          `${quantity.toString()} × ${unitPrice.toString()} is ${expected.toString()}, not ${amount.toString()}`,
          422, { expectedAmount: expected.toFixed(2) });
      }
      const payments = input.payments ?? [];
      // A card sale is charged to the card; any other sale must say how it was paid.
      if (!sale.cardCopyId && payments.length === 0) {
        throw new BusinessError("PAYMENTS_REQUIRED", "A sale without a card needs its payments");
      }
      if (payments.length > 0) {
        const accountIds = payments.map((payment) => payment.accountId);
        if (new Set(accountIds).size !== accountIds.length) {
          throw new BusinessError("DUPLICATE_PAYMENT_ACCOUNT", "Each account can only be used once per sale");
        }
        const accounts = await tx.companyAccount.findMany({ where: { id: { in: accountIds } } });
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
        if (!paid.equals(amount)) {
          throw new BusinessError("PAYMENTS_DO_NOT_MATCH", `The payments add up to ${paid.toString()}, but the sale is ${amount.toString()}`);
        }
      }

      // Decrement only if there is enough, so two sales at once cannot overdraw the tank.
      const drawn = await tx.tblCuve.updateMany({
        where: { id: sale.cuveId, balance: { gte: quantity } },
        data: { balance: { decrement: quantity } },
      });
      if (drawn.count === 0) {
        const current = await tx.tblCuve.findUniqueOrThrow({ where: { id: sale.cuveId }, select: { balance: true } });
        throw new BusinessError("INSUFFICIENT_CUVE_STOCK", `${sale.cuve.name} only holds ${current.balance.toString()}; cannot sell ${quantity.toString()}`);
      }
      await tx.cuveTransaction.create({
        data: { cuveId: sale.cuveId, quantity, type: "sold", direction: "OUT", createdBy: doneBy, generalTransactionId: sale.id },
      });
      if (payments.length > 0) {
        await tx.generalTransactionPayment.createMany({
          data: payments.map((payment, index) => ({
            transactionId: sale.id, accountId: payment.accountId, amount: money(payment.amount),
            reference: payment.reference ?? null, referenceDocUrl: input.referenceDocs[index] ?? null,
          })),
        });
      }
      if (sale.cardCopy) await releaseCard(tx, sale.cardCopy.cardId);
      const row = await tx.generalTransaction.update({
        where: { id: sale.id },
        data: {
          // The attendant's shift on the rota, unless the POS names one.
          quantity, amount, shiftId: input.shiftId ?? rotaShiftId, displayPictureUrl: input.displayPictureUrl ?? null,
          comments: input.comments ?? null, ...(input.appVersion ? { appVersion: input.appVersion } : {}),
          ...(input.printStatus !== undefined ? { printStatus: input.printStatus } : {}),
        },
        select: transactionSelect,
      });
      return this.present(row);
    });
  }

  /** Drops a sale that was started but never served, and frees its card. Confirmed sales stay. */
  async cancel(code: string, siteId: string, reason: string) {
    await this.db.$transaction(async (tx) => {
      const sale = await tx.generalTransaction.findFirst({
        where: { transactionCode: code, siteId }, select: { id: true, cardCopy: { select: { cardId: true } } },
      });
      if (!sale) throw new NotFoundError("Transaction");
      const cancelled = await tx.generalTransaction.updateMany({
        where: { id: sale.id, status: "initiated" },
        data: { status: "cancelled", reason },
      });
      if (cancelled.count === 0) throw new AppError(409, "TRANSACTION_NOT_OPEN", "Only a sale still initiated can be cancelled");
      if (sale.cardCopy) await releaseCard(tx, sale.cardCopy.cardId);
    });
    return this.find(code, siteId);
  }
}
