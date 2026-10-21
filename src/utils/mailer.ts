import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadMailConfig, type MailConfig } from "../config/mail_config.js";

/**
 * Reusable mailer built on the Resend HTTP API — the TypeScript port of
 * `config/mailer.php`.
 *
 *     import { sendMail } from "../utils/mailer.js";
 *     await sendMail({ to, subject, html });
 *
 * Resolves to `true` when the mail was accepted, `false` otherwise. A failure
 * is logged with Resend's own error, so the caller can stay simple.
 */
export interface MailAttachment {
  /** Absolute path of the file to attach. Unreadable files are skipped and logged. */
  path: string;
  /** Name the recipient sees; the file's own name when left out. */
  filename?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** Overrides the configured sender; takes `"Display Name <a@b>"` or a bare address. */
  from?: string;
  attachments?: MailAttachment[];
}

interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  reply_to?: string;
  attachments?: { filename: string; content: string }[];
}

/** `"Display Name <address>"`, or the bare address when there is no name. */
function senderOf(config: MailConfig) {
  return config.fromName !== ""
    ? `${config.fromName} <${config.from}>`
    : config.from;
}

/** Resend takes attachments inline, base64-encoded. */
async function encodeAttachments(attachments: MailAttachment[]) {
  const encoded: { filename: string; content: string }[] = [];
  for (const attachment of attachments) {
    if (!attachment.path) continue;
    try {
      const content = await readFile(attachment.path);
      encoded.push({
        filename: attachment.filename ?? path.basename(attachment.path),
        content: content.toString("base64"),
      });
    } catch {
      console.error(
        `Resend mailer: attachment not readable, skipped: ${attachment.path}`,
      );
    }
  }
  return encoded;
}

export async function sendMail(
  message: MailMessage,
  config: MailConfig = loadMailConfig(),
): Promise<boolean> {
  const from = message.from ?? senderOf(config);

  // Local-dev transport: don't actually send, just log the message.
  if (config.transport === "log") {
    console.info(
      `[MAIL:log] To: ${message.to} | Subject: ${message.subject} | From: ${from}`,
    );
    return true;
  }

  if (config.apiKey === "" || config.apiKey.includes("xxxx")) {
    console.error("Resend mailer: RESEND_API_KEY is not configured");
    return false;
  }

  const payload: ResendPayload = {
    from,
    to: [message.to],
    subject: message.subject,
    html: message.html,
  };
  if (config.replyTo !== "") payload.reply_to = config.replyTo;
  if (message.attachments?.length) {
    const attachments = await encodeAttachments(message.attachments);
    if (attachments.length) payload.attachments = attachments;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    // Resend answers 200/201 with an `{ "id": … }` on success.
    if (response.ok) return true;
    console.error(
      `Resend mailer failed (HTTP ${response.status}): ${await response.text()}`,
    );
    return false;
  } catch (error) {
    console.error("Resend mailer failed:", error);
    return false;
  }
}
