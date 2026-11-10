import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { RequisitionRepository } from "./requisition.repository.js";
import { RequisitionService } from "./requisition.service.js";
import {
  acceptRequisitionSchema,
  createRequisitionSchema,
  editRequisitionSchema,
  requisitionListQuerySchema,
  requisitionReasonSchema,
} from "./requisition.schema.js";

/**
 * Requisitions: a station's ask, and head office's decision on it.
 *
 * `requisitions.approve` is held apart from `requisitions.edit` on purpose —
 * accepting a station's request is not the same authority as correcting one.
 * A station holds `create` and nothing else, and the service pins it to its own
 * station whatever a request asks for.
 *
 * There is no delete: a requisition is withdrawn, refused or served, and each
 * of those is a rung on its ladder with a reason attached.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new RequisitionService(new RequisitionRepository(app.prisma));

  app.get("/", { preHandler: [app.authenticate, app.authorize("requisitions.read", "requisitions.manage")] },
    async (request) => success(await service.list(
      parseInput(requisitionListQuerySchema, request.query), request.contextUser!)));

  /** The seeded ladder, so a client draws the stepper from the same source. */
  app.get("/steps", { preHandler: [app.authenticate, app.authorize("requisitions.read", "requisitions.manage")] },
    async () => success(await service.steps()));

  app.get("/:id", { preHandler: [app.authenticate, app.authorize("requisitions.read", "requisitions.manage")] },
    async (request) => success(await service.find(
      parseInput(idParamsSchema, request.params).id, request.contextUser!)));

  /** Who asked for what, who moved it, and what they said. */
  app.get("/:id/timeline", { preHandler: [app.authenticate, app.authorize("requisitions.read", "requisitions.manage")] },
    async (request) => success(await service.timeline(
      parseInput(idParamsSchema, request.params).id, request.contextUser!)));

  /**
   * What the cleared stock can still serve, per product. The same calculation
   * accepting applies, so a decision cannot contradict what was shown.
   */
  app.get("/:id/availability", { preHandler: [app.authenticate, app.authorize("requisitions.read", "requisitions.manage")] },
    async (request) => success(await service.availability(
      parseInput(idParamsSchema, request.params).id, request.contextUser!)));

  /** The loads carrying it, with how far their authorization has got. */
  app.get("/:id/loads", { preHandler: [app.authenticate, app.authorize("requisitions.read", "requisitions.manage")] },
    async (request) => success(await service.loads(
      parseInput(idParamsSchema, request.params).id, request.contextUser!)));

  app.post("/", { preHandler: [app.authenticate, app.authorize("requisitions.create", "requisitions.manage")] },
    async (request, reply) => created(reply, await service.create(
      parseInput(createRequisitionSchema, request.body), request.contextUser!)));

  app.patch("/:id/accept", { preHandler: [app.authenticate, app.authorize("requisitions.approve", "requisitions.manage")] },
    async (request) => success(await service.accept(
      parseInput(idParamsSchema, request.params).id,
      parseInput(acceptRequisitionSchema, request.body ?? {}),
      request.contextUser!)));

  app.patch("/:id/reject", { preHandler: [app.authenticate, app.authorize("requisitions.approve", "requisitions.manage")] },
    async (request) => success(await service.reject(
      parseInput(idParamsSchema, request.params).id,
      parseInput(requisitionReasonSchema, request.body).comment,
      request.contextUser!)));

  /**
   * Sent back to the station to change a quantity. Head office's decision, like
   * accepting — the difference is that the request stays alive.
   */
  app.patch("/:id/request-change", { preHandler: [app.authenticate, app.authorize("requisitions.approve", "requisitions.manage")] },
    async (request) => success(await service.requestChange(
      parseInput(idParamsSchema, request.params).id,
      parseInput(requisitionReasonSchema, request.body).comment,
      request.contextUser!)));

  /** The station's new figures, allowed only while it was handed back. */
  app.patch("/:id/lines", { preHandler: [app.authenticate, app.authorize("requisitions.create", "requisitions.edit", "requisitions.manage")] },
    async (request) => success(await service.edit(
      parseInput(idParamsSchema, request.params).id,
      parseInput(editRequisitionSchema, request.body),
      request.contextUser!)));

  app.patch("/:id/cancel", { preHandler: [app.authenticate, app.authorize("requisitions.create", "requisitions.edit", "requisitions.manage")] },
    async (request) => success(await service.cancel(
      parseInput(idParamsSchema, request.params).id,
      parseInput(requisitionReasonSchema, request.body).comment,
      request.contextUser!)));
};

export default routes;
