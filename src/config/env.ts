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
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  SMTP_HOST: z.string().min(5),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().min(3),
  SMTP_PASS: z.string().min(3),
  COMPANY_NAME: z.string().min(1).trim(),
  COMPANY_ADDRESS: z.string().default('123 Business St, City, State 12345'),
  APP_URL: z.url(),
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
