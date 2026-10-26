import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError, forbidden } from "../../utils/errors.js";
import type { AuthorizerSchema } from "./authorizer.schema.js";

export class AuthorizerRepository {
  constructor(private db: PrismaClient) {}

  list() {
    return this.db.authorizers.findMany({ orderBy: [{ type: "asc" }, { levels: "asc" }], include: { role: true } });
  }

  find(id: string) {
    return this.db.authorizers.findUnique({ where: { id }, include: { role: true } });
  }

  async create(data: AuthorizerSchema) {
    await this.validateRole(data.roleId);
    const existing = await this.db.authorizers.findUnique({
      where: { type_roleId: { type: data.type, roleId: data.roleId } },
    });
    if (existing) throw new BusinessError("400", "This role is already an authorizer for this type");
    return this.db.authorizers.create({ data, include: { role: true } });
  }

  async update(id: string, data: AuthorizerSchema) {
    const current = await this.db.authorizers.findUnique({
      where: { id }, select: { type: true, roleId: true, _count: { select: { approvals: true } } },
    });
    if (!current) throw new NotFoundError("Authorizer");
    if (current._count.approvals > 0 && (current.roleId !== data.roleId || current.type !== data.type)) {
      throw new BusinessError("400", "Role and type cannot change after this authorizer has approvals");
    }
    await this.validateRole(data.roleId);
    return this.db.authorizers.update({ where: { id }, data, include: { role: true } });
  }

  async changeStatus(id: string) {
    const authorizer = await this.find(id);
    if (!authorizer) throw new NotFoundError("Authorizer");
    return this.db.authorizers.update({
      where: { id }, data: { status: authorizer.status === "active" ? "inactive" : "active" },
      include: { role: true },
    });
  }

  async delete(id: string) {
    const authorizer = await this.db.authorizers.findUnique({
      where: { id }, select: { _count: { select: { approvals: true } } },
    });
    if (!authorizer) throw new NotFoundError("Authorizer");
    if (authorizer._count.approvals > 0) {
      throw new BusinessError("400", "An authorizer with approval history cannot be deleted; deactivate it instead");
    }
    return this.db.authorizers.delete({ where: { id } });
  }

