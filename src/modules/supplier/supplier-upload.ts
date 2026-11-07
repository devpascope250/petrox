import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

/** The field names a client may send the supplier's paperwork as. */
const DOCUMENT_FIELDS = ["document", "documentUrl", "supplierDocument"];

/**
 * Reads a supplier sent as multipart: its text fields, plus the stored path of
 * the document if one came with it.
 *
 * The stored path is generated here and **never** taken from the client, so a
 * text field named `documentUrl` is dropped rather than trusted — otherwise
 * anyone could point a supplier's paperwork at any file on the server. A
 * request with no file returns no `documentUrl` at all, which is what keeps an
 * edit from wiping the document already on file.
 */
export async function readSupplierUpload(request: FastifyRequest) {
  const fields: Record<string, unknown> = {};
  let storedPath: string | undefined;
  const uploadDirectory = path.join(process.cwd(), "uploads");
  await mkdir(uploadDirectory, { recursive: true });

  for await (const part of request.parts()) {
    if (part.type === "field") {
      if (!DOCUMENT_FIELDS.includes(part.fieldname)) fields[part.fieldname] = part.value;
      continue;
    }

    if (!DOCUMENT_FIELDS.includes(part.fieldname)) {
      // Drained rather than left hanging: an unread stream stalls the request.
      part.file.resume();
      continue;
    }

    const originalName = path.basename(part.filename);
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension) || "supplier-document";
    storedPath = `/uploads/${baseName}-${Date.now()}-${randomUUID()}${extension}`;
    await pipeline(part.file, createWriteStream(path.join(uploadDirectory, path.basename(storedPath))));
  }

  return storedPath ? { ...fields, documentUrl: storedPath } : fields;
}

/**
 * The body of a supplier request, however it was sent: multipart when a
 * document travels with it, plain JSON when it does not.
 */
export function readSupplierBody(request: FastifyRequest) {
  return request.isMultipart() ? readSupplierUpload(request) : Promise.resolve(request.body);
}
