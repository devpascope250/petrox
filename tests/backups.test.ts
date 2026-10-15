import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decryptStream, encryptStream, readBackupHeader } from "../src/modules/backups/backup-crypto.js";
import { backupFileName, mysqlTarget } from "../src/modules/backups/backup-runner.js";
import { BackupService } from "../src/modules/backups/backup.service.js";
import { scheduledBackupDue } from "../src/modules/backups/backup.worker.js";

let dir: string;
beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), "petrox-backup-test-")); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

async function seal(content: Buffer, key: Buffer, keyId = "k1") {
  const file = path.join(dir, `${randomBytes(4).toString("hex")}.enc`);
  await pipeline(Readable.from([content.subarray(0, 10), content.subarray(10)]), encryptStream(key, keyId), createWriteStream(file));
  return file;
}
async function open(file: string, key: Buffer) {
  const info = await readBackupHeader(file);
  return buffer(createReadStream(file, { start: info.dataStart, end: info.dataEnd - 1 }).pipe(decryptStream(key, info)));
}

describe("backup encryption", () => {
  const key = randomBytes(32);
  const dump = Buffer.from("-- MySQL dump\nCREATE TABLE `User` (id varchar(191));\n".repeat(200));

  it("decrypts back to exactly what was sealed, and names its key", async () => {
    const file = await seal(dump, key, "k7");
    expect((await readBackupHeader(file)).keyId).toBe("k7");
    expect((await open(file, key)).equals(dump)).toBe(true);
  });

  it("uses a fresh IV for every file", async () => {
    const [a, b] = [await seal(dump, key), await seal(dump, key)];
    expect((await readFile(a)).equals(await readFile(b))).toBe(false);
  });

  it("refuses the wrong key", async () => {
    await expect(open(await seal(dump, key), randomBytes(32))).rejects.toThrow();
  });

  it("refuses a file with one byte changed, in the data or in the header", async () => {
    for (const position of [200, 7]) {
      const file = await seal(dump, key);
      const bytes = await readFile(file);
      bytes[position] ^= 0x01;
      await writeFile(file, bytes);
      await expect(open(file, key)).rejects.toThrow();
    }
  });

  it("refuses something that is not a backup", async () => {
    const file = path.join(dir, "not-a-backup");
    await writeFile(file, "hello");
    await expect(readBackupHeader(file)).rejects.toThrow("Not a Petrox backup file");
  });
});

describe("backup runner helpers", () => {
  it("reads the connection from DATABASE_URL, decoding the password", () => {
    expect(mysqlTarget("mysql://petrox:p%40ss%23word@127.0.0.1:3306/ikwim")).toEqual({
      host: "127.0.0.1", port: "3306", user: "petrox", password: "p@ss#word", database: "ikwim",
    });
  });

  it("names files by time and id", () => {
    expect(backupFileName("1a2b3c4d-0000", new Date("2026-10-15T00:00:05Z"))).toBe("petrox-20261015-000005-1a2b3c4d.sql.gz.enc");
  });
});

describe("nightly backup", () => {
  // 02:00 in Rwanda is 00:00 UTC.
  it("is due once 02:00 has passed and none was made since", () => {
    expect(scheduledBackupDue(new Date("2026-10-15T00:30:00Z"), "02:00", null)).toBe(true);
    expect(scheduledBackupDue(new Date("2026-10-14T23:30:00Z"), "02:00", new Date("2026-10-14T00:00:30Z"))).toBe(false);
    expect(scheduledBackupDue(new Date("2026-10-15T00:30:00Z"), "02:00", new Date("2026-10-15T00:00:30Z"))).toBe(false);
  });

  it("catches up after the server was down at 02:00", () => {
    expect(scheduledBackupDue(new Date("2026-10-15T07:00:00Z"), "02:00", new Date("2026-10-14T00:00:30Z"))).toBe(true);
  });

  it("is off when no time is set", () => {
    expect(scheduledBackupDue(new Date(), "", null)).toBe(false);
  });
});

describe("requesting a backup", () => {
  const config = (key?: string) => ({ BACKUP_ENCRYPTION_KEY: key, BACKUP_DIR: dir, BACKUP_KEY_ID: "k1", BACKUP_RETENTION_DAYS: 14, BACKUP_DAILY_AT: "02:00" }) as never;
  const key = randomBytes(32).toString("base64");

  it("is refused while backups are not configured", async () => {
    await expect(new BackupService({} as never, config()).request("user")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("is refused while another backup is queued or running", async () => {
    const repo = { inProgress: vi.fn().mockResolvedValue({ id: "b1", status: "running" }), enqueue: vi.fn() };
    await expect(new BackupService(repo as never, config(key)).request("user")).rejects.toMatchObject({ statusCode: 409, code: "BACKUP_IN_PROGRESS" });
    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  it("queues a manual backup for the person who asked", async () => {
    const repo = { inProgress: vi.fn().mockResolvedValue(null), enqueue: vi.fn().mockResolvedValue({ id: "b2" }) };
    await new BackupService(repo as never, config(key)).request("user");
    expect(repo.enqueue).toHaveBeenCalledWith("manual", "user");
  });

  it("only ever serves files from inside the backup folder", () => {
    const service = new BackupService({} as never, config(key));
    expect(service.filePath("../../etc/passwd")).toBe(path.join(path.resolve(dir), "passwd"));
  });
});
