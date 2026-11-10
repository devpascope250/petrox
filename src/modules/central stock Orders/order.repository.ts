import { CentralOrderStatus, Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { drawForRequisitionLines } from "../requisitions/requisition-load.js";
import { CentralStockOrderReportQuerySchema, CreateCentralStockOrderSchema, CreateLoadingOrderSchema, LoadingOrderListQuery, LoadingOrderStage, LoadingOrderStatusSchema, ReceptionOrdersQuerySchema, ReceiveLoadingOrderSchema } from "./order.schema.js";

/** Who asked for an order — shown so a site manager can spot their own requests. */
const requesterSelect = { select: { id: true, firstName: true, lastName: true } } as const;

/**
 * Reception progress against what was sent. When the lines and receptions are
 * already narrowed to one site, this is that site's share of the load; a load
 * can serve several sites, and each receives only its own part.
 */
function receptionProgress(
  lines: Array<{ quantity: Prisma.Decimal | number }>,
  receptions: Array<{ receivedQty: Prisma.Decimal | number }>,
) {
  const expected = lines.reduce((sum, line) => sum.plus(line.quantity), new Prisma.Decimal(0));
  const received = receptions.reduce((sum, row) => sum.plus(row.receivedQty), new Prisma.Decimal(0));
  return {
    expectedQuantity: expected.toNumber(),
    receivedQuantity: received.toNumber(),
    remainingQuantity: Prisma.Decimal.max(0, expected.minus(received)).toNumber(),
    receptionStatus: received.isZero()
      ? "notReceived"
      : received.greaterThanOrEqualTo(expected) ? "received" : "partiallyReceived",
  } as const;
}

/**
 * A site manager's view of loads: every order for **his site**, whoever raised
 * it. Receptions carry no link to individual order lines, so "received" is what
 * went into the site's own cuves.
 */
export type SiteScope = { siteId: string };

function scopedLines(scope?: SiteScope): Prisma.LoadedOrderWhereInput | undefined {
  return scope ? { order: { siteId: scope.siteId } } : undefined;
}

function scopedReceptions(scope?: SiteScope): Prisma.OrderReceptionWhereInput | undefined {
  return scope ? { cuve: { siteId: scope.siteId } } : undefined;
}

/**
 * A load's stage as a filter, in the same order the client derives it.
 *
 * `status` is the authoritative "fully received" flag — a reception sets it the
 * moment nothing is left to take in — so the rungs are columns rather than a
 * sum, and the filter stays one indexed query. A load serving several sites can
 * read "received" to a site manager whose own part is complete while the load
 * itself is still pending; that is the same approximation the reception list
 * has always made, and the badge on the row still shows the site's own share.
 */
function stageWhere(stage: LoadingOrderStage, scope?: SiteScope): Prisma.LoadingOrderWhereInput {
  switch (stage) {
    case "cancelled":
      return { status: "cancelled" };
    case "awaitingApproval":
      return { status: { not: "cancelled" }, authorizationStatus: "pending" };
    case "received":
      return { authorizationStatus: "approved", status: "received" };
    case "partiallyReceived":
      return {
        authorizationStatus: "approved", status: "pending",
        orderReceptions: { some: scopedReceptions(scope) ?? {} },
      };
    case "toReceive":
      return {
        authorizationStatus: "approved", status: "pending",
        orderReceptions: { none: scopedReceptions(scope) ?? {} },
      };
  }
}

/** Every stage, so the tabs can be counted in one pass. */
const LOADING_ORDER_STAGES = [
  "awaitingApproval", "toReceive", "partiallyReceived", "received", "cancelled",
] as const satisfies readonly LoadingOrderStage[];

export class CentralStockOrderRepository {
  constructor(readonly db: PrismaClient) {}

  /**
   * Stockout orders in a period, each with how far it has got: loaded onto a
   * truck, received at its site, and what is still to arrive. `siteId`
   * narrows the list — and every total — to one site's orders.
   */
  async list(query: CentralStockOrderReportQuerySchema & { startDate: Date; endDate: Date }) {
    const orders = await this.db.centralStockOrder.findMany({
      orderBy: { createdAt: "desc" },
      where: {
        createdAt: { gte: query.startDate, lte: query.endDate },
        ...(query.itemId && { centralStock: { itemId: query.itemId } }),
        ...(query.siteId && { siteId: query.siteId }),
        ...(query.status && { status: query.status }),
        ...(query.orderType && { orderType: query.orderType }),
      },
      select: {
        id: true, quantity: true, unitPrice: true, totalPrice: true, orderType: true,
        status: true, approvedAt: true, createdAt: true, updatedAt: true, siteId: true,
        site: { select: { id: true, name: true, phone: true, email: true, address: true, status: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        approvedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        clearance: { select: {
          id: true, quantity: true, status: true, fees: true, amount: true,
          supportingDocUrl: true, dmsDocUrl: true, createdAt: true,
          agent: { select: { id: true, names: true, fees: true, status: true } },
        } },
        centralStock: { select: {
          id: true, ambQuantity: true, quantityAt20C: true, gainQty: true, lossQty: true,  status: true, createdAt: true,
          item: { select: { id: true, name: true, descriptions: true,
            baseUnit: { select: { id: true, name: true, code: true } } } },
          deport: { select: { id: true, name: true, location: true, type: true, status: true } },
          t1Validation: { select: { id: true, exportingCountry: true } },
        } },
        loadedOrders: { select: {
          id: true, quantity: true,
          loadingOrder: { select: {
            id: true, totalQuantity: true, authoriserCount: true, status: true, authorizationStatus: true,
            createdAt: true, updatedAt: true,
            dVehicle: { select: {
              id: true, status: true,
              driver: { select: { id: true, names: true, phone: true, lisence: true, passport: true } },
              vechile: { select: { id: true, platNumber: true, truckNumber: true, trailerNumber: true,
                model: true, tankCapacity: true, status: true } },
            } },
            authorizers: { select: { id: true, createdAt: true,
              user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
            // To work out how much of this order has been received — see below.
            orderReceptions: { select: { receivedQty: true, cuve: { select: { siteId: true } } } },
            loadedOrders: { orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: { id: true, quantity: true, order: { select: { siteId: true } } } },
          } },
        } },
      },
    });

    /*
     * A reception is recorded against a load, not against one order on it. What
     * a site took in on a load — into its own cuves — is spread across that
     * site's lines on the load, oldest first. That gives each order its
     * received figure.
     */
    const receivedByLine = new Map<string, number>();
    for (const order of orders) {
      for (const line of order.loadedOrders) {
        const load = line.loadingOrder;
        if (receivedByLine.has(line.id)) continue;
        const site = order.siteId;
        let pool = load.orderReceptions
          .filter((reception) => reception.cuve.siteId === site)
          .reduce((sum, reception) => sum + Number(reception.receivedQty), 0);
        for (const sibling of load.loadedOrders.filter((row) => row.order.siteId === site)) {
          const share = Math.min(Number(sibling.quantity), Math.max(0, pool));
          receivedByLine.set(sibling.id, share);
          pool -= share;
        }
      }
    }

    const summary = {
      orderCount: orders.length,
      totalQuantity: 0,
      /** On trucks so far, including what has already been received. */
      loadedQuantity: 0,
      receivedQuantity: 0,
      /** Approved or pending, and not yet received — what is still to come. */
      remainingQuantity: 0,
      totalAmount: 0,
      averageUnitPrice: 0,
      quantitiesByStatus: {} as Record<string, number>,
      amountsByStatus: {} as Record<string, number>,
      quantitiesByOrderType: {} as Record<string, number>,
      amountsByOrderType: {} as Record<string, number>,
    };
    let weightedUnitPrice = 0;
    const itemBreakdown = new Map<string, { item: typeof orders[number]["centralStock"]["item"]; orderCount: number; quantity: number; amount: number }>();
    const siteBreakdown = new Map<string, { site: NonNullable<typeof orders[number]["site"]>; orderCount: number; quantity: number; amount: number }>();
    const rows = orders.map((order) => {
      const quantity = Number(order.quantity);
      const unitPrice = Number(order.unitPrice);
      const totalPrice = Number(order.totalPrice);
      const liveLines = order.loadedOrders.filter((line) => line.loadingOrder.status !== "cancelled");
      const loadedQuantity = liveLines.reduce((sum, line) => sum + Number(line.quantity), 0);
      const receivedQuantity = liveLines.reduce((sum, line) => sum + (receivedByLine.get(line.id) ?? 0), 0);
      const closed = order.status === "rejected" || order.status === "cancelled";
      const remainingQuantity = closed ? 0 : Math.max(0, quantity - receivedQuantity);
      const deliveryStatus = closed ? "closed"
        : order.status === "pending" ? "awaitingApproval"
        : receivedQuantity >= quantity ? "received"
        : receivedQuantity > 0 ? "partiallyReceived"
        : loadedQuantity > 0 ? "inTransit" : "awaitingLoad";
      summary.totalQuantity += quantity;
      summary.loadedQuantity += loadedQuantity;
      summary.receivedQuantity += receivedQuantity;
      summary.remainingQuantity += remainingQuantity;
      summary.totalAmount += totalPrice;
      weightedUnitPrice += unitPrice * quantity;
      summary.quantitiesByStatus[order.status] = (summary.quantitiesByStatus[order.status] ?? 0) + quantity;
      summary.amountsByStatus[order.status] = (summary.amountsByStatus[order.status] ?? 0) + totalPrice;
      summary.quantitiesByOrderType[order.orderType] = (summary.quantitiesByOrderType[order.orderType] ?? 0) + quantity;
      summary.amountsByOrderType[order.orderType] = (summary.amountsByOrderType[order.orderType] ?? 0) + totalPrice;
      const itemRow = itemBreakdown.get(order.centralStock.item.id) ?? {
        item: order.centralStock.item, orderCount: 0, quantity: 0, amount: 0,
      };
      itemRow.orderCount += 1;
      itemRow.quantity += quantity;
      itemRow.amount += totalPrice;
      itemBreakdown.set(order.centralStock.item.id, itemRow);
      if (order.site) {
        const siteRow = siteBreakdown.get(order.site.id) ?? {
          site: order.site, orderCount: 0, quantity: 0, amount: 0,
        };
        siteRow.orderCount += 1;
        siteRow.quantity += quantity;
        siteRow.amount += totalPrice;
        siteBreakdown.set(order.site.id, siteRow);
      }
      return {
        ...order, quantity, unitPrice, totalPrice,
        loadedQuantity, receivedQuantity, remainingQuantity, deliveryStatus,
        clearance: { ...order.clearance, quantity: Number(order.clearance.quantity),
          fees: order.clearance.fees === null ? null : Number(order.clearance.fees),
          amount: order.clearance.amount === null ? null : Number(order.clearance.amount),
          agent: order.clearance.agent ? { ...order.clearance.agent, fees: Number(order.clearance.agent.fees) } : null },
        centralStock: { ...order.centralStock, quantity: Number(order.centralStock.quantityAt20C) },
        loadedOrders: order.loadedOrders.map((loadedOrder) => ({
          ...loadedOrder, quantity: Number(loadedOrder.quantity),
          receivedQuantity: receivedByLine.get(loadedOrder.id) ?? 0,
          loadingOrder: { ...loadedOrder.loadingOrder,
            // Used above to work out received figures; not part of the response.
            orderReceptions: undefined, loadedOrders: undefined,
            totalQuantity: Number(loadedOrder.loadingOrder.totalQuantity),
            dVehicle: { ...loadedOrder.loadingOrder.dVehicle,
              vechile: { ...loadedOrder.loadingOrder.dVehicle.vechile,
                tankCapacity: Number(loadedOrder.loadingOrder.dVehicle.vechile.tankCapacity) } } },
        })),
      };
    });
    summary.averageUnitPrice = summary.totalQuantity === 0 ? 0 : weightedUnitPrice / summary.totalQuantity;
    return {
      summary,
      breakdowns: { items: Array.from(itemBreakdown.values()), sites: Array.from(siteBreakdown.values()) },
      orders: rows,
    };
  }

  find(id: string) {
    return this.db.centralStockOrder.findUnique({ where: { id },
      include: { site: true, clearance: true, centralStock: true, approvedUser: true,
        loadedOrders: { include: { loadingOrder: { include: {
          dVehicle: { include: { driver: true, vechile: true } },
          authorizers: { include: { user: true } } } } } } } });
  }

  /** Everything the loading-order list is narrowed by, in one place. */
  private loadingOrderWhere(query: LoadingOrderListQuery, scope?: SiteScope): Prisma.LoadingOrderWhereInput {
    const term = query.search?.trim();
    /*
     * `AND`, not one object: the site scope and a search both narrow
     * `loadedOrders`, and two `loadedOrders` keys in the same object would
     * leave only the last one standing.
     */
    const and: Prisma.LoadingOrderWhereInput[] = [];
    if (scope) and.push({ loadedOrders: { some: scopedLines(scope) } });
    if (query.startDate || query.endDate) {
      and.push({ createdAt: {
        ...(query.startDate && { gte: query.startDate }),
        ...(query.endDate && { lte: query.endDate }),
      } });
    }
    if (term) {
      and.push({ OR: [
        { dVehicle: { vechile: { platNumber: { contains: term } } } },
        { dVehicle: { driver: { names: { contains: term } } } },
        { loadedOrders: { some: { order: { centralStock: { item: { name: { contains: term } } } } } } },
        { loadedOrders: { some: { order: { site: { name: { contains: term } } } } } },
        { loadedOrders: { some: { order: { user: { firstName: { contains: term } } } } } },
        { loadedOrders: { some: { order: { user: { lastName: { contains: term } } } } } },
      ] });
    }
    if (query.stage) and.push(stageWhere(query.stage, scope));
    return and.length > 0 ? { AND: and } : {};
  }

  /**
   * How many loads sit at each stage in the window, for the tab badges.
   *
   * The stage is what the tabs count, so it is not also a filter here — and
   * never the page's own rows: a page of fifteen cannot say how many loads are
   * waiting to be signed.
   */
  async loadingOrderStageCounts(query: LoadingOrderListQuery, scope?: SiteScope) {
    const { stage: _ignored, ...rest } = query;
    const base = this.loadingOrderWhere(rest, scope);
    const counts = await this.db.$transaction([
      this.db.loadingOrder.count({ where: base }),
      ...LOADING_ORDER_STAGES.map((stage) => this.db.loadingOrder.count({
        where: { AND: [base, stageWhere(stage, scope)] },
      })),
    ]);
    const [all, ...byStage] = counts;
    return {
      all,
      ...Object.fromEntries(LOADING_ORDER_STAGES.map((stage, at) => [stage, byStage[at]])),
    } as Record<"all" | LoadingOrderStage, number>;
  }

  /**
   * One page of loading orders in the window, newest first — or, for a site
   * manager, only the loads carrying orders for his site, narrowed to those
   * orders and his site's own receptions.
   */
  async listLoadingOrders(query: LoadingOrderListQuery, scope?: SiteScope) {
    const where = this.loadingOrderWhere(query, scope);
    const [rows, total] = await this.db.$transaction([
      this.db.loadingOrder.findMany({
        ...paginationArgs(query),
        where,
        // `createdAt` alone is not a total order, and loads raised in the same
        // second would then repeat across pages.
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: {
          loadedOrders: {
            where: scopedLines(scope),
            include: { order: {
              include: { centralStock: { include: { item: true } }, site: true, user: requesterSelect },
            } },
          },
          dVehicle: { include: { driver: true, vechile: true } },
          authorizers: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
          orderReceptions: {
            where: scopedReceptions(scope),
            orderBy: { createdAt: "asc" },
            select: {
              id: true, expectedQty: true, receivedQty: true, comment: true, status: true, createdAt: true,
              cuve: { select: { id: true, name: true, siteId: true } },
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.db.loadingOrder.count({ where }),
    ]);
    const loads = rows.map((load) => ({
      ...load,
      ...receptionProgress(load.loadedOrders, load.orderReceptions),
      orderReceptions: load.orderReceptions.map((reception) => ({
        ...reception,
        expectedQty: Number(reception.expectedQty),
        receivedQty: Number(reception.receivedQty),
      })),
    }));
    return [loads, total] as const;
  }

  async listReceptionOrders(query: ReceptionOrdersQuerySchema, scope?: SiteScope) {
    const where: Prisma.LoadingOrderWhereInput = {
      // A site manager: only loads carrying orders for his site. Anyone else
      // may narrow to a site with the `siteId` filter.
      ...(scope
        ? { loadedOrders: { some: scopedLines(scope) } }
        : query.siteId ? { loadedOrders: { some: { order: { siteId: query.siteId } } } } : {}),
      ...(query.receptionStatus === "notReceived"
        ? { orderReceptions: { none: scopedReceptions(scope) ?? {} } } : {}),
      ...(query.receptionStatus === "partiallyReceived"
        ? { status: "pending", orderReceptions: { some: {} } } : {}),
      ...(query.receptionStatus === "received"
        ? { status: "received", orderReceptions: { some: {} } } : {}),
    };
    const [orders, total] = await this.db.$transaction([
      this.db.loadingOrder.findMany({
        ...paginationArgs(query),
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, totalQuantity: true, status: true, authorizationStatus: true,
          createdAt: true, updatedAt: true,
          // A load can serve several sites; a site manager sees only their part.
          loadedOrders: { where: scopedLines(scope), select: {
            id: true, quantity: true,
            order: { select: {
              id: true, siteId: true, quantity: true, orderType: true, status: true,
              site: { select: { id: true, name: true } },
              user: requesterSelect,
              centralStock: { select: {
                id: true,
                item: { select: { id: true, name: true, descriptions: true,
                  baseUnit: { select: { id: true, name: true, code: true } } } },
              } },
            } },
          } },
          dVehicle: { select: {
            id: true,
            driver: { select: { id: true, names: true, phone: true } },
            vechile: { select: { id: true, platNumber: true, truckNumber: true, trailerNumber: true } },
          } },
          orderReceptions: {
            where: scopedReceptions(scope),
            orderBy: { createdAt: "asc" },
            select: {
              id: true, expectedQty: true, receivedQty: true, comment: true, status: true, createdAt: true,
              cuve: { select: { id: true, name: true, siteId: true } },
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.db.loadingOrder.count({ where }),
    ]);

    return [orders.map((order) => {
      const progress = receptionProgress(order.loadedOrders, order.orderReceptions);
      return {
        ...order,
        // The whole load, kept apart from this site's share of it.
        loadTotalQuantity: Number(order.totalQuantity),
        totalQuantity: progress.expectedQuantity,
        ...progress,
        loadedOrders: order.loadedOrders.map((loadedOrder) => ({
          ...loadedOrder,
          quantity: Number(loadedOrder.quantity),
          order: { ...loadedOrder.order, quantity: Number(loadedOrder.order.quantity) },
        })),
        orderReceptions: order.orderReceptions.map((reception) => ({
          ...reception,
          expectedQty: Number(reception.expectedQty),
          receivedQty: Number(reception.receivedQty),
        })),
      };
    }), total] as const;
  }

  /** A site manager takes in his site's orders, into a tank at his site. */
  receiveLoadingOrder(loadingOrderId: string, input: ReceiveLoadingOrderSchema, scope: SiteScope, userId: string) {
    const { siteId } = scope;
    return this.db.$transaction(async (tx) => {
      const loadingOrder = await tx.loadingOrder.findFirst({
        where: { id: loadingOrderId, loadedOrders: { some: scopedLines(scope) } },
        select: {
          id: true, totalQuantity: true, status: true, authorizationStatus: true, driverVehicleId: true,
          loadedOrders: { where: scopedLines(scope), select: {
            quantity: true,
            order: { select: {
              siteId: true, requisitionLineId: true,
              centralStock: { select: { itemId: true } },
            } },
          } },
          orderReceptions: { select: { receivedQty: true, cuve: { select: { siteId: true } } } },
        },
      });
      if (!loadingOrder) throw new NotFoundError("Loading order carrying orders for your site");
      if (loadingOrder.status === "cancelled") {
        throw new BusinessError("LOADING_ORDER_CANCELLED", "A cancelled loading order cannot be received");
      }
      if (loadingOrder.status === "received") {
        throw new BusinessError("LOADING_ORDER_RECEIVED", "This loading order has already been fully received");
      }
      if (loadingOrder.authorizationStatus !== "approved") {
        throw new BusinessError("LOADING_ORDER_NOT_APPROVED", "Loading order must be fully approved before reception");
      }

      const cuve = await tx.tblCuve.findFirst({
        where: { id: input.cuveId, siteId, status: "active" },
        select: { id: true, itemId: true, maximum: true, balance: true },
      });
      if (!cuve) throw new NotFoundError("Active cuve for this site");
      const itemIds = new Set(loadingOrder.loadedOrders.map(({ order }) => order.centralStock.itemId));
      if (itemIds.size !== 1 || !itemIds.has(cuve.itemId)) {
        throw new BusinessError("CUVE_ITEM_MISMATCH", "The cuve item does not match the loading-order item");
      }

      // What the site has already taken in on this load, into its own cuves.
      const received = loadingOrder.orderReceptions.filter((reception) => reception.cuve.siteId === siteId).reduce(
        (sum, reception) => sum.plus(reception.receivedQty), new Prisma.Decimal(0));
      const quantity = new Prisma.Decimal(input.receivedQty);
      const expected = loadingOrder.loadedOrders.reduce(
        (sum, loadedOrder) => sum.plus(loadedOrder.quantity), new Prisma.Decimal(0));
      if (received.plus(quantity).greaterThan(expected)) {
        throw new BusinessError("RECEPTION_QUANTITY_EXCEEDED", `Only ${expected.minus(received).toString()} remains to receive`);
      }

      // A shortfall must be explained. Decimals are objects, so they are compared
      // with `equals` — `!==` compared references and was always true, which
      // demanded a comment on every reception, even an exact one.
      if (!received.plus(quantity).equals(expected) && !input.comment?.trim()) {
        throw new BusinessError(
          "RECEPTION_COMMENT",
          `Received ${received.plus(quantity).toString()} of ${expected.toString()} expected — explain the difference in a comment`,
        );
      }
      const cuveQuantity = cuve.balance;
      if (cuveQuantity.plus(quantity).greaterThan(cuve.maximum)) {
        throw new BusinessError("CUVE_CAPACITY_EXCEEDED", `Cuve has capacity for only ${cuve.maximum.minus(cuveQuantity).toString()}`);
      }

      const totalReceived = loadingOrder.orderReceptions.reduce(
        (sum, reception) => sum.plus(reception.receivedQty), new Prisma.Decimal(0));
      const fullyReceived = totalReceived.plus(quantity).equals(loadingOrder.totalQuantity);
      const reception = await tx.orderReception.create({
        data: {
          loadingOrderId,
          cuveId: cuve.id,
          expectedQty: expected,
          receivedQty: quantity,
          receivedBy: userId,
          status: "received",
          comment: input.comment
        },
        include: {
          cuve: { select: { id: true, name: true, siteId: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      await tx.tblCuve.update({
        where: { id: cuve.id },
        data: { balance: { increment: quantity } },
      });
      await tx.cuveTransaction.create({
        data: {
          cuveId: cuve.id,
          quantity,
          type: "received",
          direction: "IN",
          note: `Loading order ${loadingOrderId}; reception ${reception.id}`,
          createdBy: userId,
          orderReceptionId: reception.id,
        },
      });
      await tx.loadingOrder.update({
        where: { id: loadingOrderId },
        data: { status: fullyReceived ? "received" : "pending" },
      });

      /*
       * The requisition lines this load carries follow what actually arrived.
       *
       * A reception is for the whole load into one tank, while a load may carry
       * several lines, so what arrived is **shared across them in proportion to
       * what each put on the truck**. There is no finer truth available: the
       * fuel is mixed in the compartment, and a shortfall belongs to all of it.
       * The last line takes the rounding, so the parts always sum to the whole.
       */
      // Truthiness, not `!== null`: a B2B draw has no line, and a caller that
      // did not select the field at all would otherwise pass this filter and
      // then try to update a line with no id.
      const carriedLines = loadingOrder.loadedOrders.filter(
        (line) => Boolean(line.order.requisitionLineId));
      if (carriedLines.length > 0) {
        const loadedTotal = carriedLines.reduce(
          (sum, line) => sum.plus(line.quantity), new Prisma.Decimal(0));
        let left = quantity;
        for (const [index, line] of carriedLines.entries()) {
          const share = index === carriedLines.length - 1
            ? left
            : quantity.times(line.quantity).dividedBy(loadedTotal).toDecimalPlaces(2);
          left = left.minus(share);
          await tx.requisitionLine.update({
            where: { id: line.order.requisitionLineId! },
            data: { receivedQuantity: { increment: share } },
          });
        }

        // A requisition is delivered once every line has taken in what was
        // granted. Checked per requisition, since one load can serve several.
        const requisitionIds = [...new Set((await tx.requisitionLine.findMany({
          where: { id: { in: carriedLines.map((line) => line.order.requisitionLineId!) } },
          select: { requisitionId: true },
        })).map((line) => line.requisitionId))];
        for (const requisitionId of requisitionIds) {
          const lines = await tx.requisitionLine.findMany({
            where: { requisitionId },
            select: { quantity: true, approvedQuantity: true, receivedQuantity: true },
          });
          const complete = lines.every((line) =>
            new Prisma.Decimal(line.receivedQuantity)
              .greaterThanOrEqualTo(line.approvedQuantity ?? line.quantity));
          if (!complete) continue;
          const requisition = await tx.requisition.findUniqueOrThrow({
            where: { id: requisitionId }, select: { step: true },
          });
          if (requisition.step === "delivered") continue;
          await tx.requisition.update({ where: { id: requisitionId }, data: { step: "delivered" } });
          await tx.requisitionTimeline.create({
            data: {
              requisitionId, step: "delivered", changedBy: userId,
              comment: "Received at the station", toQuantity: quantity,
            },
          });
        }
      }
      if (fullyReceived) {
        const outstanding = await tx.loadingOrder.count({
          where: { driverVehicleId: loadingOrder.driverVehicleId, status: "pending" },
        });
        if (outstanding === 0) {
          await tx.driverVehicles.update({
            where: { id: loadingOrder.driverVehicleId },
            data: { status: "active" },
          });
        }
      }
      return {
        ...reception,
        expectedQty: Number(reception.expectedQty),
        receivedQty: Number(reception.receivedQty),
        loadingOrderStatus: fullyReceived ? "received" : "pending",
        remainingQuantity: Number(expected.minus(received).minus(quantity)),
      };
    }, { isolationLevel: "Serializable" });
  }

  createLoadingOrders(input: CreateLoadingOrderSchema, createdBy: string) {
    return this.db.$transaction(async (tx) => {
      const authoriserCount = await tx.authorizers.count({
        where: { type: "LOADING_ORDER", status: "active" },
      });
      if (authoriserCount === 0) {
        throw new BusinessError("400", "Configure at least one active loading-order authorizer first");
      }
      const driverVehicle = await tx.driverVehicles.findUnique({
        where: { id: input.driverVehicleId },
        include: { driver: true, vechile: true,
          loadingOrders: { where: { status: "pending" }, select: { totalQuantity: true } } },
      });
      if (!driverVehicle) throw new NotFoundError("Driver/vehicle assignment");
      if (driverVehicle.status !== "active" || driverVehicle.driver.status !== "active"
        || driverVehicle.vechile.status !== "active") {
        throw new BusinessError("400", "Driver and vehicle assignment must be active");
      }

      const currentVehicleLoad = driverVehicle.loadingOrders.reduce(
        (sum, loadingOrder) => sum + Number(loadingOrder.totalQuantity), 0);
      /*
       * The station's lines are drawn from cleared stock first, which is where
       * an internal transfer commits its litres. Each line can span two
       * batches, so one line may produce more than one draw — and from here on
       * they are ordinary draws, carried by the same `loadedOrders` as a B2B
       * sale's. The whole thing is one serialisable transaction, so a line that
       * cannot be served rolls the load back rather than leaving half a draw.
       */
      const requisitionDraws = input.requisitionLines.length > 0
        ? await drawForRequisitionLines(tx, input.requisitionLines, createdBy)
        : [];
      const carried = [
        ...input.orders,
        ...requisitionDraws.map((draw) => ({ orderId: draw.id, quantity: draw.quantity })),
      ];
      const requestedLoad = carried.reduce((sum, order) => sum + order.quantity, 0);
      const tankCapacity = Number(driverVehicle.vechile.tankCapacity);
      if (currentVehicleLoad + requestedLoad > tankCapacity) {
        throw new BusinessError("400",
          `Vehicle capacity is ${tankCapacity}; ${currentVehicleLoad} is already assigned and ${requestedLoad} was requested`);
      }

      const orderIds = carried.map((order) => order.orderId);
      const orders = await tx.centralStockOrder.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, quantity: true, siteId: true, status: true,
          centralStock: { select: { itemId: true } },
          loadedOrders: { where: { loadingOrder: { status: { not: "cancelled" } } },
            select: { quantity: true } } },
      });
      if (orders.length !== orderIds.length) throw new NotFoundError("One or more central stock orders");
      if (orders.some((order) => order.status !== "approved")) {
        throw new BusinessError("400", "Only approved central stock orders can be loaded");
      }
      const siteIds = new Set(orders.map((order) => order.siteId));
      // if (siteIds.size !== 1 || orders[0]?.siteId === null) {
      //   throw new BusinessError("400", "All orders in a loading order must belong to the same site");
      // }
      if (new Set(orders.map((order) => order.centralStock.itemId)).size !== 1) {
        throw new BusinessError("400", "All orders in a loading order must contain the same item");
      }
      const byId = new Map(orders.map((order) => [order.id, order]));
      for (const requested of carried) {
        const order = byId.get(requested.orderId)!;
        const assigned = order.loadedOrders.reduce((sum, row) => sum + Number(row.quantity), 0);
        if (assigned + requested.quantity > Number(order.quantity)) {
          throw new BusinessError("400",
            `Order ${order.id} has ${Number(order.quantity) - assigned} unassigned but ${requested.quantity} was requested`);
        }
      }

      const created = await tx.loadingOrder.create({
        data: {
          driverVehicleId: input.driverVehicleId,
          totalQuantity: requestedLoad,
          authoriserCount,
          loadedOrders: { create: carried.map((order) => ({
            orderId: order.orderId,
            quantity: order.quantity,
          })) },
        },
        include: {
          loadedOrders: { include: { order: true } },
          dVehicle: { include: { driver: true, vechile: true } },
        },
      });
      await tx.driverVehicles.update({
        where: { id: input.driverVehicleId },
        data: { status: "occupied" },
      });
      return created;
    }, { isolationLevel: "Serializable" });
  }

  async updateLoadingOrderStatus(id: string, input: LoadingOrderStatusSchema) {
    return this.db.$transaction(async (tx) => {
      const loadingOrder = await tx.loadingOrder.findUnique({ where: { id } });
      if (!loadingOrder) throw new NotFoundError("Loading order");
      const updated = await tx.loadingOrder.update({
        where: { id },
        data: { status: input.status },
      });
      if (input.status === "cancelled") {
        const outstanding = await tx.loadingOrder.count({
          where: { driverVehicleId: loadingOrder.driverVehicleId, status: "pending" },
        });
        if (outstanding === 0) {
          await tx.driverVehicles.update({
            where: { id: loadingOrder.driverVehicleId },
            data: { status: "active" },
          });
        }
      }
      return updated;
    });
  }

  create(input: CreateCentralStockOrderSchema) {
    return this.db.$transaction(async (tx) => {
      const stocks = await tx.centralStock.findMany({
        where: { itemId: input.itemId, status: "inStock" }, orderBy: { createdAt: "asc" },
        select: { id: true, quantityAt20C: true, status: true,
          transactions: { select: { quantity: true, type: true } }, stockClearances: {
          orderBy: { createdAt: "asc" }, select: { id: true, status: true, quantity: true,
            centralStockOrders: { select: { quantity: true } } } } },
      });
      let requested = input.quantity;
      const allocations: Array<{ centralStockId: string; clearanceId: string; quantity: number }> = [];

      for (const stock of stocks) {
        if (requested <= 0) break;
        let physicalAvailable = stock.transactions.reduce((balance, transaction) => {
          const quantity = Number(transaction.quantity);
          return transaction.type === "received" || transaction.type === "reconcilliationIn"
            ? balance + quantity : balance - quantity;
        }, 0);
        if (input.orderType === "internal") {
          for (const clearance of stock.stockClearances.filter((row) => row.status === "cleared")) {
            if (requested <= 0) break;
            const sold = clearance.centralStockOrders.reduce((sum, order) => sum + Number(order.quantity), 0);
            const available = Math.max(0, Number(clearance.quantity) - sold);
            const quantity = Math.min(available, requested, Math.max(0, physicalAvailable));
            if (quantity > 0) allocations.push({ centralStockId: stock.id, clearanceId: clearance.id, quantity });
            requested -= quantity;
            physicalAvailable -= quantity;
          }
        } else {
          const allocated = stock.stockClearances.reduce((sum, row) => sum + Number(row.quantity), 0);
          const clearedRemaining = stock.stockClearances
            .filter((row) => row.status === "cleared")
            .reduce((balance, row) => balance + Number(row.quantity)
              - row.centralStockOrders.reduce((sold, order) => sold + Number(order.quantity), 0), 0);
          const available = Math.max(0, Math.min(
            Number(stock.quantityAt20C) - allocated,
            physicalAvailable - Math.max(0, clearedRemaining),
          ));
          const quantity = Math.min(available, requested);
          if (quantity > 0) {
            const clearance = await tx.stockClearance.create({ data: {
              centralStockId: stock.id, quantity, status: "uncleared" } });
            allocations.push({ centralStockId: stock.id, clearanceId: clearance.id, quantity });
          }
          requested -= quantity;
        }
      }
      if (requested > 0) {
        const kind = input.orderType === "internal" ? "cleared" : "uncleared";
        throw new BusinessError("400", `Only ${input.quantity - requested} ${kind} stock is available`);
      }

      const orders = [];
      for (const allocation of allocations) {
        const order = await tx.centralStockOrder.create({ data: {
          ...allocation, orderType: input.orderType, siteId: input.siteId,
          unitPrice: input.unitPrice, totalPrice: allocation.quantity * input.unitPrice,
          createdBy: input.createdBy, approvedBy: input.approvedBy, status: input.status } });
        // `drawId` is what makes this movement findable later. Without it the
        // only handle was `centralStockId` + `type`, which matches every other
        // withdrawal from the same batch.
        await tx.stockTransaction.create({ data: { centralStockId: allocation.centralStockId,
          quantity: allocation.quantity, type: "saleOut", drawId: order.id,
          createdBy: input.createdBy } });
        // Where the trail starts, so the history reads from the request down.
        await tx.centralStockOrderEvent.create({ data: {
          orderId: order.id, action: "requested",
          toQuantity: allocation.quantity, actedBy: input.createdBy } });
        orders.push(order);
      }
      return orders;
    }, { isolationLevel: "Serializable" });
  }


  async changeOrderStatus(id: string, status: CentralOrderStatus, actedBy?: string) {
    return this.db.$transaction(async (tx) => {
      const order = await tx.centralStockOrder.findUnique({ where: { id } });
      if (!order) {
        throw new NotFoundError("Central stock order not found");
      }
      // A request sent back to be changed is not decided yet, so it can still
      // be rejected or cancelled outright — but not approved behind the back of
      // the change that was asked for.
      const decidable: CentralOrderStatus[] = status === "approved"
        ? ["pending"]
        : ["pending", "editing"];
      if (!decidable.includes(order.status)) {
        throw new BusinessError(
          "400",
          order.status === "editing"
            ? "This request was sent back to be changed; it must be edited before it can be approved"
            : `Only pending requests can be ${status}`,
        );
      }
      const updated = await tx.centralStockOrder.update({
        where: { id },
        data: {
          status,
          ...(status === "approved" && actedBy
            ? { approvedBy: actedBy, approvedAt: new Date() }
            : {}),
        },
      });
      if (actedBy && (status === "approved" || status === "rejected" || status === "cancelled")) {
        await tx.centralStockOrderEvent.create({
          data: { orderId: id, action: status, toQuantity: order.quantity, actedBy },
        });
      }
      return updated;
    });
  }

  /**
   * Sends a request back to whoever raised it, to change the quantity.
   *
   * The admin does not edit the figure themselves: the person who asked for the
   * stock owns the request, so it goes back with a reason and they change it.
   * Only in `editing` may they, and saving returns it for a decision.
   */
  async requestEdit(id: string, comment: string, actedBy: string) {
    return this.db.$transaction(async (tx) => {
      const order = await tx.centralStockOrder.findUnique({
        where: { id },
        select: { id: true, status: true, quantity: true },
      });
      if (!order) throw new NotFoundError("Central stock order not found");
      if (order.status !== "pending") {
        throw new BusinessError(
          "400",
          order.status === "editing"
            ? "This request is already waiting to be changed"
            : `A ${order.status} request cannot be sent back`,
        );
      }
      await tx.centralStockOrderEvent.create({
        data: { orderId: id, action: "editRequested", comment, fromQuantity: order.quantity, actedBy },
      });
      return tx.centralStockOrder.update({ where: { id }, data: { status: "editing" } });
    });
  }

  /**
   * The new quantity, from whoever raised the request.
   *
   * Refused unless the request is in `editing` — nobody edits an approved
   * request — and the figure has to fit what the stock still has, which is the
   * same ceiling the request was checked against when it was raised. The old
   * and new figures go on the event, so the trail says what moved.
   */
  async editQuantity(id: string, quantity: number, comment: string | undefined, actedBy: string) {
    return this.db.$transaction(async (tx) => {
      const order = await tx.centralStockOrder.findUnique({
        where: { id },
        select: {
          id: true, status: true, quantity: true, unitPrice: true, createdBy: true,
          clearanceId: true, centralStockId: true,
        },
      });
      if (!order) throw new NotFoundError("Central stock order not found");
      if (order.status !== "editing") {
        throw new BusinessError(
          "400",
          "This request is not open for changes. An approver must send it back first.",
        );
      }

      const was = Number(order.quantity);
      if (quantity === was) {
        throw new BusinessError("400", "The quantity is unchanged");
      }

      // Growing the request has to fit what the clearance still holds: the rest
      // of it may already be promised to other requests.
      if (quantity > was) {
        const clearance = await tx.stockClearance.findUniqueOrThrow({
          where: { id: order.clearanceId },
          select: {
            quantity: true,
            centralStockOrders: { where: { id: { not: id } }, select: { quantity: true } },
          },
        });
        const promised = clearance.centralStockOrders.reduce(
          (sum, other) => sum + Number(other.quantity), 0);
        const room = Number(clearance.quantity) - promised;
        if (quantity > room) {
          throw new BusinessError(
            "400",
            `Only ${room} is available on this clearance; ${quantity} was asked for`,
          );
        }
      }

      const updated = await tx.centralStockOrder.update({
        where: { id },
        data: {
          quantity,
          totalPrice: Number(order.unitPrice) * quantity,
          // Changed and handed back: it needs a decision again.
          status: "pending",
        },
      });
      // The stock movement recorded when it was raised has to follow the
      // figure — this order's movement, and no other.
      //
      // This used to match on `centralStockId` + `type`, which is every
      // withdrawal ever made from that batch: editing one request rewrote
      // every other request's movement on the same stock to this quantity.
      // `drawId` names the one row.
      const moved = await tx.stockTransaction.updateMany({
        where: { drawId: id, type: "saleOut" },
        data: { quantity },
      });
      if (moved.count === 0) {
        // A request raised before `drawId` existed. Its movement cannot be
        // told apart from its neighbours' on the same batch, and guessing is
        // what caused the damage, so the edit is refused rather than applied
        // to the wrong row. `pnpm stock:link-movements` attributes the
        // historical movements it can identify unambiguously.
        throw new BusinessError(
          "400",
          "This request predates the stock-movement link, so its quantity cannot be " +
            "corrected safely. Reject it and raise a new one.",
        );
      }
      await tx.centralStockOrderEvent.create({
        data: { orderId: id, action: "edited", comment, fromQuantity: was, toQuantity: quantity, actedBy },
      });
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  /** One request, for a caller that needs to check whose site it belongs to. */
  findOrder(id: string) {
    return this.db.centralStockOrder.findUnique({
      where: { id },
      select: { id: true, siteId: true, status: true, quantity: true, createdBy: true },
    });
  }

  /** The trail: who asked for what, who changed it, and what they said. */
  events(orderId: string) {
    return this.db.centralStockOrderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, action: true, comment: true, fromQuantity: true, toQuantity: true,
        createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }
}
