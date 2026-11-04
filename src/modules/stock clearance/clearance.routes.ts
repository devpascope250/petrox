import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { confirmClearancePaymentSchema, createStockClearanceSchema } from "./clearance.schema.js";
import { StockClearanceService } from "./clearance.service.js";
import { StockClearanceRepository } from "./clearance.repository.js";
import { parseClearanceMultipart } from "./clearance-upload.js";
import { clearanceDecisionSchema } from "./authorizers/clearance-authorizer.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new StockClearanceService(
    new StockClearanceRepository(app.prisma), app.config, app.prisma);
  const read = [app.authenticate, app.authorize("stock.clearance.read", "stock.clearance.manage")];

  app.get("/", { preHandler: read }, async (request) =>
    success(await service.list()));

  /*
   * The acts of clearing, which is what is approved and paid for. Listed
   * before `/:id` so "requests" is never read as an id.
   */
  app.get("/requests", { preHandler: read }, async () => success(await service.requests()));

  /**
   * What is waiting on the signed-in authorizer. Only authentication is
   * required: whether they may decide is a matter of being on the authorizer
   * list, not of holding a permission, and the page is reached from a link in
   * their mail.
   */
  app.get("/requests/pending", { preHandler: [app.authenticate] }, async (request) =>
    success(await service.pendingFor(request.contextUser!.userId)));

  /*
   * Readable by whoever may read clearances, and otherwise only by an
   * authorizer — which is how the link in their email works. Without that
   * second door it would need a permission the authorizers may not hold; with
   * only the first it would be readable by anybody signed in.
   */
  app.get("/requests/:id", { preHandler: [app.authenticate] }, async (request) => {
    const user = request.contextUser!;
    const mayRead = ["stock.clearance.read", "stock.clearance.manage"]
      .some((permission) => user.permissions?.includes(permission));
    return success(await service.findRequest(
      parseInput(idParamsSchema, request.params).id,
      mayRead ? undefined : user.userId,
    ));
  });

  app.get("/:id", { preHandler: read }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));

  app.post("/", { preHandler: [app.authenticate, app.authorize("stock.clearance.create", "stock.clearance.manage")] }, async (request, reply) => {
    const fields = await parseClearanceMultipart(request);
    return created(reply, await service.create(parseInput(createStockClearanceSchema, {
      ...fields, clearedBy: request.contextUser?.userId,
    })));
  });

  /** Approving or rejecting: open to the authorizers themselves, nobody else. */
  app.post("/requests/:id/decision", { preHandler: [app.authenticate] }, async (request) =>
    success(await service.decide(
      parseInput(idParamsSchema, request.params).id,
      request.contextUser!.userId,
      parseInput(clearanceDecisionSchema, request.body),
    )));

  /** The payment document, which is what finally clears the stock. */
  app.post("/requests/:id/payment", {
    preHandler: [app.authenticate, app.authorize("stock.clearance.edit", "stock.clearance.manage")],
  }, async (request) => {
    const id = parseInput(idParamsSchema, request.params).id;
    const fields = await parseClearanceMultipart(request);
    const { paymentDocUrl } = parseInput(confirmClearancePaymentSchema, fields);
    return success(await service.confirmPayment(id, request.contextUser!.userId, paymentDocUrl));
  });

  /** Cancelling an unpaid clearance, which is the only thing that releases the litres it holds. */
  app.delete("/requests/:id", {
    preHandler: [app.authenticate, app.authorize("stock.clearance.delete", "stock.clearance.manage")],
  }, async (request) => success(await service.cancel(parseInput(idParamsSchema, request.params).id)));
};

export default routes;
