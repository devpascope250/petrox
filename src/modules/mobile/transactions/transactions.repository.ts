import { Prisma, type GeneralTransactionStatus, type PrismaClient } from "../../../../prisma/generated/prisma/client.js";
import { AppError, BusinessError, NotFoundError } from "../../../utils/errors.js";
import { staticUrl } from "../../../utils/static-url.js";
import { discountColumns, presentDiscount, priceWithDiscount } from "../../discounts/discount-rules.js";
import { accountOfType, attendantBy, checkAmount, checkPayments, drawFromTank, loadSaleNozzle, money, priceInForce, pumpAssignment } from "./sale-rules.js";
import type { ConfirmTransactionInput, InitiateTransactionInput } from "./transactions.schema.js";

const CODE_PREFIX = "PSST";

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

/**
 * Charges a card sale to the main card the card spends from, and records it
 * in the card ledger like the web's wallet transfers do (PAYMENT, OUT, on the
 * assignment used at the pump). The balance must cover it, checked and taken
 * in one statement; a card type that allows credit may go below zero.
 */
async function chargeCard(tx: Tx, mainCardId: bigint, cardCopyId: bigint, amount: Prisma.Decimal, allowCredit: boolean, createdById: string) {
  const charged = await tx.card.updateMany({
    where: { id: mainCardId, ...(allowCredit ? {} : { balance: { gte: amount } }) },
    data: { balance: { decrement: amount } },
  });
  if (charged.count === 0) {
    const { balance } = await tx.card.findUniqueOrThrow({ where: { id: mainCardId }, select: { balance: true } });
    throw new BusinessError("INSUFFICIENT_CARD_BALANCE",
      `The main card has ${balance.toFixed(2)} left; this sale is ${amount.toFixed(2)}`,
      422, { balance: balance.toFixed(2), amount: amount.toFixed(2) });
  }
  await tx.cardCopyTransaction.create({
    data: { carfdCopyId: cardCopyId, type: "PAYMENT", direction: "OUT", amount, createdById },
  });
}

