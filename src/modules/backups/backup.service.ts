import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../../config/env.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { AppError, NotFoundError } from "../../utils/errors.js";
import { BackupRepository } from "./backup.repository.js";

export class BackupService {
  constructor(private repo: BackupRepository, private config: AppConfig) {}

  get configured() {
    return Boolean(this.config.BACKUP_ENCRYPTION_KEY);
  }

  async list(query: PaginationQuery) {
    const [items, total] = await this.repo.list(query);
    return {
      ...paginatedData(items, total, query),
      settings: {
        configured: this.configured,
        keyId: this.config.BACKUP_KEY_ID,
        retentionDays: this.config.BACKUP_RETENTION_DAYS,
        dailyAt: this.config.BACKUP_DAILY_AT || null,
      },
    };
  }

  /** Queues a backup; the worker picks it up within seconds. One at a time. */
  async request(userId: string) {
    if (!this.configured) {
      throw new AppError(503, "BACKUPS_NOT_CONFIGURED", "Backups are off: BACKUP_ENCRYPTION_KEY is not set on the server");
    }
    const busy = await this.repo.inProgress();
    if (busy) throw new AppError(409, "BACKUP_IN_PROGRESS", `A backup is already ${busy.status}; wait for it to finish`, { id: busy.id });
    return this.repo.enqueue("manual", userId);
  }

  /** The encrypted file, as it was made; recorded against the person who fetched it. */
  async download(id: string, userId: string) {
    const backup = await this.repo.find(id);
    if (!backup) throw new NotFoundError("Backup");
    if (backup.status === "expired") throw new AppError(410, "BACKUP_EXPIRED", "This backup's file has been deleted");
    if (backup.status !== "completed" || !backup.fileName) {
      throw new AppError(409, "BACKUP_NOT_READY", `This backup is ${backup.status}`);
    }
    const file = this.filePath(backup.fileName);
    const { size } = await stat(file).catch(() => {
      throw new AppError(410, "BACKUP_FILE_MISSING", "This backup's file is no longer on the server");
    });
    await this.repo.recordDownload(id, userId);
    return { stream: createReadStream(file), fileName: backup.fileName, size, sha256: backup.sha256 };
  }

  /** Deletes the file now rather than at the end of its retention; the record stays. */
  async remove(id: string) {
    const backup = await this.repo.find(id);
    if (!backup) throw new NotFoundError("Backup");
    if (backup.status === "queued" || backup.status === "running") {
      throw new AppError(409, "BACKUP_IN_PROGRESS", "A backup cannot be deleted while it is being made");
    }
    if (backup.fileName) await rm(this.filePath(backup.fileName), { force: true });
    return backup.status === "completed" ? this.repo.markExpired(id) : backup;
  }

  /** Only ever a bare name inside BACKUP_DIR, so no stored value can point elsewhere. */
  filePath(fileName: string) {
    return path.join(path.resolve(this.config.BACKUP_DIR), path.basename(fileName));
  }
}
