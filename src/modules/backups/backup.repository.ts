import type { BackupTrigger, Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import type { BackupFile } from "./backup-runner.js";

const person = { select: { id: true, firstName: true, lastName: true, email: true } } as const;

const backupSelect = {
  id: true, status: true, trigger: true, fileName: true, sizeBytes: true, sha256: true, keyId: true, error: true,
  createdAt: true, startedAt: true, completedAt: true, expiresAt: true,
  downloadCount: true, lastDownloadedAt: true,
  creator: person, lastDownloader: person,
} satisfies Prisma.BackupSelect;

type Row = Prisma.BackupGetPayload<{ select: typeof backupSelect }>;

/** BigInt does not go into JSON, so the size goes out as a number. */
export const presentBackup = (row: Row) => ({ ...row, sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes) });

/** The `Backup` table is also the job queue: a row is the job, its status the job's state. */
export class BackupRepository {
  constructor(private db: PrismaClient) {}

  async list(query: PaginationQuery) {
    const [rows, total] = await this.db.$transaction([
      this.db.backup.findMany({ ...paginationArgs(query), orderBy: { createdAt: "desc" }, select: backupSelect }),
      this.db.backup.count(),
    ]);
    return [rows.map(presentBackup), total] as const;
  }

  async find(id: string) {
    const row = await this.db.backup.findUnique({ where: { id }, select: backupSelect });
    return row ? presentBackup(row) : null;
  }

  /** A backup still waiting or being made. */
  inProgress() {
    return this.db.backup.findFirst({ where: { status: { in: ["queued", "running"] } }, select: { id: true, status: true } });
  }

  async enqueue(trigger: BackupTrigger, createdBy: string | null) {
    const row = await this.db.backup.create({ data: { trigger, createdBy }, select: backupSelect });
    return presentBackup(row);
  }

  /** The newest scheduled backup, to know whether tonight's has been made. */
  lastScheduled() {
    return this.db.backup.findFirst({ where: { trigger: "scheduled" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  }

  /**
   * Takes the oldest waiting job. The status change is conditional, so if two
   * workers reach the same row only one of them gets it.
   */
  async claimNext() {
    const next = await this.db.backup.findFirst({
      where: { status: "queued" }, orderBy: { createdAt: "asc" }, select: { id: true, createdBy: true },
    });
    if (!next) return null;
    const claimed = await this.db.backup.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "running", startedAt: new Date() },
    });
    return claimed.count === 1 ? next : null;
  }

  complete(id: string, file: BackupFile, expiresAt: Date) {
    return this.db.backup.update({
      where: { id },
      data: { status: "completed", completedAt: new Date(), expiresAt, ...file },
      select: { id: true, fileName: true, sizeBytes: true, sha256: true, expiresAt: true, creator: person },
    });
  }

  fail(id: string, error: string) {
    return this.db.backup.update({ where: { id }, data: { status: "failed", completedAt: new Date(), error: error.slice(0, 4000) } });
  }

  /** Jobs left "running" by a server that stopped: nothing is working on them any more. */
  failInterrupted(message: string) {
    return this.db.backup.updateMany({ where: { status: "running" }, data: { status: "failed", completedAt: new Date(), error: message } });
  }

  /** Completed backups whose file should now be deleted. */
  expired(now = new Date()) {
    return this.db.backup.findMany({
      where: { status: "completed", expiresAt: { lte: now } }, select: { id: true, fileName: true },
    });
  }

  /** The file is gone; the row stays as the record. */
  markExpired(id: string) {
    return this.db.backup.update({ where: { id }, data: { status: "expired" }, select: backupSelect }).then(presentBackup);
  }

  recordDownload(id: string, userId: string) {
    return this.db.backup.update({
      where: { id },
      data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date(), lastDownloadedBy: userId },
    });
  }
}
