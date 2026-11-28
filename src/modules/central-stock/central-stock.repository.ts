import type { Prisma, PrismaClient, StockTransaction } from "../../../prisma/generated/prisma/client.js";
import { toleranceColumns, toleranceForReceipt } from "./tolerance-rules.js";
import { receiptWindow } from "./receipt-window.js";
import { calculatingRemainStock, settleStockStatus } from "./stock-status.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { presentFees, reportFeeSelect, sumFeeTotals } from "../fees/fee.repository.js";
import { releaseParkingForNomination } from "../vehicle-locations/vehicle-location.repository.js";
import { recordStage } from "../nominations/nomination-stage.js";
import {
  CentralStockReportQuerySchema,
  CreateCentralStockSchema,
  StockReconciliationsBodySchema,
  StockTransactionSchema,
} from "./central-stock.schema.js";

export class CentralStockRepository {
  constructor(private db: PrismaClient) {}

  async list(query: CentralStockReportQuerySchema) {
    const { startDate, endDate, itemId, status, receiptType } = query;
    const depotId = query.depotId ?? query.deportId;
    const centralStocks = await this.db.centralStock.findMany({
      orderBy: { createdAt: "desc" },
      where: {
        // The day the load was discharged, falling back to the day the
        // receipt was keyed in — see `receiptWindow`. The rows stay ordered by
        // `createdAt`, which is the one date every receipt has.
        ...receiptWindow(startDate, endDate),
        ...(depotId && { deportId: depotId }),
        ...(status && { status }),
        ...(receiptType && { receiptType }),
        ...(itemId && { itemId }),
      },
      select: {
        id: true, 
        ambQuantity: true, 
        quantityAt20C: true, 
        supportingDocUrl: true,
        receiptNumber: true,
        // When the load was discharged, as against `createdAt`, which is when
        // the receipt was typed. The pair with the T1's `loadingDate` is what
        // says how long the load was on the road.
        offloadingDate: true,
        status: true, 
        createdAt: true, 
        updatedAt: true,
        gainQty: true, 
        lossQty: true,
        toleranceRate: true,
        // A local purchase: what a litre cost, in what money, and what
        // delivered it. All null on an imported receipt, where the cost is the
        // cargo's and the truck comes through the nomination.
        unitPrice: true,
        currencyCode: true,
        truckNumber: true,
        sdReference: true,
        receiptType: true,
        // Who delivered it, on a local receipt. Named rather than left as an
        // id: the page shows it and should not have to look it up.
        supplier: { select: { id: true, name: true } },
        item: { select: {
          id: true, name: true, descriptions: true, status: true, toleranceRates: true,
          baseUnit: { select: { id: true, name: true, code: true } },
        } },
        deport: { select: { id: true, name: true, location: true, type: true, status: true } },
        // Where it was *sent*, beside where it went. Selected the same way, so
        // the two can be read against each other without a second lookup.
        destination: { select: { id: true, name: true, location: true, type: true, status: true } },
        t1Validation: { select: {
          id: true, exportingCountry: true, supportingDocUrl: true, createdAt: true,
          // What customs validated, so a receipt can be compared against it.
          quantityAt20C: true,
          // The day it was loaded, beside the day it was discharged.
          loadingDate: true,
          nomination: { select: {
            id: true, ambQuantity: true, destination: true, expectedLoadingDate: true,
            nominationVessels: { orderBy: { createdAt: "asc" }, select: {
              id: true, stockId: true, ambQuantity: true,
              stock: { select: { item: true, cargo: true } },
            } },
          } },
        } },
        transactions: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, quantity: true, type: true, note: true, supportingDocUrl: true,
            createdAt: true, updatedAt: true,
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        // What it cost to land this receipt, beside the receipt itself.
        chainStockFees: reportFeeSelect,
        stockClearances: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, quantity: true, fees: true, amount: true, status: true,
            supportingDocUrl: true, dmsDocUrl: true, dmsReference: true, assessmentDocUrl: true,
            createdAt: true, updatedAt: true,
            agent: { select: { id: true, names: true, fees: true, status: true } },
            user: { select: { id: true, firstName: true, lastName: true } },
            centralStockOrders: { select: { quantity: true, orderType: true } },
            // A row is `uncleared` while its clearance waits for approval and
            // payment, so the act it belongs to is what says why: without it
            // the page can only show "uncleared" and not that somebody is
            // still to approve. Empty on rows raised before approvals existed.
            request: { select: { id: true, clearanceStatus: true, paymentDocUrl: true,
              paidAt: true, amount: true } },
          },
        },
      },
    });

    const report = new Map<string, {
      id: string;
      ambQuantity: Prisma.Decimal;
      quantityAt20C: Prisma.Decimal;
      supportingDocUrl: string | null;
      receiptNumber: string | null;
      status: string;
      gainQty: Prisma.Decimal | null;
      lossQty: Prisma.Decimal | null;
      toleranceRate: Prisma.Decimal | null;
      item: typeof centralStocks[number]["item"];
      summary: {
        totalQuantity: number;
        receivedQuantity: number;
        reconciledInQuantity: number;
        reconciledOutQuantity: number;
        soldOutQuantity: number;
        remainingQuantity: number;
        clearedQuantity: number;
        unclearedQuantity: number;
        stockCount: number;
        quantitiesByStatus: Record<string, number>;
        clearanceQuantitiesByStatus: Record<string, number>;
        /**
         * What landing every receipt of this item cost, **grouped by
         * currency** — fees are not always in one money, and a single total
         * would be a wrong number. `{}` when none were charged.
         */
        feeTotals: Record<string, number>;
        feeCount: number;
      };
      stocks: Array<{
        id: string; 
        quantityBeforeTransactions: number; 
        receivedQuantity: number;
        reconciledInQuantity: number;
        reconciledOutQuantity: number; soldOutQuantity: number; remainingQuantity: number;
        clearedQuantity: number; unclearedQuantity: number;
        supportingDocUrl: string | null;
        receiptNumber: string | null;
        offloadingDate: Date | null;
        // The receipt's own measured figures and reconciliation — previously
        // only the newest receipt's leaked onto the item group.
        ambQuantity: number; quantityAt20C: number;
        lossQty: number | null; gainQty: number | null; toleranceRate: number | null;
        /**
         * Where this receipt's fuel came from, derived — never stored.
         *
         * `"import"` crossed a border and discharged a T1; `"local"` was
         * bought from a supplier in the country. `t1ValidationId == null` is
         * the whole of the distinction, so there is no second column that
         * could contradict it.
         *
         * ⚠️ Not the depot's `type`: an imported load is discharged at a local
         * depot too.
         */
        source: "import" | "local";
        /** A local purchase's price and carrier. Null on an import. */
        unitPrice: number | null; currencyCode: string | null; truckNumber: string | null;
        sdReference: string | null;
        receiptType: "import" | "gain" | "transfer" | "borrow" | null;
        supplier: { id: string; name: string } | null;
        // What it cost to land this receipt: each charge, and the totals by
        // currency. Empty when no fee was charged against it.
        fees: ReturnType<typeof presentFees>["fees"];
        feeTotals: Record<string, number>;
        feeCount: number;
         status: typeof centralStocks[number]["status"];
        createdAt: Date; updatedAt: Date; depot: typeof centralStocks[number]["deport"];
        destination: typeof centralStocks[number]["destination"];
        t1Validation: typeof centralStocks[number]["t1Validation"];
        clearances: Array<{
          id: string; quantity: number; fees: number | null;
          amount: number | null;
          status: typeof centralStocks[number]["stockClearances"][number]["status"];
          request: typeof centralStocks[number]["stockClearances"][number]["request"];
          supportingDocUrl: string | null; dmsDocUrl: string | null; dmsReference: string | null;
          assessmentDocUrl: string | null;
          createdAt: Date; updatedAt: Date;
          agent: typeof centralStocks[number]["stockClearances"][number]["agent"];
          clearedBy: typeof centralStocks[number]["stockClearances"][number]["user"];
        }>;
        transactions: Array<{ id: string; quantity: number; type: StockTransaction["type"]; note: string | null;
          supportingDocUrl: string | null;
          createdAt: Date; updatedAt: Date; createdBy: typeof centralStocks[number]["transactions"][number]["user"] }>;
      }>;
    }>();

    for (const stock of centralStocks) {
      let itemReport = report.get(stock.item.id);
      if (!itemReport) {
        itemReport = {
          id: stock.id, 
          ambQuantity: stock.ambQuantity, 
          quantityAt20C: stock.quantityAt20C, 
          supportingDocUrl: stock.supportingDocUrl,
          receiptNumber: stock.receiptNumber,
          status: stock.status, 
        gainQty: stock.gainQty, 
        lossQty: stock.lossQty,
        toleranceRate: stock.toleranceRate,
          item: stock.item,
          summary: {
            totalQuantity: 0,
            receivedQuantity: 0,
            reconciledInQuantity: 0,
            reconciledOutQuantity: 0,
            soldOutQuantity: 0, remainingQuantity: 0, clearedQuantity: 0, unclearedQuantity: 0, stockCount: 0,
            quantitiesByStatus: {}, clearanceQuantitiesByStatus: {},
            feeTotals: {}, feeCount: 0,
          },
          stocks: [],
        };
        report.set(stock.item.id, itemReport);
      }

      let receivedQuantity = 0;
      let reconciledInQuantity = 0;
      let reconciledOutQuantity = 0;
      let soldOutQuantity = 0;
      const transactions = stock.transactions.map((transaction) => {
          const quantity = Number(transaction.quantity);
          if (transaction.type === "received") receivedQuantity += quantity;
          if (transaction.type === "reconcilliationIn") reconciledInQuantity += quantity;
          if (transaction.type === "reconcilliationOut") reconciledOutQuantity += quantity;
          if (transaction.type === "saleOut") soldOutQuantity += quantity;
          return {
            id: transaction.id, quantity, type: transaction.type, note: transaction.note,
            supportingDocUrl: transaction.supportingDocUrl,
            createdAt: transaction.createdAt, updatedAt: transaction.updatedAt,
            createdBy: transaction.user,
          };
        });
      const clearances = stock.stockClearances.map((clearance) => {
        itemReport.summary.clearanceQuantitiesByStatus[clearance.status] =
          (itemReport.summary.clearanceQuantitiesByStatus[clearance.status] ?? 0) + Number(clearance.quantity);
        return {
          id: clearance.id, quantity: Number(clearance.quantity),
          fees: clearance.fees === null ? null : Number(clearance.fees),
          amount: clearance.amount === null ? null : Number(clearance.amount),
          status: clearance.status, request: clearance.request,
          supportingDocUrl: clearance.supportingDocUrl, dmsDocUrl: clearance.dmsDocUrl,
          dmsReference: clearance.dmsReference,
          assessmentDocUrl: clearance.assessmentDocUrl,
          createdAt: clearance.createdAt, updatedAt: clearance.updatedAt, agent: clearance.agent,
          clearedBy: clearance.user,
        };
      });

      const quantity = Number(stock.quantityAt20C);
      const remainingQuantity = (receivedQuantity + reconciledInQuantity) - (soldOutQuantity + reconciledOutQuantity);
      const availableCleared = Math.max(0, stock.stockClearances
        .filter((clearance) => clearance.status === "cleared")
        .reduce((balance, clearance) => balance + Number(clearance.quantity)
          - clearance.centralStockOrders.reduce((sold, order) => sold + Number(order.quantity), 0), 0));
      const clearedQuantity = Math.min(Math.max(0, remainingQuantity), availableCleared);
      const unclearedQuantity = Math.max(0, remainingQuantity - clearedQuantity);
      itemReport.summary.totalQuantity += quantity;
      itemReport.summary.receivedQuantity += receivedQuantity;
      itemReport.summary.reconciledInQuantity += reconciledInQuantity;
      itemReport.summary.reconciledOutQuantity += reconciledOutQuantity;
      itemReport.summary.soldOutQuantity += soldOutQuantity;
      itemReport.summary.remainingQuantity += remainingQuantity;
      itemReport.summary.clearedQuantity += clearedQuantity;
      itemReport.summary.unclearedQuantity += unclearedQuantity;
      itemReport.summary.stockCount += 1;
      itemReport.summary.quantitiesByStatus[stock.status] =
        (itemReport.summary.quantitiesByStatus[stock.status] ?? 0) + quantity;
      // Landing costs roll up to the item, still kept apart by currency.
      const landed = presentFees(stock.chainStockFees);
      itemReport.summary.feeTotals = sumFeeTotals([itemReport.summary.feeTotals, landed.feeTotals]);
      itemReport.summary.feeCount += landed.feeCount;
      itemReport.stocks.push({
        id: stock.id, quantityBeforeTransactions: quantity, receivedQuantity, reconciledInQuantity,reconciledOutQuantity,
        soldOutQuantity, remainingQuantity, clearedQuantity, unclearedQuantity,
        supportingDocUrl: stock.supportingDocUrl, status: stock.status,
        receiptNumber: stock.receiptNumber,
        offloadingDate: stock.offloadingDate,
        ambQuantity: Number(stock.ambQuantity), quantityAt20C: Number(stock.quantityAt20C),
        // Derived from whether a T1 is attached, so it cannot disagree with
        // the receipt it describes.
        source: stock.t1Validation ? "import" : "local",
        unitPrice: stock.unitPrice === null ? null : Number(stock.unitPrice),
        currencyCode: stock.currencyCode,
        truckNumber: stock.truckNumber,
        sdReference: stock.sdReference,
        receiptType: stock.receiptType,
        supplier: stock.supplier,
        lossQty: stock.lossQty === null ? null : Number(stock.lossQty),
        gainQty: stock.gainQty === null ? null : Number(stock.gainQty),
        toleranceRate: stock.toleranceRate === null ? null : Number(stock.toleranceRate),
        fees: landed.fees, feeTotals: landed.feeTotals, feeCount: landed.feeCount,
        createdAt: stock.createdAt, updatedAt: stock.updatedAt,
        // The database relation is named `deport`; expose it as `depot`.
        depot: stock.deport, destination: stock.destination,
        t1Validation: stock.t1Validation, clearances, transactions,
      });
    }

    return Array.from(report.values());
  }

  /**
   * Records fuel taken into a depot, from either end of the supply chain.
   *
   * **An imported load** discharges a T1 validation: the trip is closed off,
   * its parking released, and what it lost on the road is worked out against
   * what the T1 cleared.
   *
   * **A local purchase** has no T1 — `t1ValidationId` is null, which is the
   * whole of the distinction — so none of that applies. There is no trip to
   * close, no transporter to hold to a tolerance, and no border: instead the
   * receipt carries what it cost and the truck that brought it, and may arrive
   * already cleared.
   *
   * One record either way. A local receipt is still fuel standing in a depot:
   * the same ledger draws it, the same orders sell it, the same clearances
   * release it.
   */
  async create(data: CreateCentralStockSchema) {
    const t1ValidationId = data.t1ValidationId ?? null;
    if (t1ValidationId) {
      // One receipt per T1: a trip is discharged once. Guarded before the
      // transaction only because it reads nothing the transaction writes.
      const stock = await this.db.centralStock.findFirst({ where: { t1ValidationId } });
      if (stock) throw new BusinessError("400", "Can not Restock This T1 Validation");
    }
    if (!t1ValidationId) await this.assertLocalPurchase(data);

    return await this.db.$transaction(async (tx) => {
      if (t1ValidationId) {
        const nomination = await tx.t1Validation.findFirst({ where: { id: t1ValidationId }, select: {nominationId: true} });
        if(nomination){
          await recordStage(tx, nomination.nominationId, "stockReceived", data.createdBy);
          // The trip is over, so the vehicle is no longer held in a parking. In
          // the same write as the stock and the stage: a vehicle left standing in
          // a parking it has already left would read as still being there.
          await releaseParkingForNomination(tx, nomination.nominationId);
        }
      }

      // What it cost to land the load, charged in the same write as the
      // receipt: a receipt recorded without the fees it was received with
      // would understate the landed cost until someone noticed.
      const landing = await chargedFees(tx, data.fees ?? [], data.createdBy);

      /*
       * The difference against what the T1 cleared, at 20 °C on both sides,
       * and the allowance the product carried that day.
       *
       * Left **null** on a local purchase, and that is not a gap in the data:
       * tolerance is `t1 − received`, so with no T1 there is no figure to
       * compute and nobody to attribute it to. `receivedAsRecorded()` reads
       * both columns being null as "never recorded" and falls back to the
       * quantity itself, which is exactly right here.
       */
      const tolerance = t1ValidationId
        ? await toleranceForReceipt(tx, {
            t1ValidationId,
            itemId: data.itemId,
            receivedQuantity: data.quantityAt20C,
          })
        : null;

      return await tx.centralStock.create({
      data: {
        ambQuantity: data.ambQuantity, 
        quantityAt20C: data.quantityAt20C,
        deportId: data.deportId, 
        // Where it was sent, which is not necessarily where it was discharged.
        destinationId: data.destinationId ?? null,
        t1ValidationId, 
        receiptNumber: data.receiptNumber,
        // When the hose came off, not when this was keyed in.
        offloadingDate: data.offloadingDate ?? null,
        itemId: data.itemId,
        // What a local purchase cost, and what delivered it. Null on an
        // import, where the cost is the cargo's — the schema refuses both
        // together rather than letting a half-and-half row be written.
        unitPrice: data.unitPrice ?? null,
        currencyCode: data.currencyCode ?? null,
        truckNumber: data.truckNumber ?? null,
        // The supplier's own reference, on a local purchase only.
        sdReference: data.sdReference ?? null,
        /*
         * How the stock came in. The schema has already refused anything but
         * `import` alongside a T1 and insisted on one of the three local kinds
         * without one, so this cannot disagree with `t1ValidationId`. An
         * import that said nothing is still an import, written as such rather
         * than left null: null is reserved for the receipts recorded before
         * the question was asked.
         */
        receiptType: data.receiptType ?? (t1ValidationId ? ("import" as const) : null),
        // Where it came from, on a local receipt. Null for a gain, which came
        // from nobody, and refused by the schema on an import.
        supplierId: data.supplierId ?? null,
        transactions: { 
          create: { 
            quantity: data.quantityAt20C, 
            type: "received", 
            createdBy: data.createdBy 
          } },
        ...(landing.length ? { chainStockFees: { create: landing } } : {}),
        /*
         * A local supplier's load that arrives duty-paid, cleared in the same
         * write as the receipt.
         *
         * A real row rather than a flag, because a clearance is a quantity
         * that sales draw against: `CentralStockOrder` points at one. It
         * carries no `requestId` on purpose — there is nothing for the
         * authorizers to approve when the supplier has already paid — and it
         * carries the receipt's own document, which is what tells it apart
         * from a cleared row that simply never went through the process.
         */
        ...(data.arrivesCleared && !t1ValidationId
          ? {
              stockClearances: {
                create: {
                  quantity: data.quantityAt20C,
                  status: "cleared" as const,
                  clearedBy: data.createdBy,
                  supportingDocUrl: data.supportingDocUrl ?? null,
                },
              },
            }
          : {}),
        supportingDocUrl: data.supportingDocUrl,
        // What the trip lost or gained, worked out here rather than taken from
        // the form: it is the figure a transporter is held to, so it has to
        // follow from the two quantities and not from whoever typed them.
        ...(tolerance ? toleranceColumns(tolerance) : {}),
      },
      include: { chainStockFees: reportFeeSelect },
    })});
  }

  /**
   * What a local purchase has to say for itself before it is written.
   *
   * The shape of the request is already settled by the schema; these are the
   * facts only the database can confirm — that the currency is one we actually
   * keep, that the supplier named is one still being dealt with, and that the
   * depot is in the country. A local supplier cannot
   * deliver into a foreign or international depot, and a receipt claiming
   * otherwise would quietly corrupt the stock position of a depot that holds
   * no local stock.
   */
  private async assertLocalPurchase(data: CreateCentralStockSchema) {
    if (data.currencyCode) {
      const currency = await this.db.currency.findFirst({
        where: { code: data.currencyCode }, select: { id: true },
      });
      if (!currency) {
        throw new BusinessError("400", `"${data.currencyCode}" is not a currency on record`);
      }
    }
    if (data.supplierId) {
      const supplier = await this.db.supplier.findUnique({
        where: { id: data.supplierId }, select: { name: true, status: true },
      });
      if (!supplier) throw new NotFoundError("Supplier");
      /*
       * A retired supplier is refused rather than recorded. The point of the
       * field is to say who to go back to, and one taken off the list is one
       * nobody is dealing with any more — the same discipline as a retired fee
       * type, which `chargedFees` refuses too.
       */
      if (supplier.status !== "active") {
        throw new BusinessError("400", `${supplier.name} is no longer an active supplier`);
      }
    }
    const depots = await this.db.deport.findMany({
      where: { id: { in: [data.deportId, ...(data.destinationId ? [data.destinationId] : [])] } },
      select: { id: true, name: true, type: true },
    });
    for (const depot of depots) {
      if (depot.type !== "local") {
        throw new BusinessError(
          "400",
          `${depot.name} is a ${depot.type} depot, so a local supplier cannot deliver into it`,
        );
      }
    }
  }

  async recentStock(centralStockId: string) {
    const transactions = await this.db.stockTransaction.findMany({ where: { centralStockId } });
    return calculatingRemainStock(transactions);
  }

  async createStockTransaction(data: StockTransactionSchema, userId: string) {
    const stock = await this.db.centralStock.findUnique({ where: { id: data.centralStockId } })
    if (!stock) {
      throw new NotFoundError("Central stock not found");
    }
    const currentStock = await this.recentStock(data.centralStockId);
    if (currentStock < data.quantity && data.type === "saleOut") {
      throw new BusinessError("400", `The Remaining Stock is ${currentStock} but you're Requesting ${data.quantity}`);
    }
    return await this.db.$transaction(async (tx) => {
      const movement = await tx.stockTransaction.create({
        data: {centralStockId: data.centralStockId, quantity: data.quantity, type: data.type, createdBy: userId },
      });
      // The same rule as reconciliation: a receipt emptied by this movement is
      // closed, and one topped back up is reopened. In one transaction with
      // the movement, so the flag can never describe a balance that was never
      // written.
      await settleStockStatus(tx, data.centralStockId);
      return movement;
    });
  }

  async createReconciliation(data: StockReconciliationsBodySchema) {
  return await this.db.$transaction(async(tx) => {
    const stock = await tx.centralStock.findUnique({
      where: { id: data.centralStockId },
      select: { quantityAt20C: true, transactions: { select: { quantity: true, type: true } },
        stockClearances: { select: { quantity: true,
          // What has actually been taken against each clearance — see the
          // guard below for why the draws matter and the paperwork does not.
          centralStockOrders: { select: { quantity: true } } } } },
    });
    if (!stock) throw new NotFoundError("Central stock not found");
    if (data.reconciliationType === "reconcilliationOut") {
      const remaining = calculatingRemainStock(stock.transactions);
      if (data.quantity > remaining) {
        throw new BusinessError("400", `The Remaining Stock is ${remaining} but you're Reconciling ${data.quantity}`);
      }
      /*
       * What this receipt's fuel is already **committed to**: the litres drawn
       * against its clearances by a sale or an issue. The balance may not be
       * reconciled below that, because those litres have been promised to
       * somebody and taking them away would leave a draw pointing at stock
       * that is no longer there.
       *
       * Counted from the **draws**, not from the clearance quantities.
       * Clearing fuel is paperwork: it says the duty is settled, not that the
       * litres have left. A receipt cleared for its whole volume with nothing
       * yet sold is entirely present and entirely correctable — judging it by
       * the papers made it impossible to reconcile at all, which is precisely
       * the case a depot discrepancy needs to be recorded against.
       */
      const committed = stock.stockClearances.reduce(
        (sum, row) => sum + row.centralStockOrders.reduce((drawn, order) => drawn + Number(order.quantity), 0),
        0,
      );
      if (Number(stock.quantityAt20C) - data.quantity < committed) {
        throw new BusinessError(
          "400",
          `${committed} has already been drawn against this receipt's clearances, so its balance of `
            + `${Number(stock.quantityAt20C)} cannot be reduced by ${data.quantity}`,
        );
      }
    }
    if (data.state === "cleared") {
      if (!(await tx.stockClearance.findFirst({where: {centralStockId: data.centralStockId}}))) throw new BusinessError("400", "Can not Reconciliate stock without cleared before!");
      await tx.stockClearance.create({data: {centralStockId: data.centralStockId, quantity: data.quantity, clearedBy: data.createdBy, status: "cleared"}})
    }
    await tx.centralStock.update(
      {
        where: {
          id: data.centralStockId,
        },
        data: {
          quantityAt20C: {
          ...(data.reconciliationType === "reconcilliationIn" ? {
            increment: data.quantity
          }: {decrement: data.quantity})}
        }
      }
    );

    const movement = await tx.stockTransaction.create({ data: {
      centralStockId: data.centralStockId, 
      quantity: data.quantity,
      type: data.reconciliationType, 
      createdBy: data.createdBy,
      note: data.note, 
      supportingDocUrl: data.supportingDocUrl
    }})

    /*
     * Reconciled down to nothing closes the receipt; reconciled back up
     * reopens it. After the movement, so it is counted — and in the same
     * transaction, so a batch can never be left marked as holding fuel it no
     * longer has.
     */
    await settleStockStatus(tx, data.centralStockId);

    return movement;
  })
}
}



