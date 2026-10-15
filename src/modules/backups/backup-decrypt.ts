import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyRequest } from "fastify";
import { AppError } from "../../utils/errors.js";
import { decryptStream, readBackupHeader } from "./backup-crypto.js";

/**
 * Opens an uploaded backup with the key sent alongside it, for someone who
 * holds both the permission and the key. The upload is kept in an owner-only
 * temporary file and fully checked before anything is returned: GCM only
 * proves the data at its very end, so a wrong key or an altered file gives an
 * error, never part of a database. `cleanup` removes every temporary file.
 */
export async function decryptUploadedBackup(request: FastifyRequest, dir: string, maxBytes: number) {
  const work = path.resolve(dir);
  await mkdir(work, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const input = path.join(work, `.decrypt-${id}.enc`);
  const output = path.join(work, `.decrypt-${id}.sql.gz`);
  const cleanup = () => Promise.all([rm(input, { force: true }), rm(output, { force: true })]).then(() => undefined);

  try {
    let keyBase64: string | undefined;
    let uploadName: string | undefined;
    for await (const part of request.parts({ limits: { fileSize: maxBytes, files: 1, fields: 2 } })) {
      if (part.type === "file") {
        if (part.fieldname !== "backup") {
          part.file.resume();
          throw new AppError(400, "VALIDATION_ERROR", "Send the encrypted backup as the `backup` file");
        }
        uploadName = part.filename;
        await pipeline(part.file, createWriteStream(input, { mode: 0o600 }));
        if (part.file.truncated) {
          throw new AppError(413, "BACKUP_TOO_LARGE", `The backup is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
        }
      } else if (part.fieldname === "key") {
        keyBase64 = String(part.value).trim();
      }
    }
    if (!uploadName) throw new AppError(400, "VALIDATION_ERROR", "Attach the encrypted backup as `backup`");
    const key = keyBase64 ? Buffer.from(keyBase64, "base64") : Buffer.alloc(0);
    if (key.length !== 32) {
      throw new AppError(400, "VALIDATION_ERROR", "`key` must be the 32-byte backup key, base64-encoded");
    }

    const info = await readBackupHeader(input).catch((error: Error) => {
      throw new AppError(400, "NOT_A_BACKUP", error.message);
    });
    try {
      // Kept gzipped: smaller to download, and still opens with any unzip tool.
      await pipeline(createReadStream(input, { start: info.dataStart, end: info.dataEnd - 1 }),
        decryptStream(key, info), createWriteStream(output, { mode: 0o600 }));
    } catch {
      throw new AppError(422, "BACKUP_KEY_OR_FILE_INVALID",
        `The key does not open this backup (it names key "${info.keyId}"), or the file was altered`);
    }
    await rm(input, { force: true });
    const { size } = await stat(output);
    const fileName = `${path.basename(uploadName).replace(/\.enc$/, "").replace(/\.gz$/, "") || "backup.sql"}.gz`;
    return { stream: createReadStream(output), fileName, size, keyId: info.keyId, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
