import type { FastifyRequest } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * Reads a cargo's multipart body, keeping each document under its own name.
 *
 * A shipment carries its own paperwork and the PFI raised with it carries the
 * supplier's proforma: two different documents in one request. `slots` maps the
 * name the stored path is returned under to the field names a client may send
 * that file as, so neither can overwrite the other.
 *
 * A **text** field named like a document slot is ignored: the stored path is
 * generated here and never taken from the client.
 */
export async function readCargoUpload<T extends Record<string, readonly string[]>>(
  request: FastifyRequest,
  slots: T,
) {
  const fields: Record<string, unknown> = {};
  const files: Partial<Record<keyof T, string>> = {};
  const uploadDirectory = path.join(process.cwd(), "uploads");
  await mkdir(uploadDirectory, { recursive: true });

  /** Which slot, if any, a part's field name belongs to. */
  const slotOf = (fieldname: string) =>
    (Object.keys(slots) as Array<keyof T>).find((slot) =>
      slots[slot].includes(fieldname),
    );

  for await (const part of request.parts()) {
    if (part.type === "field") {
      if (!slotOf(part.fieldname)) fields[part.fieldname] = part.value;
      continue;
    }

    const slot = slotOf(part.fieldname);
    if (!slot) {
      // Drained rather than left hanging: an unread stream stalls the request.
      part.file.resume();
      continue;
    }

    const originalName = path.basename(part.filename);
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension) || String(slot);
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
    const filename = `${baseName}-${stamp}${extension}`;
    await pipeline(part.file, createWriteStream(path.join(uploadDirectory, filename)));
    files[slot] = `/uploads/${filename}`;
  }

  return { fields, files };
}
