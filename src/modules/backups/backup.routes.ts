import type { FastifyPluginAsync } from "fastify";
import { success } from "../../shared/http/index.js";
import { idParamsSchema, paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { BackupRepository } from "./backup.repository.js";
import { BackupService } from "./backup.service.js";
import { startBackupWorker } from "./backup.worker.js";
import { decryptUploadedBackup } from "./backup-decrypt.js";

/**
 * Database backups, guarded by the "Backups" module:
 *
 * - `GET /backups` — the list, newest first, with the server's backup settings;
 * - `POST /backups` — queue a backup (`202`); the worker makes it in the background;
 * - `GET /backups/:id/download` — the encrypted file (see docs/backups.md to open it);
 * - `DELETE /backups/:id` — delete the file now; the record stays;
 * - `POST /backups/decrypt` — upload an encrypted backup with its key and get
 *   the plain dump back (`.sql.gz`). Needs `backups.manage` *and* the key.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new BackupService(new BackupRepository(app.prisma), app.config);
  const read = app.authorize("backups.read", "backups.manage");

  app.get("/", { preHandler: [app.authenticate, read] }, async (request) =>
    success(await service.list(parseInput(paginationQuerySchema, request.query))));

  app.post("/", {
    preHandler: [app.authenticate, app.authorize("backups.create", "backups.manage")],
    // A dump is heavy; nobody needs more than a few an hour.
    config: { rateLimit: { max: 6, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    reply.code(202);
    return success(await service.request(request.contextUser!.userId));
  });

  app.get("/:id/download", { preHandler: [app.authenticate, read] }, async (request, reply) => {
    const file = await service.download(parseInput(idParamsSchema, request.params).id, request.contextUser!.userId);
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${file.fileName}"`);
    reply.header("Content-Length", file.size);
    if (file.sha256) reply.header("X-Backup-Sha256", file.sha256);
    return reply.send(file.stream);
  });

  app.delete("/:id", { preHandler: [app.authenticate, app.authorize("backups.delete", "backups.manage")] }, async (request) =>
    success(await service.remove(parseInput(idParamsSchema, request.params).id)));

  app.post("/decrypt", {
    preHandler: [app.authenticate, app.authorize("backups.manage")],
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const file = await decryptUploadedBackup(request, app.config.BACKUP_DIR, app.config.BACKUP_DECRYPT_MAX_MB * 1024 * 1024);
    // Who opened which key's backup; never the key itself.
    request.log.info({ userId: request.contextUser!.userId, keyId: file.keyId, bytes: file.size }, "Backup decrypted on the web");
    reply.raw.on("close", () => void file.cleanup());
    reply.header("Content-Type", "application/gzip");
    reply.header("Content-Disposition", `attachment; filename="${file.fileName}"`);
    reply.header("Content-Length", file.size);
    reply.header("X-Backup-Key-Id", file.keyId);
    // The plain database: never kept by a browser or proxy cache.
    reply.header("Cache-Control", "no-store");
    return reply.send(file.stream);
  });

  // Not under test: the worker would start timers and touch the disk.
  if (app.config.NODE_ENV !== "test") startBackupWorker(app, app.config);
};

export default routes;
