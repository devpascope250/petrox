import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export async function parseClearanceMultipart(request: FastifyRequest) {
  const fields: Record<string, unknown> = {};
  const uploadDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadDir, { recursive: true });

  for await (const part of request.parts()) {
    if (part.type === "field") {
      fields[part.fieldname] = part.value;
      continue;
    }

    const documentField = part.fieldname === "supportingDoc" || part.fieldname === "supportingDocUrl"
      ? "supportingDocUrl"
      : part.fieldname === "dmsDoc" || part.fieldname === "dmsDocUrl"
        ? "dmsDocUrl"
        : null;
    if (!documentField) {
      part.file.resume();
      continue;
    }

    const originalName = path.basename(part.filename);
    const extension = path.extname(originalName);
    const nameWithoutExtension = path.basename(originalName, extension);
    const filename = `${nameWithoutExtension}-${Date.now()}-${randomUUID()}${extension}`;
    await pipeline(part.file, createWriteStream(path.join(uploadDir, filename)));
    fields[documentField] = `/uploads/${filename}`;
  }

  return fields;
}
