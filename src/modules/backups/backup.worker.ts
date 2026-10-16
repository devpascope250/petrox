import { rm } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/env.js";
import { emailService } from "../../utils/emailService.js";
import { BackupRepository } from "./backup.repository.js";
import { BackupRunner } from "./backup-runner.js";
import { BackupService } from "./backup.service.js";
import { backupKey } from "./backup-crypto.js";

const RWANDA_OFFSET = "+02:00";

/**
 * When tonight's backup is due: the moment `dailyAt` (Rwanda time) on the day
 * it is now, once reached, unless a scheduled backup was already made since.
 * A server that was down at that time catches up as soon as it is back.
 */
export function scheduledBackupDue(now: Date, dailyAt: string, lastScheduled: Date | null) {
  if (!dailyAt) return false;
  const today = new Date(now.getTime() + 2 * 60 * 60_000).toISOString().slice(0, 10);
  const slot = new Date(`${today}T${dailyAt}:00${RWANDA_OFFSET}`);
  return now >= slot && (!lastScheduled || lastScheduled < slot);
}

/**
 * Makes the backups the API queues, in the API's own process (it runs as one
 * instance): every few seconds the oldest queued job is claimed and run, every
 * minute the nightly backup is queued when due, and every hour expired files
 * are deleted. Nothing runs without a BACKUP_ENCRYPTION_KEY.
 */
export function startBackupWorker(app: FastifyInstance, config: AppConfig) {
  if (!config.BACKUP_ENCRYPTION_KEY) {
    app.log.warn("Backups are off: BACKUP_ENCRYPTION_KEY is not set");
    return;
  }
  const repo = new BackupRepository(app.prisma);
  const service = new BackupService(repo, config);
  const runner = new BackupRunner({
    databaseUrl: config.DATABASE_URL, dir: config.BACKUP_DIR, key: backupKey(config.BACKUP_ENCRYPTION_KEY),
    keyId: config.BACKUP_KEY_ID, mysqldump: config.MYSQLDUMP_PATH,
  });
  const log = app.log.child({ module: "backups" });

  let busy = false;
  async function processNext() {
    if (busy) return;
    busy = true;
    try {
      const job = await repo.claimNext();
      if (!job) return;
      log.info({ id: job.id }, "Backup started");
      try {
        const file = await runner.run(job.id);
        const expiresAt = new Date(Date.now() + config.BACKUP_RETENTION_DAYS * 24 * 60 * 60_000);
        const done = await repo.complete(job.id, file, expiresAt);
        log.info({ id: job.id, file: file.fileName, bytes: Number(file.sizeBytes) }, "Backup completed");
        notify(job.id, done.creator, { ok: true, fileName: file.fileName, sizeBytes: Number(file.sizeBytes), expiresAt });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await repo.fail(job.id, message);
        log.error({ id: job.id, err: error }, "Backup failed");
        const failed = await repo.find(job.id);
        notify(job.id, failed?.creator ?? null, { ok: false, error: message });
      }
    } catch (error) {
      log.error({ err: error }, "Backup worker error");
    } finally {
      busy = false;
    }
  }

  /** Tells the person who asked; a nightly backup has nobody to tell. Never fails the job. */
  function notify(id: string, to: { email: string; firstName: string } | null,
    result: { ok: true; fileName: string; sizeBytes: number; expiresAt: Date } | { ok: false; error: string }) {
    if (!to) return;
    emailService.sendBackupReportEmail(to.email, to.firstName, { id, ...result })
      .catch((error) => log.warn({ id, err: error }, "Could not email the backup report"));
  }

  async function queueNightly() {
    try {
      const last = await repo.lastScheduled();
      if (scheduledBackupDue(new Date(), config.BACKUP_DAILY_AT, last?.createdAt ?? null)) {
        await repo.enqueue("scheduled", null);
        log.info("Nightly backup queued");
      }
    } catch (error) {
      log.error({ err: error }, "Could not queue the nightly backup");
    }
  }

  async function deleteExpired() {
    try {
      for (const backup of await repo.expired()) {
        if (backup.fileName) await rm(service.filePath(backup.fileName), { force: true });
        await repo.markExpired(backup.id);
        log.info({ id: backup.id }, "Expired backup deleted");
      }
    } catch (error) {
      log.error({ err: error }, "Could not delete expired backups");
    }
  }

  // A restart mid-backup leaves a row "running" that nothing is working on.
  // Started inside a promise, so even a synchronous error is logged and never
  // stops the API from booting.
  Promise.resolve()
    .then(() => repo.failInterrupted("The server restarted while this backup was being made"))
    .then(deleteExpired)
    .catch((error) => log.error({ err: error }, "Backup worker start-up failed"));

  const timers = [
    setInterval(processNext, 5_000),
    setInterval(queueNightly, 60_000),
    setInterval(deleteExpired, 60 * 60_000),
  ];
  for (const timer of timers) timer.unref();
  app.addHook("onClose", async () => timers.forEach(clearInterval));
}
