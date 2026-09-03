import type {
  PlanStatus,
  Prisma,
  PrismaClient,
} from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CreateOrderPlanSchema, CreateOrderSchema } from "./orders.schema.js";

export class OrderRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    const orders = await this.db.order.findMany({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        orderPlanId: true,
        orderCode: true,
        orderDate: true,
        quantity: true,

        item: {
          select: {
            id: true,
            name: true,
            baseUnit: true,
            status: true,
          },
        },

        supplier: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },

        plan: {
          select: {
            id: true,
            name: true,
          },
        },

        createdUser: {
          select: {
            firstName: true,
            lastName: true,
          },
        },

        cargos: {
          select: {
            stocks: {
              where: {
                status: "received",
              },
              select: {
                quantity: true,
              },
            },
          },
        },
      },
    });

    return orders.map((order) => {
      const stock = order.cargos.reduce((total, cargo) => total + cargo.stocks.reduce((sum, stock) => sum + Number(stock.quantity), 0), 0 );

      return {
        ...order,
        remainingStock: Number(order.quantity) - stock,
      stockCargos: stock,
    }});
  }

  async listByPlanOrSupplier(supplierId?: string, planId?: string) {
    const orders = await this.db.order.findMany({
      where: {
        OR: [
          ...(planId ? [{ orderPlanId: planId }] : []),
          ...(supplierId ? [{ supplierId }] : []),
        ],
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        orderPlanId: true,
        orderCode: true,
        orderDate: true,
        quantity: true,
        item: {
          select: {
            name: true,
            baseUnit: true,
            status: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        plan: {
          select: {
            id: true,
            name: true,
          },
        },
        createdUser: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return orders;
  }

  create(data: Prisma.OrderUncheckedCreateInput) {
    return this.db.order.create({
      data: {
        ...data,
      },
    });
  }

  async update(id: string, data: CreateOrderSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.order.update({
      where: { id: id },
      data: data,
    });
  }

  find(id: string) {
    return this.db.order.findUnique({ where: { id } });
  }

  // for Supplier Type

  listOrderPlan() {
    return this.db.orderPlan.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    });
  }

  createOrderPlan(data: CreateOrderPlanSchema) {
    return this.db.orderPlan.create({ data });
  }

  findOrderPlan(id: string) {
    return this.db.orderPlan.findUnique({
      where: { id: id },
      select: { id: true, name: true, status: true },
    });
  }

  async changeOrderPlanStatus(id: string, status: PlanStatus) {
    const type = await this.findOrderPlan(id);
    if (!type) throw new NotFoundError();
    if (type.status !== "active") throw new BusinessError("400", "This Status can not be changed since is not active")
    return await this.db.orderPlan.update({
      where: { id },
      data: { status },
      select: { id: true, status: true, name: true },
    });
  }

  async updateOrderPlan(id: string, data: CreateOrderPlanSchema) {
    if (!(await this.findOrderPlan(id))) throw new NotFoundError();
    return await this.db.orderPlan.update({
      where: {
        id,
      },
      data: {
        name: data.name,
        startDate: data.startDate,
        endDate: data.endDate,
      },
    });
  }
}
