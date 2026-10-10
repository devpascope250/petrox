import { CentralOrderStatus, Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CentralStockOrderReportQuerySchema, CreateCentralStockOrderSchema, CreateLoadingOrderSchema, LoadingOrderStatusSchema, ReceptionOrdersQuerySchema, ReceiveLoadingOrderSchema } from "./order.schema.js";

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
 * A site manager's view of loads: only the orders **he requested** for his own
 * site. Receptions carry no link to individual order lines, so "received" is
 * what he himself took in against them.
 */
export type RequesterScope = { siteId: string; requesterId: string };

function scopedLines(scope?: RequesterScope): Prisma.LoadedOrderWhereInput | undefined {
  return scope ? { order: { siteId: scope.siteId, createdBy: scope.requesterId } } : undefined;
}

function scopedReceptions(scope?: RequesterScope): Prisma.OrderReceptionWhereInput | undefined {
  return scope ? { receivedBy: scope.requesterId } : undefined;
}

export class CentralStockOrderRepository {
  constructor(private db: PrismaClient) {}

  /**
   * Stockout orders in a period, each with how far it has got: loaded onto a
   * truck, received at its site, and what is still to arrive. `requesterId`
   * narrows the list — and every total — to the orders one person raised.
   */
  async list(query: CentralStockOrderReportQuerySchema & { startDate: Date; endDate: Date; requesterId?: string }) {
    const orders = await this.db.centralStockOrder.findMany({
      orderBy: { createdAt: "desc" },
      where: {
        createdAt: { gte: query.startDate, lte: query.endDate },
        ...(query.requesterId && { createdBy: query.requesterId }),
        ...(query.itemId && { centralStock: { itemId: query.itemId } }),
        ...(query.siteId && { siteId: query.siteId }),
        ...(query.status && { status: query.status }),
        ...(query.orderType && { orderType: query.orderType }),
      },
      select: {
        id: true, quantity: true, unitPrice: true, totalPrice: true, orderType: true,
        status: true, approvedAt: true, createdAt: true, updatedAt: true, createdBy: true,
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
            orderReceptions: { select: { receivedQty: true, receivedBy: true } },
            loadedOrders: { orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: { id: true, quantity: true, order: { select: { createdBy: true } } } },
          } },
        } },
      },
    });

    /*
     * A reception is recorded against a load, not against one order on it. The
     * person who requested an order is the one who receives it, so what someone
     * took in on a load is spread across their own lines on that load, oldest
     * first. That gives each order its received figure.
     */
    const receivedByLine = new Map<string, number>();
    for (const order of orders) {
      for (const line of order.loadedOrders) {
        const load = line.loadingOrder;
        if (receivedByLine.has(line.id)) continue;
        const requester = order.createdBy;
        let pool = load.orderReceptions
          .filter((reception) => reception.receivedBy === requester)
          .reduce((sum, reception) => sum + Number(reception.receivedQty), 0);
        for (const sibling of load.loadedOrders.filter((row) => row.order.createdBy === requester)) {
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
      const { createdBy: _createdBy, ...rest } = order;
      return {
        ...rest, quantity, unitPrice, totalPrice,
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

  /**
   * Every loading order, or — for a site manager — only the loads carrying
   * orders he requested, narrowed to those orders and his own receptions.
   */
  async listLoadingOrders(scope?: RequesterScope) {
    const loads = await this.db.loadingOrder.findMany({
      where: scope ? { loadedOrders: { some: scopedLines(scope) } } : undefined,
      orderBy: { createdAt: "desc" },
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
    });
    return loads.map((load) => ({
      ...load,
      ...receptionProgress(load.loadedOrders, load.orderReceptions),
      orderReceptions: load.orderReceptions.map((reception) => ({
        ...reception,
        expectedQty: Number(reception.expectedQty),
        receivedQty: Number(reception.receivedQty),
      })),
    }));
  }

  async listReceptionOrders(query: ReceptionOrdersQuerySchema, scope?: RequesterScope) {
    const where: Prisma.LoadingOrderWhereInput = {
      // A site manager: only loads carrying orders he requested. Anyone else
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

  /** A site manager takes in the orders he requested, into a tank at his site. */
  receiveLoadingOrder(loadingOrderId: string, input: ReceiveLoadingOrderSchema, scope: RequesterScope) {
    const { siteId, requesterId: userId } = scope;
    return this.db.$transaction(async (tx) => {
      const loadingOrder = await tx.loadingOrder.findFirst({
        where: { id: loadingOrderId, loadedOrders: { some: scopedLines(scope) } },
        select: {
          id: true, totalQuantity: true, status: true, authorizationStatus: true, driverVehicleId: true,
          loadedOrders: { where: scopedLines(scope), select: {
            quantity: true,
            order: { select: { siteId: true, centralStock: { select: { itemId: true } } } },
          } },
          orderReceptions: { select: { receivedQty: true, receivedBy: true } },
        },
      });
      if (!loadingOrder) throw new NotFoundError("Loading order carrying orders you requested");
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

      // What he has already taken in against his own orders on this load.
      const received = loadingOrder.orderReceptions.filter((reception) => reception.receivedBy === userId).reduce(
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

  createLoadingOrders(input: CreateLoadingOrderSchema) {
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
      const requestedLoad = input.orders.reduce((sum, order) => sum + order.quantity, 0);
      const tankCapacity = Number(driverVehicle.vechile.tankCapacity);
      if (currentVehicleLoad + requestedLoad > tankCapacity) {
        throw new BusinessError("400",
          `Vehicle capacity is ${tankCapacity}; ${currentVehicleLoad} is already assigned and ${requestedLoad} was requested`);
      }

      const orderIds = input.orders.map((order) => order.orderId);
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
      for (const requested of input.orders) {
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
          loadedOrders: { create: input.orders.map((order) => ({
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
        await tx.stockTransaction.create({ data: { centralStockId: allocation.centralStockId,
          quantity: allocation.quantity, type: "saleOut", createdBy: input.createdBy } });
        orders.push(order);
      }
      return orders;
    }, { isolationLevel: "Serializable" });
  }


  async changeOrderStatus(id: string, status: CentralOrderStatus) {
    // existances
    const order = await this.db.centralStockOrder.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundError("Central stock order not found");
    }

    // if existed is not pending 
    if (order.status !== "pending") {
      throw new BusinessError("400", "Only pending orders can be updated");
    }
    return await this.db.centralStockOrder.update({ where: { id }, data: { status } });
  }
}
