# Database backups

Encrypted copies of the whole MySQL database, made on request from the web
(**General Settings → System Settings → Backups**) and every night.

## How it works

1. `POST /api/v1/backups` (permission `backups.create`) adds a `queued` row to the
   `Backup` table. Only one backup can be queued or running at a time.
2. A worker inside the API checks every 5 seconds, claims the oldest queued row
   (`queued → running`) and runs `mysqldump` → gzip → AES-256-GCM into a file in
   `BACKUP_DIR`, streamed end to end. The row becomes `completed` (with size and
   SHA-256), or `failed` with the reason. The person who asked gets an email.
3. Every night at `BACKUP_DAILY_AT` (Rwanda time) a `scheduled` backup is queued.
   If the server was down at that time it is made as soon as the server is back.
4. Files are deleted after `BACKUP_RETENTION_DAYS`; the row stays (`expired`) as
   the record of who made and downloaded it. `DELETE /api/v1/backups/:id`
   deletes a file early.
5. `GET /api/v1/backups/:id/download` (permission `backups.read`) returns the
   **encrypted** file and records who fetched it. Its SHA-256 is in the list and
   in the `X-Backup-Sha256` header.

Rows left `running` when the API stops are marked `failed` when it starts again.

## Setting up a server

1. Install the MySQL client tools (`mysqldump`), e.g. `sudo apt install mysql-client`.
2. The database user needs `SELECT`, `SHOW VIEW`, `TRIGGER`, `EVENT` and
   `LOCK TABLES` on the database (`ALL PRIVILEGES` on it covers them).
3. Generate the key **once** and keep a copy somewhere other than the server
   (a password manager): without it, no backup can ever be read.

   ```bash
   openssl rand -base64 32
   ```

4. Add to the server's `.env`, then restart the API:

   ```env
   BACKUP_ENCRYPTION_KEY=<the key>
   BACKUP_KEY_ID=k1
   BACKUP_DIR=/home/ikwim-api/backups      # outside the clone, never inside uploads/
   BACKUP_RETENTION_DAYS=14
   BACKUP_DAILY_AT=02:00                    # empty switches the nightly backup off
   ```

5. Run the seed so the Backups module and its permissions exist
   (`backups.read`, `backups.create`, `backups.delete`; System Administrator holds all).

Without `BACKUP_ENCRYPTION_KEY`, backups are off and requesting one answers
`503 BACKUPS_NOT_CONFIGURED`.

## File format

`PXBK` · version · key id · 12-byte random IV · AES-256-GCM ciphertext of the
gzipped dump · 16-byte authentication tag. The header is authenticated too, so
any change to the file — or the wrong key — is detected and nothing is written.

## Opening and restoring a backup

**On the web:** Backups → **Decrypt a backup** (permission `backups.manage`,
which only System Administrator holds). Upload the `.sql.gz.enc` file and paste
its key; you get the plain dump back as `.sql.gz`. Behind it is
`POST /api/v1/backups/decrypt` (multipart: `backup` file + `key` field):

- the permission alone is not enough — the key must be sent too, and it is
  never stored or logged (the server logs who decrypted which key id);
- the upload is checked in full before anything is returned, so a wrong key
  (`422 BACKUP_KEY_OR_FILE_INVALID`) or a damaged file never gives part of a
  database; a file that is not a backup gets `400 NOT_A_BACKUP`;
- uploads are limited to `BACKUP_DECRYPT_MAX_MB` (default 512; larger gets
  `413 BACKUP_TOO_LARGE`) and 10 an hour; temporary files are deleted as soon
  as the response ends.

**On the command line**, on a trusted machine with this repository:

```bash
BACKUP_ENCRYPTION_KEY='<the key the backup was made with>' \
  pnpm backup:decrypt petrox-20261015-020000-1a2b3c4d.sql.gz.enc restored.sql
```

The script checks the whole file before keeping any output. Restoring is a
deliberate, manual step — there is no restore button:

```bash
mysql -u <user> -p <database> < restored.sql
```

Restore into a scratch database first to check it, and delete `restored.sql`
(or the `.sql.gz` from the web) afterwards: it is not encrypted.

## Changing the key

Set a new `BACKUP_ENCRYPTION_KEY` **and** a new `BACKUP_KEY_ID` (e.g. `k2`). New
backups name `k2` in their header; older ones still name `k1` and need the old
key, so keep it until the last `k1` backup has expired.

## Keep a copy off the server

Backups that live only on the server are lost with it. Download one regularly
(e.g. weekly) and keep it elsewhere; it stays encrypted until someone with the
key opens it.