  async pendingForRole(roleId: string, userId: string) {
    const configuration = await this.db.authorizers.findUnique({
      where: { type_roleId: { type: "LOADING_ORDER", roleId } }, include: { role: true },
    });
    if (!configuration || configuration.status !== "active") return { configuration: null, orders: [] };
    const lowerAuthorizers = await this.db.authorizers.findMany({
      where: { type: "LOADING_ORDER", status: "active", levels: { lt: configuration.levels } },
      select: { id: true },
    });
    const candidates = await this.db.loadingOrder.findMany({
      where: {
        status: "pending", authorizationStatus: "pending",
        authorizers: { none: { OR: [{ userId }, { authorizerId: configuration.id }] } },
      },
      orderBy: { createdAt: "asc" },
      include: {
        loadedOrders: { include: { order: {
          include: { site: true, centralStock: { include: { item: true, deport: true } } },
        } } },
        dVehicle: { include: { driver: true, vechile: true } },
        authorizers: { include: { authorizer: { include: { role: true } },
          user: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });
    const lowerIds = lowerAuthorizers.map((authorizer) => authorizer.id);
    const orders = candidates.filter((loadingOrder) =>
      lowerIds.every((id) => loadingOrder.authorizers.some((approval) => approval.authorizerId === id)))
      .map((loadingOrder) => ({
        ...loadingOrder,
        totalQuantity: Number(loadingOrder.totalQuantity),
        approvalProgress: {
          approved: loadingOrder.authorizers.length,
          required: loadingOrder.authoriserCount,
          currentLevel: configuration.levels,
        },
        dVehicle: { ...loadingOrder.dVehicle,
          vechile: { ...loadingOrder.dVehicle.vechile,
            tankCapacity: Number(loadingOrder.dVehicle.vechile.tankCapacity) } },
        loadedOrders: loadingOrder.loadedOrders.map((loadedOrder) => ({
          ...loadedOrder,
          quantity: Number(loadedOrder.quantity),
          order: { ...loadedOrder.order, quantity: Number(loadedOrder.order.quantity),
            unitPrice: Number(loadedOrder.order.unitPrice), 
            totalPrice: Number(loadedOrder.order.totalPrice),
            centralStock: { ...loadedOrder.order.centralStock,
              quantity: Number(loadedOrder.order.centralStock.quantityAt20C) } },
        })),
      }));
    return { configuration, orders };
  }

  approveLoadingOrder(loadingOrderId: string, roleId: string, userId: string) {
    return this.db.$transaction(async (tx) => {
      const configuration = await tx.authorizers.findUnique({
        where: { type_roleId: { type: "LOADING_ORDER", roleId } },
      });
      if (!configuration || configuration.status !== "active") {
        throw forbidden("Your role is not configured to authorize loading orders");
      }
      const loadingOrder = await tx.loadingOrder.findUnique({
        where: { id: loadingOrderId },
        include: { authorizers: true },
      });
      if (!loadingOrder) throw new NotFoundError("Loading order");
      if (loadingOrder.status !== "pending" || loadingOrder.authorizationStatus !== "pending") {
        throw new BusinessError("400", "Loading order is not pending authorization");
      }
      if (loadingOrder.authorizers.some((approval) => approval.userId === userId)) {
        throw new BusinessError("400", "You have already authorized this loading order");
      }
      if (loadingOrder.authorizers.some((approval) => approval.authorizerId === configuration.id)) {
        throw new BusinessError("400", "This authorizer role has already approved the loading order");
      }
      const lowerAuthorizers = await tx.authorizers.findMany({
        where: { type: "LOADING_ORDER", status: "active", levels: { lt: configuration.levels } },
        select: { id: true },
      });
      const missingLowerLevel = lowerAuthorizers.some((required) =>
        !loadingOrder.authorizers.some((approval) => approval.authorizerId === required.id));
      if (missingLowerLevel) throw new BusinessError("400", "A lower authorization level must approve first");

      /*
       * The signature is copied onto the approval, with the name it was given
       * under. A document already signed must not change because someone later
       * replaced their signature image — and without one there is nothing to
       * stamp on the document, so approving is refused rather than producing a
       * document with a blank where a signature belongs.
       */
      const signer = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { firstName: true, lastName: true, signatureUrl: true },
      });
      if (!signer.signatureUrl) {
        throw new BusinessError(
          "SIGNATURE_MISSING",
          "Add your signature to your profile before authorizing a loading order",
        );
      }

      const approval = await tx.loadingOrderAuthorizer.create({
        data: {
          loadingOrderId,
          userId,
          authorizerId: configuration.id,
          signatureUrl: signer.signatureUrl,
          signedName: `${signer.firstName} ${signer.lastName}`.trim(),
        },
        include: { user: { select: { id: true, firstName: true, lastName: true } },
          authorizer: { include: { role: true } } },
      });
      const approvedCount = loadingOrder.authorizers.length + 1;
      const requiredCount = await tx.authorizers.count({
        where: { type: "LOADING_ORDER", status: "active" },
      });
      const updated = approvedCount >= requiredCount
        ? await tx.loadingOrder.update({ where: { id: loadingOrderId },
            data: { authorizationStatus: "approved", authoriserCount: requiredCount } })
        : await tx.loadingOrder.update({ where: { id: loadingOrderId },
            data: { authoriserCount: requiredCount } });
      return { approval, authorizationStatus: updated.authorizationStatus,
        approvalProgress: { approved: approvedCount, required: requiredCount } };
    }, { isolationLevel: "Serializable" });
  }

  private async validateRole(roleId: string) {
    const role = await this.db.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundError("Role");
    if (!role.isActive) throw new BusinessError("400", "Inactive roles cannot be authorizers");
  }
}
