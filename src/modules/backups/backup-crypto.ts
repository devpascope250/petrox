import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { open } from "node:fs/promises";
import { Transform, type TransformCallback } from "node:stream";

/**
 * The backup file format:
 *
 *   "PXBK" | version (1 byte) | key id length (1 byte) | key id | IV (12 bytes)
 *   | AES-256-GCM ciphertext of the gzipped dump | auth tag (16 bytes)
 *
 * The header is authenticated too (as GCM's additional data), so changing the
 * key id or IV is caught as surely as changing the data. A fresh random IV is
 * drawn for every file.
 */
const MAGIC = Buffer.from("PXBK");
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function backupKey(base64: string) {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("The backup key must be 32 bytes, base64-encoded");
  return key;
}

function header(keyId: string, iv: Buffer) {
  const id = Buffer.from(keyId, "utf8");
  return Buffer.concat([MAGIC, Buffer.from([VERSION, id.length]), id, iv]);
}

/** Encrypts what flows through it, writing the header first and the auth tag last. */
export function encryptStream(key: Buffer, keyId: string): Transform {
  const iv = randomBytes(IV_BYTES);
  const head = header(keyId, iv);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(head);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, done: TransformCallback) {
      if (!started) {
        this.push(head);
        started = true;
      }
      done(null, cipher.update(chunk));
    },
    flush(done: TransformCallback) {
      if (!started) this.push(head);
      this.push(cipher.final());
      done(null, cipher.getAuthTag());
    },
  });
}

/** Reads and checks a backup file's header; the key id says which key opens it. */
export async function readBackupHeader(path: string) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const start = Buffer.alloc(6 + 255 + IV_BYTES);
    const { bytesRead } = await file.read(start, 0, start.length, 0);
    const head = start.subarray(0, bytesRead);
    if (bytesRead < 6 || !head.subarray(0, 4).equals(MAGIC)) throw new Error("Not a Petrox backup file");
    if (head[4] !== VERSION) throw new Error(`Unsupported backup format version ${head[4]}`);
    const idLength = head[5];
    const length = 6 + idLength + IV_BYTES;
    if (bytesRead < length || size < length + TAG_BYTES) throw new Error("The backup file is truncated");
    const tag = Buffer.alloc(TAG_BYTES);
    await file.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
    return {
      keyId: head.subarray(6, 6 + idLength).toString("utf8"),
      iv: head.subarray(6 + idLength, length),
      header: Buffer.from(head.subarray(0, length)),
      tag,
      /** Where the ciphertext starts and ends (exclusive) in the file. */
      dataStart: length,
      dataEnd: size - TAG_BYTES,
    };
  } finally {
    await file.close();
  }
}

/**
 * Decrypts the ciphertext of a backup. The stream errors at its very end if
 * the file was altered or the key is wrong, so whatever it wrote must only be
 * kept once it has finished without error.
 */
export function decryptStream(key: Buffer, info: Awaited<ReturnType<typeof readBackupHeader>>) {
  const decipher = createDecipheriv("aes-256-gcm", key, info.iv);
  decipher.setAAD(info.header);
  decipher.setAuthTag(info.tag);
  return decipher;
}
