/**
 * Opens a downloaded backup: checks it, decrypts it and writes the plain SQL.
 *
 *   BACKUP_ENCRYPTION_KEY=<base64 key> pnpm backup:decrypt petrox-….sql.gz.enc [out.sql]
 *
 * The key is the one the server had when the backup was made (the file names
 * its key id). Nothing is kept unless the whole file checks out: a wrong key or
 * a damaged file leaves no output behind. Restoring is then a deliberate step:
 *
 *   mysql -u <user> -p <database> < out.sql
 */
import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { backupKey, decryptStream, readBackupHeader } from "../src/modules/backups/backup-crypto.js";

async function main() {
  const [input, output = input?.replace(/\.gz\.enc$/, "").replace(/\.enc$/, "") ?? ""] = process.argv.slice(2);
  if (!input) {
    console.error("Usage: BACKUP_ENCRYPTION_KEY=<base64 key> pnpm backup:decrypt <backup.sql.gz.enc> [out.sql]");
    process.exit(2);
  }
  if (output === input) throw new Error("Name an output file different from the backup");
  const keyBase64 = process.env.BACKUP_ENCRYPTION_KEY;
  if (!keyBase64) throw new Error("Set BACKUP_ENCRYPTION_KEY to the key the backup was made with");

  const info = await readBackupHeader(input);
  console.log(`Backup sealed with key "${info.keyId}"`);
  const partial = `${output}.partial`;
  try {
    await pipeline(
      createReadStream(input, { start: info.dataStart, end: info.dataEnd - 1 }),
      decryptStream(backupKey(keyBase64), info),
      createGunzip(),
      createWriteStream(partial, { mode: 0o600 }),
    );
  } catch (error) {
    await rm(partial, { force: true });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(/auth|authenticate/i.test(message)
      ? "The file was altered or the key is wrong: nothing was written"
      : message);
  }
  await rename(partial, output);
  console.log(`Checked and decrypted: ${output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
