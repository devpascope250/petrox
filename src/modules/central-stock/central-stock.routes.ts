import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import {
  cargoReceivedDatePamasSchema,
  cargoStatusPamasSchema,
  cuidParamsSchema,
  id2ParamsSchema,
  idParamsSchema,
  parseInput,
  t1ExtraStatusPamasSchema,
} from "../../shared/validation/index.js";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { CentralStockService } from "./central-stock.service.js";
import { CentralStockRepository } from "./central-stock.repository.js";
import { createCentralStockSchema, stockTransactionSchema } from "./central-stock.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new CentralStockService(new CentralStockRepository(app.prisma), app.config);
  app.get(
    "/",
    {
      preHandler: [
        app.authenticate,
        app.authorize("central.stock.read", "central.stock.manage"),
      ],
    },
    async (request) => success(await service.list()),
  );

  app.post(
    "/",
    {
      preHandler: [
        app.authenticate,
        app.authorize("central.stock.create", "central.stock.manage"),
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

      const input = parseInput(createCentralStockSchema, fields);

      if (uploadedFile) {
        input.supportingDocUrl = `/uploads/${uploadedFile.filename}`;
      }

      const cargo = await service.create(input, request.contextUser?.userId ?? "");

      return created(reply, cargo);
    },
  );

  app.put(
    "/transaction",
    {
      preHandler: [
        app.authenticate,
        app.authorize("central.stock.edit", "central.stock.manage"),
      ],
    },
    async (request, reply) =>
      created(
        reply,
        await service.recordStatus(parseInput(stockTransactionSchema, request.body),request.contextUser?.userId ?? ""
        ),
      ),
  );
};

export default routes;
