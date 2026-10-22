import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export async function parseCargoInvoiceMultipart(request: FastifyRequest) {
  const fields: Record<string, unknown> = {};
  const uploadDirectory = path.join(process.cwd(), "uploads");
  await mkdir(uploadDirectory, { recursive: true });

  for await (const part of request.parts()) {
    if (part.type === "field") {
      // Never trust a client-supplied path; uploaded paths are generated below.
      if (part.fieldname !== "supportingDocUrl") fields[part.fieldname] = part.value;
      continue;
    }

    /*
     * The document, under any of the names the clients use. The web app sends
     * it as `supportingDocUrl` — the same name the cargo and PFI endpoints
     * take — and it used to be dropped here, so an invoice was saved with no
     * document at all and there was nothing to open. A *text* field of that
     * name is still ignored above: the stored path is generated, never taken
     * from the client.
     */
    if (
      part.fieldname !== "supportingDoc" &&
      part.fieldname !== "supportingDocument" &&
      part.fieldname !== "supportingDocUrl"
    ) {
      part.file.resume();
      continue;
    }

    const originalName = path.basename(part.filename);
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension) || "invoice-document";
    const filename = `${baseName}-${Date.now()}-${randomUUID()}${extension}`;
    await pipeline(part.file, createWriteStream(path.join(uploadDirectory, filename)));
    fields.supportingDocUrl = `/uploads/${filename}`;
  }

  return fields;
}
