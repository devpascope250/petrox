import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { AppError } from "../../utils/errors.js";

/** A payment's proof is a slip, a receipt or a screenshot. */
const ALLOWED = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
/** File fields are named `referenceDoc.<n>`, `n` being the payment's position. */
const FILE_FIELD = /^referenceDoc\.(\d+)$/;

/**
 * Reads a sale sent as multipart: the sale itself as JSON in the `payload`
 * field, plus an optional document per payment. Each document is saved under
 * `/uploads` and its URL placed on the payment it belongs to.
 */
export async function parseFuelSaleMultipart(request: FastifyRequest) {
  let payload: unknown;
  const documents = new Map<number, string>();
  const uploadDirectory = path.join(process.cwd(), "uploads");
  await mkdir(uploadDirectory, { recursive: true });

  // A split sale can carry a document per payment, more than the app-wide two.
  for await (const part of request.parts({ limits: { files: 10 } })) {
    if (part.type === "field") {
      if (part.fieldname === "payload") {
        try {
          payload = JSON.parse(String(part.value));
        } catch {
          throw new AppError(400, "INVALID_PAYLOAD", "The sale details could not be read");
        }
      }
      continue;
    }

    const index = FILE_FIELD.exec(part.fieldname)?.[1];
    if (index === undefined || !part.filename) {
      part.file.resume();
      continue;
    }

    const originalName = path.basename(part.filename);
    const extension = path.extname(originalName).toLowerCase();
    if (!ALLOWED.has(extension)) {
      part.file.resume();
      throw new AppError(400, "UNSUPPORTED_DOCUMENT", "A reference document must be a PDF or an image");
    }
    const baseName = (path.basename(originalName, path.extname(originalName)) || "reference").replace(/[^\w.-]+/g, "_");
    const filename = `${baseName}-${Date.now()}-${randomUUID()}${extension}`;
    await pipeline(part.file, createWriteStream(path.join(uploadDirectory, filename)));
    documents.set(Number(index), `/uploads/${filename}`);
  }

  if (!payload || typeof payload !== "object") {
    throw new AppError(400, "INVALID_PAYLOAD", "The sale details are missing");
  }
  const body = payload as { payments?: unknown };
  if (Array.isArray(body.payments)) {
    body.payments = body.payments.map((payment, index) =>
      // Only the server names the URL: anything sent by the client is dropped.
      ({ ...(payment as object), referenceDocUrl: documents.get(index) }));
  }
  return body;
}
