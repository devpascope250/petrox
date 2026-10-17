import { Prisma, type PrismaClient } from "../../../../prisma/generated/prisma/client.js";
import { AppError, BusinessError, NotFoundError } from "../../../utils/errors.js";
import { verifyClientPin } from "../../clients/client-pin.js";
import { expireCoupons, redeemCoupons } from "../../client-coupons/coupon-rules.js";
import { MobileTransactionsRepository, transactionCode } from "../transactions/transactions.repository.js";
import { checkAmount, drawFromTank, loadSaleNozzle, money, priceInForce, pumpAssignment } from "../transactions/sale-rules.js";
import type { ConfirmCouponSaleInput, InitiateCouponSaleInput } from "./coupon-sale.schema.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Coupons that can still pay: not cancelled, not expired, value left. */
const spendable = (clientId: string): Prisma.ClientCouponWhereInput => ({
  clientId, status: { not: "cancelled" }, usage: { in: ["unused", "partiallyUsed"] }, remainingAmount: { gt: 0 },
});

/**
 * Fuel sales paid with a client's coupons. They are POS sales like any other
 * (`GeneralTransaction`, read, listed and printed through `/mobile/transactions`)
 * with a flow of their own: the client is found and checked with their PIN,
 * the sale is started with everything about the fuel and never lapses
 * (`expiresAt` empty), and confirming checks only the coupons and the
 * attendant before recording it all — or nothing.
 */
export class CouponSaleRepository {
  constructor(private db: PrismaClient, private pinSecret: string, private sales: MobileTransactionsRepository) {}

  /** What a client's coupons can still pay, and how many there are. */
  private async spendableOf(db: Db, clientId: string) {
    const sum = await db.clientCoupon.aggregate({ where: spendable(clientId), _sum: { remainingAmount: true }, _count: { _all: true } });
    return { amount: sum._sum.remainingAmount ?? new Prisma.Decimal(0), count: sum._count._all };
  }

  /** Clients holding coupons they can spend, most to spend first. */
  async clients(search?: string) {
    await expireCoupons(this.db);
    const groups = await this.db.clientCoupon.groupBy({
      by: ["clientId"],
      where: { status: { not: "cancelled" }, usage: { in: ["unused", "partiallyUsed"] }, remainingAmount: { gt: 0 } },
      _sum: { remainingAmount: true }, _count: { _all: true },
    });
    if (groups.length === 0) return [];
    const clients = await this.db.client.findMany({
      where: {
        id: { in: groups.map((group) => group.clientId) }, status: true,
        ...(search ? { OR: [{ name: { contains: search } }, { clientCode: { contains: search } }, { phone: { contains: search } }] } : {}),
      },
      select: { id: true, clientCode: true, name: true, phone: true, pinHash: true },
      take: 50,
    });
    return clients
      .map(({ pinHash, ...client }) => {
        const group = groups.find((row) => row.clientId === client.id)!;
        return {
          ...client,
          /** Without a PIN the client cannot pay with coupons: set one on the web. */
          hasPin: Boolean(pinHash),
          spendableAmount: Number(group._sum.remainingAmount ?? 0),
          couponCount: group._count._all,
        };
      })
      .sort((a, b) => b.spendableAmount - a.spendableAmount);
  }

  /**
   * Checks a client's PIN. One answer for a wrong PIN, no PIN set and an
   * inactive client, so none can be probed.
   */
  async verify(db: Db, clientId: string, pin: string) {
    const client = await db.client.findUnique({
      where: { id: clientId }, select: { id: true, clientCode: true, name: true, phone: true, status: true, pinHash: true },
    });
    if (!client) throw new NotFoundError("Client");
    if (!client.status || !client.pinHash || !verifyClientPin(pin, client.pinHash, this.pinSecret)) {
      throw new AppError(422, "INVALID_CLIENT_PIN", "Wrong client PIN, or the client cannot pay with coupons");
    }
    const { pinHash: _hash, status: _status, ...shown } = client;
    return shown;
  }

