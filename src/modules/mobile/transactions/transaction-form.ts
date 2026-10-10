import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { AppError } from "../../../utils/errors.js";

const IMAGES = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const DOCUMENTS = new Set([...IMAGES, ".pdf"]);

/**
 * The files a form may carry, by field name, and what each may be. Files
 * under any other name are skipped, never saved.
 */
export type FileRules = Array<{ field: RegExp; kind: "image" | "document" }>;

export interface MobileForm {
  /** Every text field, by name. An empty field counts as not sent. */
  fields: Record<string, string>;
  /** The URL each saved file is served at, by field name. */
  files: Record<string, string>;
  /** Removes the saved files: for a request that failed after they were written. */
  discard: () => Promise<void>;
}

const uploadDirectory = () => path.join(process.cwd(), "uploads");

/**
 * Reads a POS request sent as multipart/form-data: plain text fields, and
 * the pictures and documents named in `rules`, each saved under `/uploads`.
 * If reading fails part way, what was already saved is removed.
 */
export async function readMobileForm(request: FastifyRequest, rules: FileRules, maxFiles = 12): Promise<MobileForm> {
  if (!request.isMultipart()) {
    throw new AppError(415, "MULTIPART_REQUIRED", "Send this request as multipart/form-data");
  }
  const fields: Record<string, string> = {};
  const files: Record<string, string> = {};
  const saved: string[] = [];
  const discard = async () => {
    await Promise.all(saved.map((file) => rm(file, { force: true })));
  };
  await mkdir(uploadDirectory(), { recursive: true });

  try {
    for await (const part of request.parts({ limits: { files: maxFiles } })) {
      if (part.type === "field") {
        const value = String(part.value).trim();
        if (value !== "") fields[part.fieldname] = value;
        continue;
      }
      const rule = rules.find(({ field }) => field.test(part.fieldname));
      if (!rule || !part.filename) {
        part.file.resume();
        continue;
      }
      const originalName = path.basename(part.filename);
      const extension = path.extname(originalName).toLowerCase();
      if (!(rule.kind === "image" ? IMAGES : DOCUMENTS).has(extension)) {
        part.file.resume();
        throw new AppError(400, "UNSUPPORTED_FILE", rule.kind === "image"
          ? `${part.fieldname} must be a picture (PNG, JPG or WEBP)`
          : `${part.fieldname} must be a PDF or a picture`);
      }
      const baseName = (path.basename(originalName, extension) || part.fieldname).replace(/[^\w.-]+/g, "_").slice(0, 60);
      const filename = `${baseName}-${Date.now()}-${randomUUID()}${extension}`;
      const target = path.join(uploadDirectory(), filename);
      saved.push(target);
      await pipeline(part.file, createWriteStream(target));
      if (part.file.truncated) throw new AppError(413, "FILE_TOO_LARGE", `${part.fieldname} is too large`);
      files[part.fieldname] = `/uploads/${filename}`;
    }
  } catch (error) {
    await discard();
    throw error;
  }
  return { fields, files, discard };
}
