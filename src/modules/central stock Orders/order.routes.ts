import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { CentralStockOrderService } from "./order.service.js";
import { CentralStockOrderRepository } from "./order.repository.js";
import { CentralStockOrderParamaSchema, centralStockOrderReportQuerySchema, createCentralStockOrderSchema, createLoadingOrderSchema, loadingOrderStatusSchema, receiveLoadingOrderSchema, receptionOrdersQuerySchema } from "./order.schema.js";
import { shareLoadingOrderSchema } from "./loading-order-share.js";
import { editOrderQuantitySchema, requestOrderEditSchema } from "./order.schema.js";
import { AuthorizerRepository } from "./authorizer.repository.js";
import { AuthorizerService } from "./authorizer.service.js";
import { authorizerSchema } from "./authorizer.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new CentralStockOrderService(new CentralStockOrderRepository(app.prisma), app.config);
  const authorizerService = new AuthorizerService(new AuthorizerRepository(app.prisma));
  app.get("/", { preHandler: [app.authenticate, app.authorize("stockout.orders.read", "stockout.orders.manage")] }, async (request) =>
    success(await service.list(parseInput(centralStockOrderReportQuerySchema, request.query), request.contextUser!)));
  app.get("/loading-orders", { preHandler: [app.authenticate, app.authorize("stockout.orders.read", "stockout.orders.manage")] }, async (request) =>
    success(await service.listLoadingOrders(request.contextUser!)));
  app.post("/loading-orders", { preHandler: [app.authenticate, app.authorize("stockout.orders.create", "stockout.orders.manage")] }, async (request, reply) =>
    created(reply, await service.createLoadingOrders(parseInput(createLoadingOrderSchema, request.body))));
  /**
   * The loading order as a PDF. Signatures appear on it once every authoriser
   * has approved — a half-signed order is a working paper, not an instruction
   * to load.
   */
  app.get("/loading-orders/:id/document", { preHandler: [app.authenticate, app.authorize("stockout.orders.read", "stockout.orders.manage")] },
    async (request, reply) => {
      const { pdf, fileName } = await service.loadingOrderDocument(
        parseInput(idParamsSchema, request.params).id,
      );
      return reply
        .header("Content-Type", "application/pdf")
        // `attachment`, so a click downloads the file rather than opening a
        // tab the browser then has to be told to save.
        .header("Content-Disposition", `attachment; filename="${fileName}"`)
        .send(pdf);
    });

  /** Emails the authorised document to whoever is named. */
  app.post("/loading-orders/:id/share", { preHandler: [app.authenticate, app.authorize("stockout.orders.read", "stockout.orders.manage")] },
    async (request, reply) =>
      created(reply, await service.shareLoadingOrder(
        parseInput(idParamsSchema, request.params).id,
        parseInput(shareLoadingOrderSchema, request.body),
        request.contextUser!,
      )));

  /** Who it has already been sent to, and whether it arrived. */
  app.get("/loading-orders/:id/shares", { preHandler: [app.authenticate, app.authorize("stockout.orders.read", "stockout.orders.manage")] },
    async (request) =>
      success(await service.loadingOrderShares(parseInput(idParamsSchema, request.params).id)));

  app.patch("/loading-orders/:id/status", { preHandler: [app.authenticate, app.authorize("stockout.orders.edit", "stockout.orders.manage")] }, async (request) =>
    success(await service.updateLoadingOrderStatus(
      parseInput(idParamsSchema, request.params).id,
      parseInput(loadingOrderStatusSchema, request.body),
    )));
  app.get("/reception-orders", { preHandler: [app.authenticate, app.authorize("stockout.orders.read", "stockout.orders.manage")] }, async (request) =>
    success(await service.listReceptionOrders(
      parseInput(receptionOrdersQuerySchema, request.query),
      request.contextUser!,
    )));
  // Receiving is a site manager's job, checked by position in the service, so
  // seeing the orders is enough: the edit permission would also open status changes.
  app.post("/reception-orders/:id/receive", { preHandler: [app.authenticate, app.authorize("stockout.orders.read", "stockout.orders.manage")] }, async (request, reply) =>
    created(reply, await service.receiveLoadingOrder(
      parseInput(idParamsSchema, request.params).id,
      parseInput(receiveLoadingOrderSchema, request.body),
      request.contextUser!,
    )));
  app.get("/loading-order-authorizations/pending", { preHandler: [app.authenticate] }, async (request) =>
    success(await authorizerService.pendingForRole(
      request.contextUser!.roleId,
      request.contextUser!.userId,
    )));
  app.post("/loading-order-authorizations/:id/approve", { preHandler: [app.authenticate] }, async (request) =>
    success(await authorizerService.approveLoadingOrder(
      parseInput(idParamsSchema, request.params).id,
      request.contextUser!.roleId,
      request.contextUser!.userId,
    )));

  app.get("/authorizers", { preHandler: [app.authenticate, app.authorize("authorizers.read", "authorizers.manage")] }, async () =>
    success(await authorizerService.list()));
  app.get("/authorizers/:id", { preHandler: [app.authenticate, app.authorize("authorizers.read", "authorizers.manage")] }, async (request) =>
    success(await authorizerService.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/authorizers", { preHandler: [app.authenticate, app.authorize("stockout.orders.create", "authorizers.manage")] }, async (request, reply) =>
    created(reply, await authorizerService.create(parseInput(authorizerSchema, request.body))));
  app.put("/authorizers/:id", { preHandler: [app.authenticate, app.authorize("authorizers.edit", "authorizers.manage")] }, async (request) =>
    success(await authorizerService.update(
      parseInput(idParamsSchema, request.params).id,
      parseInput(authorizerSchema, request.body),
    )));
  app.patch("/authorizers/:id/status", { preHandler: [app.authenticate, app.authorize("authorizers.edit", "authorizers.manage")] }, async (request) =>
    success(await authorizerService.changeStatus(parseInput(idParamsSchema, request.params).id)));
  app.delete("/authorizers/:id", { preHandler: [app.authenticate, app.authorize("authorizers.delete", "authorizers.manage")] }, async (request) =>
    success(await authorizerService.delete(parseInput(idParamsSchema, request.params).id)));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("authorizers.read", "authorizers.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("stockout.orders.create", "authorizers.manage")] }, async (request, reply) => {
    const actor = request.contextUser!;
    // Site staff never pick the site or the outcome: see `siteOrderFields`.
    const payload = {
      ...(request.body as object),
      createdBy: actor.userId,
      ...service.siteOrderFields(actor),
    };
    return created(reply, await service.create(parseInput(createCentralStockOrderSchema, payload)))
  }
    );

    /**
     * Sent back to the site to change the quantity. Head office's decision,
     * like approving — the difference is that the request stays alive.
     */
    app.patch("/:id/request-edit", { preHandler: [app.authenticate, app.authorize("stockout.orders.edit", "stockout.orders.manage")] }, async (request) =>
      success(await service.requestEdit(
        parseInput(idParamsSchema, request.params).id,
        parseInput(requestOrderEditSchema, request.body),
        request.contextUser!,
      )));

    /**
     * The site's new quantity, allowed only while the request is open for
     * changes. Saving hands it back for a decision.
     */
    app.patch("/:id/quantity", { preHandler: [app.authenticate, app.authorize("stockout.orders.create", "stockout.orders.manage")] }, async (request) =>
      success(await service.editQuantity(
        parseInput(idParamsSchema, request.params).id,
        parseInput(editOrderQuantitySchema, request.body),
        request.contextUser!,
      )));

    /** Who asked for what, who changed it, and what they said. */
    app.get("/:id/events", { preHandler: [app.authenticate, app.authorize("stockout.orders.read", "stockout.orders.manage")] }, async (request) =>
      success(await service.events(parseInput(idParamsSchema, request.params).id)));

    // Approving or cancelling an order is head office's decision, never the site's.
    app.put("/:id/status/:status", { preHandler: [app.authenticate, app.authorize("stockout.orders.edit", "stockout.orders.manage")] }, async (request) =>
    success(await service.changeOrderStatus(
      parseInput(CentralStockOrderParamaSchema, request.params).id,
      parseInput(CentralStockOrderParamaSchema, request.params).status,
      request.contextUser!,
    )));
};

export default routes;
