import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import {
  cargoReceivedDatePamasSchema,
  cargoStatusPamasSchema,
  cuidParamsSchema,
  idParamsSchema,
  parseInput,
} from "../../shared/validation/index.js";
import { CargoService } from "./cargo.service.js";
import { CargoRepository } from "./cargo.repository.js";
import { cargoListQuerySchema, createCargoSchema, fileSchema } from "./cargo.schema.js";
import { readCargoUpload } from "./cargo-upload.js";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const routes: FastifyPluginAsync = async (app) => {
  const service = new CargoService(new CargoRepository(app.prisma), app.config);
  app.get(
    "/",
    {
      preHandler: [
        app.authenticate,
        app.authorize("cargo.read", "cargo.manage"),
      ],
    },
    async (request) =>
      success(await service.list(parseInput(cargoListQuerySchema, request.query))),
  );
  app.get(
    "/:id",
    {
      preHandler: [
        app.authenticate,
        app.authorize("cargo.read", "cargo.manage"),
      ],
    },
    async (request) =>
      success(
        await service.find(parseInput(cuidParamsSchema, request.params).id),
      ),
  );

  app.post(
    "/",
    {
      preHandler: [
        app.authenticate,
        app.authorize("cargo.create", "cargo.manage"),
      ],
    },
    async (request, reply) => {
      /*
       * Two documents, kept apart by the field they arrive under: the bill of
       * lading and the like belong to the shipment, the supplier's proforma to
       * the PFI raised with it. They used to share one slot, so whichever file
       * arrived last became the cargo's and the PFI got none.
       */
      const { fields, files } = await readCargoUpload(request, {
        supportingDocUrl: ["supportingDocUrl", "supportingDoc", "supportingDocument"],
        pfiSupportingDocUrl: ["pfiSupportingDocUrl", "pfiSupportingDoc", "pfiDocument"],
      });

      const input = parseInput(createCargoSchema, fields);
      if (files.supportingDocUrl) input.supportingDocUrl = files.supportingDocUrl;
      // Only of any use when a PFI came with the shipment.
      if (input.pfi && files.pfiSupportingDocUrl) {
        input.pfi.supportingDocUrl = files.pfiSupportingDocUrl;
      }

      const cargo = await service.create(input);

      return created(reply, cargo);
    },
  );
  app.put(
    "/:id",
    {
      preHandler: [
        app.authenticate,
        app.authorize("cargo.edit", "cargo.manage"),
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

      const input = parseInput(createCargoSchema, fields);

      if (uploadedFile) {
        input.supportingDocUrl = `/uploads/${uploadedFile.filename}`;
      }

      const cargo = await service.update(
        parseInput(cuidParamsSchema, request.params).id,
        input,
      );

      return created(reply, cargo);
    },
  );

  app.put(
    "/status/:id/:status/:date",
    {
      preHandler: [
        app.authenticate,
        app.authorize("cargo.edit", "cargo.manage"),
      ],
    },
    async (request, reply) =>
      created(
        reply,
        await service.updateStatus(
          parseInput(cuidParamsSchema, request.params).id,
          parseInput(cargoStatusPamasSchema, request.params).status,
          parseInput(cargoReceivedDatePamasSchema, request.params).date
        ),
      ),
  );
};

export default routes;
