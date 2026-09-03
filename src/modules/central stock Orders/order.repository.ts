import { CentralOrderStatus, Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CentralStockOrderReportQuerySchema, CreateCentralStockOrderSchema, CreateLoadingOrderSchema, LoadingOrderStatusSchema, ReceptionOrdersQuerySchema, ReceiveLoadingOrderSchema } from "./order.schema.js";

export class CentralStockOrderRepository {
  constructor(private db: PrismaClient) {}

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
        status: true, approvedAt: true, createdAt: true, updatedAt: true,
        site: { select: { id: true, name: true, phone: true, email: true, address: true, status: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        approvedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        clearance: { select: {
          id: true, quantity: true, status: true, fees: true, amount: true,
          supportingDocUrl: true, dmsDocUrl: true, createdAt: true,
          agent: { select: { id: true, names: true, fees: true, status: true } },
        } },
        centralStock: { select: {
          id: true, quantity: true, status: true, createdAt: true,
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
          } },
        } },
      },
    });

    const summary = {
      orderCount: orders.length,
      totalQuantity: 0,
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
      summary.totalQuantity += quantity;
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
        clearance: { ...order.clearance, quantity: Number(order.clearance.quantity),
          fees: order.clearance.fees === null ? null : Number(order.clearance.fees),
          amount: order.clearance.amount === null ? null : Number(order.clearance.amount),
          agent: order.clearance.agent ? { ...order.clearance.agent, fees: Number(order.clearance.agent.fees) } : null },
        centralStock: { ...order.centralStock, quantity: Number(order.centralStock.quantity) },
        loadedOrders: order.loadedOrders.map((loadedOrder) => ({
          ...loadedOrder, quantity: Number(loadedOrder.quantity),
          loadingOrder: { ...loadedOrder.loadingOrder,
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

  listLoadingOrders() {
    return this.db.loadingOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        loadedOrders: { include: { order: {
          include: { centralStock: { include: { item: true } }, site: true },
        } } },
        dVehicle: { include: { driver: true, vechile: true } },
        authorizers: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });
  }

  async listReceptionOrders(query: ReceptionOrdersQuerySchema, siteId?: string) {
    const effectiveSiteId = siteId ?? query.siteId;
    const where: Prisma.LoadingOrderWhereInput = {
      ...(effectiveSiteId ? { loadedOrders: { some: { order: { siteId: effectiveSiteId } } } } : {}),
      ...(query.receptionStatus === "notReceived" ? { orderReceptions: { none: {} } } : {}),
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
          loadedOrders: { select: {
            id: true, quantity: true,
            order: { select: {
              id: true, siteId: true, quantity: true, orderType: true, status: true,
              site: { select: { id: true, name: true } },
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
            orderBy: { createdAt: "asc" },
            select: {
              id: true, expectedQty: true, receivedQty: true, status: true, createdAt: true,
              cuve: { select: { id: true, name: true, siteId: true } },
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.db.loadingOrder.count({ where }),
    ]);

    return [orders.map((order) => {
      const expectedQuantity = Number(order.totalQuantity);
      const receivedQuantity = order.orderReceptions.reduce(
        (sum, reception) => sum + Number(reception.receivedQty), 0);
      return {
        ...order,
        totalQuantity: expectedQuantity,
        receivedQuantity,
        remainingQuantity: Math.max(0, expectedQuantity - receivedQuantity),
        receptionStatus: receivedQuantity === 0
          ? "notReceived"
          : receivedQuantity >= expectedQuantity ? "received" : "partiallyReceived",
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

  receiveLoadingOrder(loadingOrderId: string, input: ReceiveLoadingOrderSchema, siteId: string, userId: string) {
    return this.db.$transaction(async (tx) => {
      const loadingOrder = await tx.loadingOrder.findFirst({
        where: { id: loadingOrderId, loadedOrders: { some: { order: { siteId } } } },
        select: {
          id: true, totalQuantity: true, status: true, authorizationStatus: true, driverVehicleId: true,
          loadedOrders: { select: {
            order: { select: { siteId: true, centralStock: { select: { itemId: true } } } },
          } },
          orderReceptions: { select: { receivedQty: true } },
        },
      });
      if (!loadingOrder) throw new NotFoundError("Loading order for this site");
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
        select: { id: true, itemId: true, maximum: true,
          orderReceptions: { select: { receivedQty: true } } },
      });
      if (!cuve) throw new NotFoundError("Active cuve for this site");
      if (loadingOrder.loadedOrders.some(({ order }) => order.siteId !== siteId)) {
        throw new BusinessError("LOADING_ORDER_SITE_MISMATCH", "All orders in a loading order must belong to this site");
      }
      const itemIds = new Set(loadingOrder.loadedOrders.map(({ order }) => order.centralStock.itemId));
      if (itemIds.size !== 1 || !itemIds.has(cuve.itemId)) {
        throw new BusinessError("CUVE_ITEM_MISMATCH", "The cuve item does not match the loading-order item");
      }

      const received = loadingOrder.orderReceptions.reduce(
        (sum, reception) => sum.plus(reception.receivedQty), new Prisma.Decimal(0));
      const quantity = new Prisma.Decimal(input.receivedQty);
      const expected = loadingOrder.totalQuantity;
      if (received.plus(quantity).greaterThan(expected)) {
        throw new BusinessError("RECEPTION_QUANTITY_EXCEEDED", `Only ${expected.minus(received).toString()} remains to receive`);
      }
      const cuveQuantity = cuve.orderReceptions.reduce(
        (sum, reception) => sum.plus(reception.receivedQty), new Prisma.Decimal(0));
      if (cuveQuantity.plus(quantity).greaterThan(cuve.maximum)) {
        throw new BusinessError("CUVE_CAPACITY_EXCEEDED", `Cuve has capacity for only ${cuve.maximum.minus(cuveQuantity).toString()}`);
      }

      const fullyReceived = received.plus(quantity).equals(expected);
      const reception = await tx.orderReception.create({
        data: {
          loadingOrderId,
          cuveId: cuve.id,
          expectedQty: expected,
          receivedQty: quantity,
          receivedBy: userId,
          status: "received",
        },
        include: {
          cuve: { select: { id: true, name: true, siteId: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
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
        select: { id: true, quantity: true,
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
            Number(stock.quantity) - allocated,
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
