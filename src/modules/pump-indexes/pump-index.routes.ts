import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { PumpIndexRepository } from "./pump-index.repository.js";
import {
  createPumpIndexSchema, pumpIndexListQuerySchema, pumpIndexOpeningQuerySchema,
  pumpIndexRosterQuerySchema, updatePumpIndexSchema,
} from "./pump-index.schema.js";
import { PumpIndexService } from "./pump-index.service.js";

/**
 * A nozzle's meter at the open and close of a shift: `/pump-indexes`, guarded
 * by the "Pump Index" module (`pump.index.*`).
 *
 * **There is no delete.** A reading is part of a chain — the next one opens
 * where it closed — so removing one would leave the figures after it resting
 * on nothing. A mistake is corrected while the reading is still unapproved, or
 * else by the next reading.
 *
 * Approving is gated on `pump.index.manage` rather than `edit`: it is the act
 * that freezes a reading for good, so it is held apart from recording one.
 *
 * A reading is always recorded against the attendant the time table put on
 * that shift that day, on a pump and nozzle the rota gives them. `/roster`
 * answers all of that at once, and there is no path that skips it: a shift
 * nobody was rostered on cannot be recorded until the time table is filled in.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new PumpIndexService(new PumpIndexRepository(app.prisma));
  const id = (params: unknown) => parseInput(idParamsSchema, params).id;
  const read = app.authorize("pump.index.read", "pump.index.manage");

  app.get("/", { preHandler: [app.authenticate, read] }, async (request) =>
    success(await service.list(parseInput(pumpIndexListQuerySchema, request.query), request.contextUser!)));

  // Who was on a shift that day, with their pumps and nozzles: the recording
  // form's whole cascade in one answer. Before `/:id`, as `/opening` is.
  app.get("/roster", { preHandler: [app.authenticate, read] }, async (request) =>
    success(await service.roster(parseInput(pumpIndexRosterQuerySchema, request.query), request.contextUser!)));

  // What a new reading on a nozzle opens at — before `/:id`, which would
  // otherwise take "opening" for an id.
  app.get("/opening", { preHandler: [app.authenticate, read] }, async (request) =>
    success(await service.opening(parseInput(pumpIndexOpeningQuerySchema, request.query), request.contextUser!)));

  app.get("/:id", { preHandler: [app.authenticate, read] }, async (request) =>
    success(await service.find(id(request.params), request.contextUser!)));

  app.post("/", { preHandler: [app.authenticate, app.authorize("pump.index.create", "pump.index.manage")] },
    async (request, reply) =>
      created(reply, await service.create(parseInput(createPumpIndexSchema, request.body), request.contextUser!)));

  // Only while the reading is unapproved, and only the last one on its nozzle.
  app.put("/:id", { preHandler: [app.authenticate, app.authorize("pump.index.edit", "pump.index.manage")] },
    async (request) =>
      success(await service.update(id(request.params), parseInput(updatePumpIndexSchema, request.body), request.contextUser!)));

  app.patch("/:id/approve", { preHandler: [app.authenticate, app.authorize("pump.index.manage")] }, async (request) =>
    success(await service.approve(id(request.params), request.contextUser!)));
};

export default routes;
