import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { encryptStream } from "./backup-crypto.js";

export interface BackupRunnerOptions {
  databaseUrl: string;
  dir: string;
  key: Buffer;
  keyId: string;
  mysqldump: string;
}

export interface BackupFile {
  fileName: string;
  sizeBytes: bigint;
  sha256: string;
  keyId: string;
}

/** The connection details of a `mysql://user:password@host:port/database` URL. */
export function mysqlTarget(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "mysql:") throw new Error("DATABASE_URL is not a MySQL URL");
  return {
    host: url.hostname,
    port: url.port || "3306",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

/** A value for a MySQL option file, quoted so any character survives. */
const optionValue = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** `petrox-20261015-020000-1a2b3c4d.sql.gz.enc`, stamped in UTC. */
export function backupFileName(id: string, at: Date) {
  const stamp = at.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `petrox-${stamp}-${id.slice(0, 8)}.sql.gz.enc`;
}

/**
 * Dumps the database and seals it: mysqldump → gzip → AES-256-GCM → file,
 * streamed end to end so nothing is held in memory. It writes to a partial
 * file and renames it only once everything has succeeded; on any failure the
 * partial file is removed.
 */
export class BackupRunner {
  constructor(private options: BackupRunnerOptions) {}

  async run(id: string, at = new Date()): Promise<BackupFile> {
    const dir = path.resolve(this.options.dir);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const target = mysqlTarget(this.options.databaseUrl);
    const fileName = backupFileName(id, at);
    const partial = path.join(dir, `.partial-${id}`);
    // The password goes in an option file only this user can read, never on
    // the command line, where other users could see it in the process list.
    const credentials = path.join(dir, `.my-${id}.cnf`);
    await writeFile(credentials, `[client]\npassword=${optionValue(target.password)}\n`, { mode: 0o600 });

    try {
      const dump = spawn(this.options.mysqldump, [
        `--defaults-extra-file=${credentials}`,
        `--host=${target.host}`, `--port=${target.port}`, `--user=${target.user}`,
        // A consistent snapshot without locking the tables the API is using.
        "--single-transaction", "--quick", "--routines", "--triggers", "--events",
        "--no-tablespaces", "--hex-blob", "--default-character-set=utf8mb4",
        target.database,
      ], { stdio: ["ignore", "pipe", "pipe"] });

      let stderr = "";
      dump.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 4000) stderr += chunk.toString();
      });
      const exited = new Promise<number>((resolve, reject) => {
        dump.on("error", reject);
        dump.on("close", (code) => resolve(code ?? 1));
      });
      // Awaited below; until then a failure must not surface as an unhandled rejection.
      exited.catch(() => undefined);

      const hash = createHash("sha256");
      const hashing = new PassThrough();
      hashing.on("data", (chunk: Buffer) => hash.update(chunk));
      try {
        await pipeline(dump.stdout, createGzip({ level: 6 }), encryptStream(this.options.key, this.options.keyId), hashing,
          createWriteStream(partial, { mode: 0o600 }));
      } catch (error) {
        dump.kill();
        throw error;
      }
      const code = await exited;
      if (code !== 0) throw new Error(`mysqldump exited with code ${code}: ${stderr.trim() || "no message"}`);

      const finalPath = path.join(dir, fileName);
      await rename(partial, finalPath);
      const { size } = await stat(finalPath);
      return { fileName, sizeBytes: BigInt(size), sha256: hash.digest("hex"), keyId: this.options.keyId };
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    } finally {
      await rm(credentials, { force: true });
    }
  }
}
