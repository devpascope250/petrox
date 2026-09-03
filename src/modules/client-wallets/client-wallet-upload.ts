import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export async function parseWalletMovementMultipart(request: FastifyRequest) {
  const fields: Record<string, unknown> = {};
  const uploadDirectory = path.join(process.cwd(), "uploads");
  await mkdir(uploadDirectory, { recursive: true });

  for await (const part of request.parts()) {
    if (part.type === "field") {
      // The URL is server-owned and cannot be supplied as a text field.
      if (part.fieldname !== "supportingDocUrl") fields[part.fieldname] = part.value;
      continue;
    }

    if (part.fieldname !== "supportingDoc" && part.fieldname !== "supportingDocument") {
      part.file.resume();
      continue;
    }

    const originalName = path.basename(part.filename);
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension) || "supporting-document";
    const filename = `${baseName}-${Date.now()}-${randomUUID()}${extension}`;
    await pipeline(part.file, createWriteStream(path.join(uploadDirectory, filename)));
    fields.supportingDocUrl = `/uploads/${filename}`;
  }

  return fields;
}
