import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { emailService } from "../../utils/emailService.js";

const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Tells the clearance authorizers that one is waiting for them.
 *
 * Everybody active is written to at once, not one level at a time as loading
 * orders do: a clearance needs all of them and they may decide in any order,
 * so there is no turn to wait for.
 *
 * Returns the addresses written to, which the caller logs.
 */
export async function notifyClearanceAuthorizers(db: PrismaClient, requestId: string) {
  const request = await db.clearanceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true, quantity: true, fees: true, amount: true, paymentDocUrl: true,
      item: { select: { name: true } },
      agent: { select: { names: true } },
      user: { select: { firstName: true, lastName: true } },
      taxes: { orderBy: { createdAt: "asc" }, select: { code: true, amount: true } },
      approvals: { select: { authorizerId: true, status: true } },
    },
  });
  if (!request || request.paymentDocUrl) return [];

  const members = await db.clearanceAuthorizerMember.findMany({
    where: { status: "active" },
    orderBy: [{ level: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, position: true,
      authoriser: { select: { firstName: true, email: true, isActive: true } },
    },
  });
  const decided = new Set(request.approvals
    .filter((approval) => approval.status === "approved")
    .map((approval) => approval.authorizerId));
  const waiting = members.filter((member) =>
    !decided.has(member.id) && member.authoriser.isActive && member.authoriser.email);
  if (waiting.length === 0) return [];

  const reference = request.id.slice(0, 8).toUpperCase();
  const facts = {
    reference,
    item: request.item.name,
    quantity: Number(request.quantity).toLocaleString("en-US"),
    agent: request.agent?.names ?? "—",
    raisedBy: `${request.user.firstName} ${request.user.lastName}`.trim(),
    fees: request.fees === null ? null : money(request.fees),
    taxes: request.taxes.map((tax) => ({ code: tax.code, amount: money(tax.amount) })),
    taxTotal: money(request.amount),
    grandTotal: money(Number(request.amount) + Number(request.fees ?? 0)),
  };

  const sent: string[] = [];
  for (const member of waiting) {
    try {
      await emailService.sendClearanceApprovalEmail(member.authoriser.email, member.authoriser.firstName, facts, {
        subject: `Stock clearance ${reference} needs your approval`,
        intro:
          `${facts.raisedBy} has raised a clearance of ${facts.quantity} L of ${facts.item}. ` +
          "The stock stays uncleared, and the payment cannot be confirmed, until every authorizer has " +
          "approved it. The taxes it is assessed on are listed below.",
        // A path, not a query: after a login the site returns to the path it
        // was sent to, so the clearance has to be in the path itself.
        actionPath: `/clearance-approvals/${request.id}`,
        position: member.position,
      });
      sent.push(member.authoriser.email);
    } catch (error) {
      // One address failing must not stop the others, and must never fail a
      // clearance that is already raised.
      console.error(`Could not email ${member.authoriser.email} about clearance ${reference}:`, error);
    }
  }
  return sent;
}
