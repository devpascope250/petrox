import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DEV_EMAIL: z.email(),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  PIN_HMAC_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** POS devices: the longest a provisioning key may live, and how long a device's refresh token lasts. */
  MOBILE_PROVISIONING_KEY_MAX_MINUTES: z.coerce.number().int().positive().max(1440).default(30),
  MOBILE_DEVICE_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(90),
  /** A POS sale still initiated after this many minutes is cancelled, and its card freed. */
  MOBILE_SALE_TIMEOUT_MINUTES: z.coerce.number().int().positive().max(1440).default(10),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  /** Public base address of the server, put in front of `/uploads/…` paths sent to the POS. */
  STATIC_URL: z.url().optional().transform((value) => value?.replace(/\/+$/, "")),

  /**
   * Database backups. Without BACKUP_ENCRYPTION_KEY (32 random bytes, base64:
   * `openssl rand -base64 32`) backups are switched off. Keep a copy of the key
   * off the server: without it no backup can be read.
   */
  BACKUP_ENCRYPTION_KEY: z.string().trim().optional()
    .refine((value) => !value || Buffer.from(value, "base64").length === 32,
      "BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)"),
  /** Names the key in each backup's header, so a changed key can still be told apart. */
  BACKUP_KEY_ID: z.string().trim().regex(/^[A-Za-z0-9._-]{1,32}$/).default("k1"),
  /** Where backup files go. Never inside `uploads/`, which is served publicly. */
  BACKUP_DIR: z.string().trim().default("backups"),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().max(365).default(14),
  /** Rwanda time ("HH:mm") of the nightly backup; empty switches it off. */
  BACKUP_DAILY_AT: z.string().trim().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm").default("02:00"),
  MYSQLDUMP_PATH: z.string().trim().default("mysqldump"),
  /** The largest backup that may be uploaded to be decrypted on the web. */
  BACKUP_DECRYPT_MAX_MB: z.coerce.number().int().positive().max(4096).default(512),

  SMTP_HOST: z.string().min(5),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().min(3),
  SMTP_PASS: z.string().min(3),
  COMPANY_NAME: z.string().min(1).trim(),
  COMPANY_ADDRESS: z.string().default('123 Business St, City, State 12345'),
  APP_URL: z.url(),
  FRONTEND_URL: z.url(),
  PRIVACY_POLICY_URL: z.url(),
  TERMS_URL: z.url(),
  SUPPORT_URL: z.url(),
  FROM_EMAIL: z.email(),
  TWITTER_URL: z.url(),
  FACEBOOK_URL: z.url(),
  LINKEDIN_URL: z.url(),
});

export type AppConfig = z.infer<typeof schema>;
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(source);
}