/** How a card is named on a payment: its number, or its serial number. */
function cardLabel(cardCopy: {
  card: { cardNumber: string | null; serialNumber: string | null };
  copyCard: { cardNumber: string | null; serialNumber: string | null } | null;
}) {
  const card = cardCopy.copyCard ?? cardCopy.card;
  return card.cardNumber ?? card.serialNumber ?? "—";
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
  quantity: true, unitPrice: true, amount: true, discountId: true, discountRate: true, discountAmount: true,
  subsidyRate: true, subsidyAmount: true,
  reason: true, comments: true, printStatus: true, appVersion: true, deviceId: true,
  createdAt: true, confirmedAt: true, updatedAt: true, expiresAt: true,
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
  /** The attendant who confirmed it (`doneBy`); not their phone, which signs them in. */
  user: { select: { id: true, firstName: true, lastName: true } },
  /** The coupons that paid it (a coupon sale), and what each has left now. */
  couponRedemptions: {
    select: { id: true, amount: true, clientCoupon: { select: { code: true, amount: true, remainingAmount: true, usage: true } } },
    orderBy: { createdAt: "asc" },
  },
  generalTransactionPayments: {
    select: { id: true, amount: true, reference: true, referenceDocUrl: true,
      account: { select: { id: true, code: true, name: true, type: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.GeneralTransactionSelect;

type TransactionRow = Prisma.GeneralTransactionGetPayload<{ select: typeof transactionSelect }>;

function presentRow({  generalTransactionPayments, couponRedemptions, user, ...row }: TransactionRow) {
  return {
    ...row,
    cardCopyId: row.cardCopyId?.toString() ?? null,
    /** Who the sale was for: the card holder's name; `null` for a sale without a card. */
    clientName: row.client?.name ?? null,
    /** The physical card used: the copy card for a copy, the main card otherwise. */
    // card: cardCopy ? (cardCopy.copyCard ?? cardCopy.card) : null,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
    /** What is collected: already net of any discount. */
    amount: Number(row.amount),
    discountRate: Number(row.discountRate),
    discountAmount: Number(row.discountAmount),
    /** What the pump display showed, before the discount. */
    grossAmount: Number(row.amount.plus(row.discountAmount)),
    subsidyRate: Number(row.subsidyRate),
    subsidyAmount: Number(row.subsidyAmount),
    // shift: shift ? { id: shift.id, name: shift.shift.name } : null,
    /** The attendant who confirmed it; `null` until the sale is confirmed. */
    attendant: user ? { ...user, names: `${user.firstName} ${user.lastName}`.trim() } : null,
    /** The same name, ready to print, as `clientName` is. */
    attendantName: user ? `${user.firstName} ${user.lastName}`.trim() : null,
    payments: generalTransactionPayments.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
    /** A coupon sale's coupons: what each paid, and what is left on it. Empty for other sales. */
    coupons: couponRedemptions.map(({ id, amount, clientCoupon }) => ({
      id, code: clientCoupon.code, amount: Number(amount),
      faceValue: Number(clientCoupon.amount), remainingAmount: Number(clientCoupon.remainingAmount), usage: clientCoupon.usage,
    })),
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
      // Only an initiated sale can lapse; a coupon sale (no expiry) never does.
      expiresAt: row.status === "initiated" ? row.expiresAt : null,
    };
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
        // A sale with no expiry (paid with coupons) is never picked: null is not before now.
        status: "initiated", expiresAt: { lt: new Date() },
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
    const nozzle = await loadSaleNozzle(this.db, input, siteId);

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
    const price = { price: await priceInForce(this.db, nozzle.cuve.item) };

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
            expiresAt: new Date(startedAt + this.timeoutMs),
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
   * What an open sale comes to at a given volume: the price fixed when it
   * started, the gross the pump display will show, the discount in force for
   * that volume (and for the sale's client, when it has one), and what is
   * left to collect.
   *
   * The POS asks for this before confirming, so the attendant collects — and
   * sends as `payments` — the discounted amount. `confirm` works the same
   * figures out again for itself, so this answer is never trusted.
   */
  async quote(code: string, siteId: string, quantity: number) {
    await this.expire({ transactionCode: code });
    const sale = await this.db.generalTransaction.findFirst({
      where: { transactionCode: code, siteId },
      select: { transactionCode: true, status: true, unitPrice: true, clientId: true,
        client: { select: { id: true, clientCode: true, name: true } } },
    });
    if (!sale) throw new NotFoundError("Transaction");
    if (sale.status !== "initiated") {
      throw new AppError(409, "TRANSACTION_NOT_OPEN", `Only a sale still initiated can be quoted; this one is ${sale.status}`);
    }
    const priced = await priceWithDiscount(this.db, {
      siteId, clientId: sale.clientId, quantity: money(quantity), unitPrice: sale.unitPrice,
    });
    return {
      transactionCode: sale.transactionCode,
      client: sale.client,
      quantity: Number(money(quantity)),
      unitPrice: Number(sale.unitPrice),
      ...presentDiscount(priced),
    };
  }

  /**
   * The attendant signing with phone and PIN: the active user with that phone
   * number (phones are unique), working at the site — on its staff list or
   * based there — whose PIN matches.
   */
  attendant(phone: string, pin: string, siteId: string) {
    return attendantBy(this.db, phone, pin, siteId, this.pinSecret);
  }

  /**
   * The site shift an attendant is working that nozzle in right now, from the
   * pump rota (`TblPumpAttendant`): their row for this pump, on today's
   * weekday, in a site shift that is switched on and whose hours include the
   * time now in Rwanda, with the nozzle among theirs. A shift that runs past
   * midnight belongs to the weekday it started on, so in its small hours
   * yesterday's rota applies.
   */
  private pumpAssignment(db: Tx | PrismaClient, userId: string, siteId: string,
    nozzle: { id: string; name: string; pump: { id: string; name: string } }, now = new Date()) {
    return pumpAssignment(db, userId, siteId, nozzle, now);
  }

  /**
   * Closes an initiated sale in one transaction: the litres come out of the
   * tank (never below zero) with a ledger row, the payments are recorded, a
   * card sale is charged to its main card (never below zero unless the card
   * type allows credit) with a card ledger row, a fuel sale is recorded as
   * if entered on the web, and the sale is marked
   * confirmed by the attendant, who must be on the rota for its pump and
   * nozzle in the shift running now; the sale is recorded under that shift. Only one confirm can win: the row is claimed
   * first, so a repeated or concurrent confirm finds it already taken.
   */
  async confirm(code: string, siteId: string, input: ConfirmTransactionInput & { displayPictureUrl?: string; referenceDocs: Record<number, string> }, doneBy: string) {
    // An overdue sale is cancelled now rather than at the next sweep, so it cannot be confirmed late.
    await this.expire({ transactionCode: code });
    return this.db.$transaction(async (tx) => {
      const sale = await tx.generalTransaction.findFirst({
        where: { transactionCode: code, siteId },
        select: { id: true, status: true, unitPrice: true, cuveId: true, cardCopyId: true, expiresAt: true,
          clientId: true,
          cuve: { select: { name: true } },
          nozzle: { select: { id: true, name: true, pump: { select: { id: true, name: true } } } },
          cardCopy: { select: { cardId: true,
            card: { select: { cardNumber: true, serialNumber: true, cardType: { select: { setting: settingSelect } } } },
            copyCard: { select: { cardNumber: true, serialNumber: true } } } } },
      });
      if (!sale) throw new NotFoundError("Transaction");
      // A sale paid with coupons has its own confirm; it is the one with no expiry.
      if (sale.status === "initiated" && sale.expiresAt === null) {
        throw new AppError(409, "COUPON_SALE", "This sale is paid with coupons: confirm it through coupon sales");
      }
      const claimed = await tx.generalTransaction.updateMany({
        where: { id: sale.id, status: "initiated", expiresAt: { gte: new Date() } },
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

      const { siteShiftId: rotaShiftId, workingDay } = await this.pumpAssignment(tx, doneBy, siteId, sale.nozzle);

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
      // `amount` is what the pump display shows, before any discount.
      checkAmount(quantity, unitPrice, amount);
      // What a discount in force takes off this volume, for this client at
      // this site. Worked out here and not at `initiate`, because until the
      // fuel is in the car nobody knows how many litres it was.
      const priced = await priceWithDiscount(tx, { siteId, clientId: sale.clientId, quantity, unitPrice });
      /** What is actually collected: the pump's amount less the discount. */
      const due = priced.amount;
      const payments = input.payments ?? [];
      // A card sale is paid by the card, in full, and by nothing else: taking
      // payments as well would charge the client twice.
      if (sale.cardCopyId && payments.length > 0) {
        throw new BusinessError("PAYMENTS_NOT_FOR_CARD", "This sale is paid with the client's card: send no payments");
      }
      if (!sale.cardCopyId && payments.length === 0) {
        throw new BusinessError("PAYMENTS_REQUIRED", "A sale without a card needs its payments");
      }
      if (payments.length > 0) {
        const paid = await checkPayments(tx, payments, siteId);
        if (!paid.equals(due)) {
          throw new BusinessError("PAYMENTS_DO_NOT_MATCH",
            priced.discountAmount.isZero()
              ? `The payments add up to ${paid.toString()}, but the sale is ${due.toString()}`
              : `The payments add up to ${paid.toString()}, but the sale is ${priced.grossAmount.toString()}`
                + ` less ${priced.discountAmount.toString()} discount — ${due.toString()} to collect`,
            422, { ...presentDiscount(priced), paidAmount: Number(paid) });
        }
      }
      // What the card pays is recorded like any other payment, so the sale is
      // never short on the receipt or in a by-account total.
      const cardPayment = sale.cardCopy
        ? [{
            accountId: (await accountOfType(tx, siteId, "card")).id,
            // The card the client handed over: the copy when there is one, else the main card.
            amount: due, reference: `Card ${cardLabel(sale.cardCopy)}`, referenceDocUrl: null,
          }]
        : [];

      await drawFromTank(tx, { id: sale.cuveId, name: sale.cuve.name }, quantity);
      // Also recorded as a fuel sale, as if entered on the web, so the Fuel
      // sales pages and report include it. One tank movement serves both
      // records, so the litres are never counted twice.
      const fuelSale = await tx.fuelSale.create({
        data: {
          siteId, pumpId: sale.nozzle.pump.id, nozzleId: sale.nozzle.id, shiftId: input.shiftId ?? rotaShiftId,
          quantity, unitPrice: sale.unitPrice, amount: due, ...discountColumns(priced),
          note: `POS sale ${code}`, createdBy: doneBy,
          dateOn: new Date(`${workingDay}T00:00:00.000Z`),
          payments: { create: cardPayment.length ? cardPayment : payments.map((payment, index) => ({
            accountId: payment.accountId, amount: money(payment.amount),
            reference: payment.reference ?? null, referenceDocUrl: input.referenceDocs[index] ?? null,
          })) },
        },
        select: { id: true },
      });
      await tx.cuveTransaction.create({
        data: { cuveId: sale.cuveId, quantity, type: "sold", direction: "OUT", createdBy: doneBy,
          generalTransactionId: sale.id, saleId: fuelSale.id },
      });
      await tx.generalTransactionPayment.createMany({
        data: cardPayment.length
          ? cardPayment.map((payment) => ({ transactionId: sale.id, ...payment }))
          : payments.map((payment, index) => ({
            transactionId: sale.id, accountId: payment.accountId, amount: money(payment.amount),
            reference: payment.reference ?? null, referenceDocUrl: input.referenceDocs[index] ?? null,
          })),
      });
      if (sale.cardCopy && sale.cardCopyId) {
        await chargeCard(tx, sale.cardCopy.cardId, sale.cardCopyId, due, Boolean(setting?.allowCredit), doneBy);
        await releaseCard(tx, sale.cardCopy.cardId);
      }
      const row = await tx.generalTransaction.update({
        where: { id: sale.id },
        data: {
          // The attendant's shift on the rota, unless the POS names one.
          quantity, amount: due, ...discountColumns(priced),
          shiftId: input.shiftId ?? rotaShiftId, displayPictureUrl: input.displayPictureUrl ?? null,
          comments: input.comments ?? null, ...(input.appVersion ? { appVersion: input.appVersion } : {}),
          ...(input.printStatus !== undefined ? { printStatus: input.printStatus } : {}),
        },
        select: transactionSelect,
      });
      return this.present(row);
    });
  }

  /**
   * Records whether the receipt of a sale was printed. Only a confirmed sale
   * has a receipt; setting it again to the same value is harmless, so a POS
   * can retry after a lost answer.
   */
  async setPrintStatus(code: string, siteId: string, printStatus: boolean) {
    const sale = await this.db.generalTransaction.findFirst({ where: { transactionCode: code, siteId }, select: { id: true, status: true } });
    if (!sale) throw new NotFoundError("Transaction");
    if (sale.status !== "confirmed") {
      throw new AppError(409, "TRANSACTION_NOT_CONFIRMED", `Only a confirmed sale has a receipt; this one is ${sale.status}`);
    }
    await this.db.generalTransaction.update({ where: { id: sale.id }, data: { printStatus } });
    return this.find(code, siteId);
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
