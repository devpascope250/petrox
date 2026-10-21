import { loadConfig, type AppConfig } from "./env.js";

/**
 * Central email configuration (Resend), the TypeScript counterpart of the
 * `config/mail_config.php` this project's mail was ported from.
 *
 * Nothing is hard-coded here: every value comes from the environment, so a key
 * never reaches the repository. Get an API key at https://resend.com → API
 * Keys; the `from` domain must be verified in that Resend account.
 */
export interface MailConfig {
  /** Application name, reused as the default sender display name. */
  appName: string;
  /** Public base address of the site, for absolute links in emails. */
  siteUrl: string;
  /**
   * Transport selector:
   * - `log`    — do not send; write the email to the log (local dev)
   * - `resend` — send live email through the Resend API
   */
  transport: "log" | "resend";
  apiKey: string;
  /** Verified sender address. */
  from: string;
  /** Display name shown to recipients; empty sends the bare address. */
  fromName: string;
  /** Optional reply-to address; empty disables it. */
  replyTo: string;
}

export function loadMailConfig(config: AppConfig = loadConfig()): MailConfig {
  return {
    appName: config.COMPANY_NAME,
    siteUrl: config.APP_URL,
    transport: config.MAIL_TRANSPORT,
    apiKey: config.RESEND_API_KEY ?? "",
    from: config.RESEND_FROM ?? config.FROM_EMAIL,
    fromName: config.RESEND_FROM_NAME ?? config.COMPANY_NAME,
    replyTo: config.MAIL_REPLY_TO ?? "",
  };
}