  /** The client, checked, with what their coupons can pay — but never their codes: only the paper can pay. */
  async verifyClient(clientId: string, pin: string) {
    await expireCoupons(this.db);
    const client = await this.verify(this.db, clientId, pin);
    const { amount, count } = await this.spendableOf(this.db, clientId);
    return { client, spendableAmount: Number(amount), couponCount: count };
  }

  /** The account a coupon sale is paid into: this site's coupon account, or the company's. */
  private async couponAccount(db: Db, siteId: string) {
    const account = await db.companyAccount.findFirst({
      where: { type: "coupon", status: "active", OR: [{ siteId }, { siteId: null }] },
      orderBy: [{ siteId: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { id: true, name: true },
    });
    if (!account) {
      throw new BusinessError("COUPON_ACCOUNT_MISSING", "No active coupon account: add a company account of type coupon on the web");
    }
    return account;
  }

  /**
   * Starts a coupon sale. The client must confirm with their PIN, and their
   * coupons must be able to pay the whole amount. Everything about the fuel
   * is checked and fixed now — the price in force, the amount as the pump
   * shows it — and the sale waits, without lapsing, for its confirmation.
   */
  async initiate(input: InitiateCouponSaleInput & { displayPictureUrl: string; platePictureUrl?: string }, siteId: string, deviceId: string) {
    await expireCoupons(this.db);
    const client = await this.verify(this.db, input.clientId, input.clientPin);
    const nozzle = await loadSaleNozzle(this.db, input, siteId);
    const unitPrice = await priceInForce(this.db, nozzle.cuve.item);
    // The POS charges the price it shows; it must be the one in force.
    if (!money(input.unitPrice).equals(unitPrice)) {
      throw new BusinessError("UNIT_PRICE_MISMATCH", `The price in force is ${unitPrice.toString()}, not ${money(input.unitPrice).toString()}`,
        422, { unitPrice: unitPrice.toFixed(2) });
    }
    const quantity = money(input.quantity);
    const amount = money(input.amount);
    checkAmount(quantity, unitPrice, amount);
    await this.couponAccount(this.db, siteId);
    const { amount: available } = await this.spendableOf(this.db, client.id);
    if (available.lessThan(amount)) {
      throw new BusinessError("COUPONS_SHORT", `${client.name ?? "The client"}'s coupons can pay ${available.toString()}; the sale is ${amount.toString()}`,
        422, { spendableAmount: available.toFixed(2), amount: amount.toFixed(2) });
    }

    const startedAt = Date.now();
    // Two sales started in the same millisecond would share a code; the next
    // millisecond is tried.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.db.generalTransaction.create({
          data: {
            transactionCode: transactionCode(new Date(startedAt + attempt)),
            itemId: input.itemId, cuveId: input.cuveId, pumpId: input.pumpId, nozzleId: input.nozzleId,
            clientId: client.id, siteId, deviceId, quantity, unitPrice, amount,
            platNumber: input.platNumber ?? null, displayPictureUrl: input.displayPictureUrl,
            platePictureUrl: input.platePictureUrl ?? null,
            appVersion: input.appVersion ?? null,
            // Never lapses: a coupon sale waits as long as its confirmation takes.
            expiresAt: null,
          },
        });
        return this.sales.find(transactionCode(new Date(startedAt + attempt)), siteId);
      } catch (error) {
        const clash = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
        if (!clash || attempt >= 20) throw error;
      }
    }
  }

  /** A coupon sale at this site that can still be confirmed or cancelled. */
  private async openSale(db: Db, code: string, siteId: string) {
    const sale = await db.generalTransaction.findFirst({
      where: { transactionCode: code, siteId },
      select: {
        id: true, status: true, expiresAt: true, clientId: true, quantity: true, unitPrice: true, amount: true,
        cuveId: true, cuve: { select: { name: true } },
        nozzle: { select: { id: true, name: true, pump: { select: { id: true, name: true } } } },
      },
    });
    if (!sale) throw new NotFoundError("Transaction");
    if (sale.expiresAt !== null) throw new AppError(409, "NOT_A_COUPON_SALE", "This sale is not paid with coupons");
    if (sale.status !== "initiated") {
      throw new AppError(409, sale.status === "cancelled" ? "TRANSACTION_CANCELLED" : "TRANSACTION_ALREADY_CONFIRMED", `This sale is already ${sale.status}`);
    }
    return sale;
  }

  /**
   * Confirms a coupon sale, all or nothing, in one database transaction: the
   * attendant must be on the rota for its nozzle now; every coupon must belong
   * to the sale's client and be spendable, and together they must pay the
   * whole amount (the last keeps what it does not need); the payment is
   * recorded against the coupon account; the litres leave the tank, with its
   * ledger row and a fuel sale for the web. Any failure leaves nothing behind.
   */
  async confirm(code: string, siteId: string, input: Omit<ConfirmCouponSaleInput, "phone" | "pin">, doneBy: string) {
    await this.db.$transaction(async (tx) => {
      const sale = await this.openSale(tx, code, siteId);
      if (sale.clientId !== input.clientId) {
        throw new BusinessError("CLIENT_MISMATCH", "This sale was started for another client");
      }
      // Claimed first, so a repeated or concurrent confirm finds it taken.
      const claimed = await tx.generalTransaction.updateMany({
        where: { id: sale.id, status: "initiated", expiresAt: null },
        data: { status: "confirmed", confirmedAt: new Date(), doneBy },
      });
      if (claimed.count === 0) throw new AppError(409, "TRANSACTION_ALREADY_CONFIRMED", "This sale was just confirmed or cancelled");

      const rota = await pumpAssignment(tx, doneBy, siteId, sale.nozzle);
      const { covered } = await redeemCoupons(tx, {
        scans: input.coupons, saleAmount: sale.amount, generalTransactionId: sale.id, siteId, redeemedBy: doneBy, clientId: input.clientId,
      });
      // Coupons pay the whole sale: nothing else is taken.
      if (!covered.equals(sale.amount)) {
        throw new BusinessError("COUPONS_SHORT", `The coupons scanned pay ${covered.toString()}; the sale is ${sale.amount.toString()}`,
          422, { couponAmount: covered.toFixed(2), amount: sale.amount.toFixed(2) });
      }
      const account = await this.couponAccount(tx, siteId);
      await tx.generalTransactionPayment.create({
        data: { transactionId: sale.id, accountId: account.id, amount: covered, reference: `${input.coupons.length} coupon(s)` },
      });

      await drawFromTank(tx, { id: sale.cuveId, name: sale.cuve.name }, sale.quantity);
      // A fuel sale too, as if entered on the web, for its pages, report and
      // dashboard. One tank movement serves both records.
      const fuelSale = await tx.fuelSale.create({
        data: {
          siteId, pumpId: sale.nozzle.pump.id, nozzleId: sale.nozzle.id, shiftId: rota.siteShiftId,
          quantity: sale.quantity, unitPrice: sale.unitPrice, amount: sale.amount, createdBy: doneBy,
          note: `Coupon sale ${code}`, dateOn: new Date(`${rota.workingDay}T00:00:00.000Z`),
          payments: { create: { accountId: account.id, amount: covered } },
        },
        select: { id: true },
      });
      await tx.cuveTransaction.create({
        data: { cuveId: sale.cuveId, quantity: sale.quantity, type: "sold", direction: "OUT", createdBy: doneBy,
          generalTransactionId: sale.id, saleId: fuelSale.id },
      });
      await tx.generalTransaction.update({
        where: { id: sale.id },
        data: {
          shiftId: rota.siteShiftId, comments: input.comments ?? null,
          ...(input.appVersion ? { appVersion: input.appVersion } : {}),
          ...(input.printStatus !== undefined ? { printStatus: input.printStatus } : {}),
        },
      });
    });
    return this.sales.find(code, siteId);
  }

  /** Cancels a coupon sale that was never confirmed; no coupon was spent, so nothing is given back. */
  async cancel(code: string, siteId: string, reason: string) {
    await this.db.$transaction(async (tx) => {
      const sale = await this.openSale(tx, code, siteId);
      const cancelled = await tx.generalTransaction.updateMany({
        where: { id: sale.id, status: "initiated" }, data: { status: "cancelled", reason },
      });
      if (cancelled.count === 0) throw new AppError(409, "TRANSACTION_NOT_OPEN", "This sale was just confirmed or cancelled");
    });
    return this.sales.find(code, siteId);
  }
}