/**
 * The rows for the fees charged as a receipt is recorded, each copying the
 * catalogue's name, amount and currency as they stand now.
 *
 * A fee that has been retired is refused rather than charged quietly, and the
 * same fee cannot be charged twice in one receipt — its `count` says how many
 * times it applies.
 */
async function chargedFees(
  tx: Prisma.TransactionClient,
  fees: Array<{ feeTypeId: string; count: number }>,
  createdBy: string,
) {
  if (fees.length === 0) return [];
  const ids = fees.map((fee) => fee.feeTypeId);
  if (new Set(ids).size !== ids.length) {
    throw new BusinessError("DUPLICATE_FEE", "Each fee can only be charged once; use its count instead");
  }
  const types = await tx.feeType.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, amount: true, currencyCode: true, status: true },
  });
  const byId = new Map(types.map((type) => [type.id, type]));
  return fees.map((fee) => {
    const type = byId.get(fee.feeTypeId);
    if (!type) throw new NotFoundError("Fee type");
    if (type.status !== "active") {
      throw new BusinessError("FEE_INACTIVE", `"${type.name}" is no longer charged`);
    }
    return {
      feeTypeId: type.id,
      count: fee.count,
      name: type.name,
      unitAmount: type.amount,
      currencyCode: type.currencyCode,
      createdBy,
    };
  });
}

/*
 * Re-exported from `stock-status.ts`, where it lives beside the status it
 * decides. Kept here so the callers that already import it from the
 * repository do not have to move.
 */
export { calculatingRemainStock } from "./stock-status.js";
