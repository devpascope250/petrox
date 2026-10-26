import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError } from "../../utils/errors.js";
import { emailService } from "../../utils/emailService.js";
import {
  loadingOrderFileName,
  loadingOrderForDocument,
  renderLoadingOrderPdf,
  type DocumentCompany,
} from "./loading-order-document.js";

/**
 * Who to send a signed loading order to.
 *
 * Addresses come in as one comma-separated line, because that is how people
 * paste them. Split and de-duplicated here rather than in the client, so the
 * API cannot be handed a list that looks different from what was typed.
 */
export const shareLoadingOrderSchema = z.object({
  recipients: z
    .string()
    .trim()
    .min(3, "Enter at least one email address")
    .transform((value) =>
      Array.from(
        new Set(
          value
            .split(/[,;\s]+/)
            .map((address) => address.trim().toLowerCase())
            .filter(Boolean),
        ),
      ),
    )
    .pipe(
      z
        .array(z.email("One of the addresses is not valid"))
        .min(1, "Enter at least one email address")
        .max(20, "Twenty addresses at a time"),
    ),
  /** A note printed above the document in the email. */
  message: z.string().trim().max(1000).optional(),
});

export type ShareLoadingOrderSchema = z.infer<typeof shareLoadingOrderSchema>;

/**
 * Emails a loading order's PDF to the addresses given.
 *
 * Only once every authoriser has approved: an unsigned order is a working
 * paper, and sending it outside the company invites it to be treated as an
 * instruction to load. Each send is recorded — who shared it, with whom, and
 * whether it arrived — because the document leaves the company.
 */
export async function shareLoadingOrder(
  db: PrismaClient,
  loadingOrderId: string,
  input: ShareLoadingOrderSchema,
  sharedBy: string,
  company: DocumentCompany,
) {
  const order = await loadingOrderForDocument(db, loadingOrderId);
  if (order.authorizationStatus !== "approved") {
    throw new BusinessError(
      "NOT_AUTHORIZED_YET",
      `This loading order has ${order.authorizers.length} of ${order.authoriserCount} approvals. ` +
        "It can be shared once every authorizer has approved.",
    );
  }

  const share = await db.loadingOrderShare.create({
    data: {
      loadingOrderId,
      recipients: input.recipients.join(", "),
      message: input.message ?? null,
      sharedBy,
    },
    select: { id: true, recipients: true, message: true, createdAt: true },
  });

  const pdf = await renderLoadingOrderPdf(order, company);
  const filename = loadingOrderFileName(order);
  // Written to a temporary file because the mailer attaches by path; removed
  // whatever happens, so a shared document leaves nothing behind on the server.
  const directory = await mkdtemp(path.join(tmpdir(), "petrox-loading-order-"));
  const file = path.join(directory, filename);
  await writeFile(file, pdf);

  const facts = {
    orderNumber: order.id.slice(0, 8).toUpperCase(),
    totalQuantity: Number(order.totalQuantity).toLocaleString("en-US"),
    driver: order.dVehicle.driver.names,
    plate: order.dVehicle.vechile.platNumber,
    authorizationLine: `Authorized by ${order.authorizers.length} of ${order.authoriserCount}`,
  };

  const failures: string[] = [];
  try {
    for (const recipient of input.recipients) {
      try {
        await emailService.sendLoadingOrderEmail(recipient, "there", facts, {
          subject: `Loading order ${facts.orderNumber} — ${company.name}`,
          heading: "Loading order",
          intro:
            `${company.name} has shared a loading order for ${facts.driver} (${facts.plate}), ` +
            `${facts.totalQuantity} L in total. It is authorized and attached below.`,
          message: input.message ?? null,
          attachment: { path: file, filename },
        });
      } catch (error) {
        failures.push(recipient);
        console.error(`Could not share loading order ${facts.orderNumber} with ${recipient}:`, error);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const sentAll = failures.length === 0;
  await db.loadingOrderShare.update({
    where: { id: share.id },
    data: {
      sentAt: sentAll ? new Date() : null,
      failedReason: sentAll ? null : `Could not send to ${failures.join(", ")}`,
    },
  });
  if (!sentAll && failures.length === input.recipients.length) {
    throw new BusinessError(
      "SHARE_FAILED",
      "The document could not be emailed. Check the mail settings and try again.",
    );
  }

  return {
    id: share.id,
    recipients: input.recipients,
    failed: failures,
    sharedAt: new Date().toISOString(),
    fileName: filename,
  };
}

/** Every time this loading order has been sent out, newest first. */
export function loadingOrderShares(db: PrismaClient, loadingOrderId: string) {
  return db.loadingOrderShare.findMany({
    where: { loadingOrderId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, recipients: true, message: true, sentAt: true, failedReason: true, createdAt: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}
