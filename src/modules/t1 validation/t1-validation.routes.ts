import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import {
  cargoReceivedDatePamasSchema,
  cargoStatusPamasSchema,
  cuidParamsSchema,
  pagedDatesQuerySchema,
  id2ParamsSchema,
  idParamsSchema,
  parseInput,
  t1ExtraStatusPamasSchema,
} from "../../shared/validation/index.js";
import { T1RaiseService, T1ValidationSrvice } from "./t1-validation.service.js";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { T1RaiseRepository, T1ValidationRepository } from "./t1-validation.repository.js";
import {
  createT1ValidationsSchema, t1ListQuerySchema,
  t1RaiseOrdersQuerySchema, t1RaiseTripsQuerySchema, t1RaiseVehiclesQuerySchema,
} from "./t1-validation.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new T1ValidationSrvice(new T1ValidationRepository(app.prisma), app.config);
  const raise = new T1RaiseService(new T1RaiseRepository(app.prisma));

  /*
   * Finding the trip a customs document belongs to: order → truck → trip.
   *
   * Registered before `/:id`, or Fastify would read "raise" as an id. Gated on
   * the T1 **create** permission as well as read: these exist to raise one, and
   * somebody who may raise a T1 must be able to find its trip even where the
   * nominations list is not theirs to see.
   */
  const canFind = {
    preHandler: [
      app.authenticate,
      app.authorize("t1.validation.create", "t1.validation.read", "t1.validation.manage"),
    ],
  };
  app.get("/raise/orders", canFind, async (request) =>
    success(await raise.orders(parseInput(t1RaiseOrdersQuerySchema, request.query))));
  app.get("/raise/vehicles", canFind, async (request) =>
    success(await raise.vehicles(parseInput(t1RaiseVehiclesQuerySchema, request.query))));
  app.get("/raise/trips", canFind, async (request) =>
    success(await raise.trips(parseInput(t1RaiseTripsQuerySchema, request.query))));
  app.get(
    "/",
    {
      preHandler: [
        app.authenticate,
        app.authorize("t1.validation.read", "t1.validation.manage"),
      ],
    },
    async (request) => success(await service.list(parseInput(t1ListQuerySchema, request.query))),
  );

    app.get(
    "/confirmed/validations",
    {
      preHandler: [
        app.authenticate,
        app.authorize("t1.validation.read", "t1.validation.manage"),
      ],
    },
    async () => success(await service.listByCompleted()),
  );
  app.get(
    "/:id",
    {
      preHandler: [
        app.authenticate,
        app.authorize("t1.validation.read", "t1.validation.manage"),
      ],
    },
    async (request) =>
      success(
        await service.find(parseInput(idParamsSchema, request.params).id),
      ),
  );

  app.post(
    "/",
    {
      preHandler: [
        app.authenticate,
        app.authorize("t1.validation.create", "t1.validation.manage"),
      ],
    },
    async (request, reply) => {
      const fields: Record<string, unknown> = {};

      let uploadedFile:
        | {
            originalName: string;
            filename: string;
            mimetype: string;
            path: string;
          }
        | undefined;

      const uploadDir = path.join(process.cwd(), "uploads");

      await mkdir(uploadDir, { recursive: true });

      for await (const part of request.parts()) {
        if (part.type === "field") {
          fields[part.fieldname] = part.value;
          continue;
        }

        if (part.type === "file") {
          const originalName = path.basename(part.filename);
          const extension = path.extname(originalName);
          const nameWithoutExtension = path.basename(originalName, extension);

          const timestamp = new Date()
            .toISOString()
            .replace(/[-:TZ.]/g, "")
            .slice(0, 17);

          const filename = `${nameWithoutExtension}-${timestamp}${extension}`;

          const filepath = path.join(uploadDir, filename);

          await pipeline(part.file, createWriteStream(filepath));

          uploadedFile = {
            originalName: part.filename,
            filename,
            mimetype: part.mimetype,
            path: filepath,
          };
        }
      }

      const input = parseInput(createT1ValidationsSchema, {...fields, createdBy: request?.contextUser?.userId });

      if (uploadedFile) {
        input.supportingDocUrl = `/uploads/${uploadedFile.filename}`;
      }

      const cargo = await service.create(input);

      return created(reply, cargo);
    },
  );
  app.put(
    "/:id/:id2",
    {
      preHandler: [
        app.authenticate,
        app.authorize("t1.validation.edit", "t1.validation.manage"),
      ],
    },
    async (request, reply) => {
      const fields: Record<string, unknown> = {};

      let uploadedFile:
        | {
            originalName: string;
            filename: string;
            mimetype: string;
            path: string;
          }
        | undefined;

      const uploadDir = path.join(process.cwd(), "uploads");

      await mkdir(uploadDir, { recursive: true });

      for await (const part of request.parts()) {
        if (part.type === "field") {
          fields[part.fieldname] = part.value;
          continue;
        }

        if (part.type === "file") {
          const originalName = path.basename(part.filename);
          const extension = path.extname(originalName);
          const nameWithoutExtension = path.basename(originalName, extension);

          const timestamp = new Date()
            .toISOString()
            .replace(/[-:TZ.]/g, "")
            .slice(0, 17);

          const filename = `${nameWithoutExtension}-${timestamp}${extension}`;

          const filepath = path.join(uploadDir, filename);

          await pipeline(part.file, createWriteStream(filepath));

          uploadedFile = {
            originalName: part.filename,
            filename,
            mimetype: part.mimetype,
            path: filepath,
          };
        }
      }

      const input = parseInput(createT1ValidationsSchema, fields);

      if (uploadedFile) {
        input.supportingDocUrl = `/uploads/${uploadedFile.filename}`;
      }

      const cargo = await service.update(
        parseInput(idParamsSchema, request.params).id, parseInput(id2ParamsSchema, request.params).id2,
        input,
      );

      return created(reply, cargo);
    },
  );

  app.put(
    "/status/:id/:status",
    {
      preHandler: [
        app.authenticate,
        app.authorize("t1.validation.edit", "t1.validation.manage"),
      ],
    },
    async (request, reply) =>
      created(
        reply,
        await service.updateStatus(
          parseInput(idParamsSchema, request.params).id,
          parseInput(t1ExtraStatusPamasSchema, request.params).status,
        ),
      ),
  );
};

export default routes;
