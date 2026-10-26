import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { emailService } from "../../utils/emailService.js";

/**
 * Who should be told that a loading order is waiting.
 *
 * `Authorizers` configures **roles**, not people, and the levels are enforced
 * in order — approving out of turn is refused. So only the level whose turn it
 * is gets the email: telling all four levels at once invites clicks that bounce
 * and teaches people to ignore the mail.
 *
 * Returns the addresses written to, which the caller logs.
 */
export async function notifyLoadingOrderAuthorizers(
  db: PrismaClient,
  loadingOrderId: string,
) {
  const order = await db.loadingOrder.findUnique({
    where: { id: loadingOrderId },
    select: {
      id: true,
      totalQuantity: true,
      authoriserCount: true,
      authorizationStatus: true,
      authorizers: { select: { authorizerId: true } },
      dVehicle: {
        select: {
          driver: { select: { names: true } },
          vechile: { select: { platNumber: true } },
        },
      },
    },
  });
  if (!order || order.authorizationStatus === "approved") return [];

  const configured = await db.authorizers.findMany({
    where: { type: "LOADING_ORDER", status: "active" },
    orderBy: { levels: "asc" },
    select: { id: true, levels: true, roleId: true, role: { select: { name: true } } },
  });
  const approved = new Set(order.authorizers.map((approval) => approval.authorizerId));
  const waiting = configured.filter((config) => !approved.has(config.id));
  if (waiting.length === 0) return [];

  // The lowest level still to approve: everything above it has to wait anyway.
  const turn = waiting[0].levels;
  const theirTurn = waiting.filter((config) => config.levels === turn);

  const people = await db.user.findMany({
    where: {
      isActive: true,
      roleId: { in: theirTurn.map((config) => config.roleId) },
      email: { not: "" },
    },
    select: { email: true, firstName: true, lastName: true, role: { select: { name: true } } },
  });
  if (people.length === 0) return [];

  const facts = {
    orderNumber: order.id.slice(0, 8).toUpperCase(),
    totalQuantity: Number(order.totalQuantity).toLocaleString("en-US"),
    driver: order.dVehicle.driver.names,
    plate: order.dVehicle.vechile.platNumber,
    authorizationLine: `${order.authorizers.length} of ${order.authoriserCount} approvals given — yours is next`,
  };

  const sent: string[] = [];
  for (const person of people) {
    try {
      await emailService.sendLoadingOrderEmail(person.email, person.firstName, facts, {
        subject: `Loading order ${facts.orderNumber} needs your authorization`,
        heading: "A loading order needs your authorization",
        intro:
          `A loading order has been raised for ${facts.driver} (${facts.plate}) and is waiting for ` +
          `${person.role?.name ?? "your role"} to authorize it. It cannot be loaded until every ` +
          "authorizer has approved.",
        actionPath: "/stock-out-orders?tab=loading",
        actionLabel: "Review the loading order",
      });
      sent.push(person.email);
    } catch (error) {
      // One address failing must not stop the others, and must never fail the
      // loading order that was already created.
      console.error(`Could not email ${person.email} about loading order ${facts.orderNumber}:`, error);
    }
  }
  return sent;
}
