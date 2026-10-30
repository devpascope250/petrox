import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { createShiftSchema, shiftOptionsQuerySchema } from "./shift.schema.js";
import { ShiftService } from "./shift.service.js";
import { ShiftRepository } from "./shift.repository.js";
import { createSiteShiftSchema, siteShiftQuerySchema } from "./site-shift.schema.js";
import { SiteShiftService } from "./site-shift.service.js";
import { SiteShiftRepository } from "./site-shift.repository.js";
import {
  copyPumpAttendantWeekSchema, createPumpAttendantSchema, pumpAttendantQuerySchema, updatePumpAttendantSchema,
} from "./pump-attendant.schema.js";
import { PumpAttendantService } from "./pump-attendant.service.js";
import { PumpAttendantRepository } from "./pump-attendant.repository.js";
import { copyTimeTableWeekSchema, createTimeTableSchema, timeTableQuerySchema, timeTableRoleSchema, timeTableStatusSchema } from "./time-table.schema.js";
import { TimeTableService } from "./time-table.service.js";
import { TimeTableRepository } from "./time-table.repository.js";

/**
 * Shifts and who works them: `/shifts` (each shift's name and hours),
 * `/shifts/sites` (which shifts a site runs), `/shifts/attendants` (who works which pump
 * on which weekday) and `/shifts/time-table` (who is rostered on which date).
 *
 * All share the `shifts.*` permissions. On top of that, a site manager is kept
 * to his own site, and only a super administrator creates or changes shifts.
 */
const routes: FastifyPluginAsync = async (app) => {
  const shifts = new ShiftService(new ShiftRepository(app.prisma), app.config);
  const siteShifts = new SiteShiftService(new SiteShiftRepository(app.prisma), app.config);
  const attendants = new PumpAttendantService(new PumpAttendantRepository(app.prisma), app.config);
  const timeTable = new TimeTableService(new TimeTableRepository(app.prisma), app.config);

  const read = { preHandler: [app.authenticate, app.authorize("shifts.read", "shifts.manage")] };
  const create = { preHandler: [app.authenticate, app.authorize("shifts.create", "shifts.manage")] };
  const edit = { preHandler: [app.authenticate, app.authorize("shifts.edit", "shifts.manage")] };
  const remove = { preHandler: [app.authenticate, app.authorize("shifts.delete", "shifts.manage")] };

  // Everything the forms pick from, for one site.
  app.get("/options", read, async (request) =>
    success(await shifts.options(parseInput(shiftOptionsQuerySchema, request.query), request.contextUser!)));

  /* ---------------------------- Site shifts ---------------------------- */
  app.get("/sites", read, async (request) =>
    success(await siteShifts.list(parseInput(siteShiftQuerySchema, request.query), request.contextUser!)));
  app.get("/sites/:id", read, async (request) =>
    success(await siteShifts.find(parseInput(idParamsSchema, request.params).id, request.contextUser!)));
  app.post("/sites", create, async (request, reply) =>
    created(reply, await siteShifts.create(parseInput(createSiteShiftSchema, request.body), request.contextUser!)));
  app.put("/sites/:id", edit, async (request) =>
    success(await siteShifts.update(
      parseInput(idParamsSchema, request.params).id,
      parseInput(createSiteShiftSchema, request.body),
      request.contextUser!,
    )));
  app.put("/sites/status/:id", edit, async (request) =>
    success(await siteShifts.updateStatus(parseInput(idParamsSchema, request.params).id, request.contextUser!)));

  /* -------------------------- Pump attendants --------------------------
   * Which pump someone works, and its nozzles, **per rostered day**: a row
   * hangs off the time table entry, so the roster stays the one place that
   * says who works when. Creating writes a day each and reports the days the
   * roster does not cover. */
  app.get("/attendants", read, async (request) =>
    success(await attendants.list(parseInput(pumpAttendantQuerySchema, request.query), request.contextUser!)));
  app.get("/attendants/:id", read, async (request) =>
    success(await attendants.find(parseInput(idParamsSchema, request.params).id, request.contextUser!)));
  app.post("/attendants", create, async (request, reply) =>
    created(reply, await attendants.create(parseInput(createPumpAttendantSchema, request.body), request.contextUser!)));
  // One day's assignment: its pump and nozzles. The day and the person belong
  // to the roster row, so another day is another row.
  app.put("/attendants/:id", edit, async (request) =>
    success(await attendants.update(
      parseInput(idParamsSchema, request.params).id,
      parseInput(updatePumpAttendantSchema, request.body),
      request.contextUser!,
    )));
  // This week's rota onto next week's rostered days.
  app.post("/attendants/copy-week", create, async (request) =>
    success(await attendants.copyWeek(parseInput(copyPumpAttendantWeekSchema, request.body), request.contextUser!)));
  app.delete("/attendants/:id", remove, async (request) =>
    success(await attendants.delete(parseInput(idParamsSchema, request.params).id, request.contextUser!)));

  /* ----------------------------- Time table ---------------------------- */
  app.get("/time-table", read, async (request) =>
    success(await timeTable.list(parseInput(timeTableQuerySchema, request.query), request.contextUser!)));
  app.get("/time-table/:id", read, async (request) =>
    success(await timeTable.find(parseInput(idParamsSchema, request.params).id, request.contextUser!)));
  app.post("/time-table", create, async (request, reply) =>
    created(reply, await timeTable.create(parseInput(createTimeTableSchema, request.body), request.contextUser!)));
  // Copies a week of the roster onto the following week.
  app.post("/time-table/copy-week", create, async (request, reply) =>
    created(reply, await timeTable.copyWeek(parseInput(copyTimeTableWeekSchema, request.body), request.contextUser!)));
  app.put("/time-table/:id", edit, async (request) =>
    success(await timeTable.update(
      parseInput(idParamsSchema, request.params).id,
      parseInput(createTimeTableSchema, request.body),
      request.contextUser!,
    )));
  app.put("/time-table/status/:id", edit, async (request) =>
    success(await timeTable.updateStatus(
      parseInput(idParamsSchema, request.params).id,
      parseInput(timeTableStatusSchema, request.body),
      request.contextUser!,
    )));
  // Chief / supporter for the shift on that date; takes it from whoever had it.
  app.put("/time-table/role/:id", edit, async (request) =>
    success(await timeTable.updateRole(
      parseInput(idParamsSchema, request.params).id,
      parseInput(timeTableRoleSchema, request.body),
      request.contextUser!,
    )));
  app.delete("/time-table/:id", remove, async (request) =>
    success(await timeTable.delete(parseInput(idParamsSchema, request.params).id, request.contextUser!)));

  /* ------------------------------ Shifts ------------------------------- */
  // Registered last: `/:id` would otherwise read like the named routes above
  // (Fastify prefers static paths anyway, but this keeps the file readable).
  app.get("/", read, async (request) => success(await shifts.list(request.contextUser!)));
  app.get("/:id", read, async (request) =>
    success(await shifts.find(parseInput(idParamsSchema, request.params).id, request.contextUser!)));
  app.post("/", create, async (request, reply) =>
    created(reply, await shifts.create(parseInput(createShiftSchema, request.body), request.contextUser!)));
  app.put("/:id", edit, async (request) =>
    success(await shifts.update(
      parseInput(idParamsSchema, request.params).id,
      parseInput(createShiftSchema, request.body),
      request.contextUser!,
    )));
  app.put("/status/:id", edit, async (request) =>
    success(await shifts.updateStatus(parseInput(idParamsSchema, request.params).id, request.contextUser!)));
};

export default routes;
