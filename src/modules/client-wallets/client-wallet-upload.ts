import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export async function parseWalletMovementMultipart(request: FastifyRequest) {
  const fields: Record<string, unknown> = {};
  let uploadedDocUrl: string | undefined;
  const uploadDirectory = path.join(process.cwd(), "uploads");
  await mkdir(uploadDirectory, { recursive: true });

  for await (const part of request.parts()) {
    if (part.type === "field") {
      fields[part.fieldname] = part.value;
      continue;
    }

    if (!["supportingDocUrl", "supportingDoc", "supportingDocument"].includes(part.fieldname)) {
      part.file.resume();
      continue;
    }

    const originalName = path.basename(part.filename);
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension) || "supporting-document";
    const filename = `${baseName}-${Date.now()}-${randomUUID()}${extension}`;
    await pipeline(part.file, createWriteStream(path.join(uploadDirectory, filename)));
    uploadedDocUrl = `/uploads/${filename}`;
  }

  return uploadedDocUrl ? { ...fields, supportingDocUrl: uploadedDocUrl } : fields;
}
