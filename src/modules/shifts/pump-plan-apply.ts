import type { Prisma } from "../../../prisma/generated/prisma/client.js";

/**
 * Puts the standing arrangements into effect for days just rostered.
 *
 * A plan says who is usually on which pump on a weekday of a shift. Rostering
 * someone is therefore all it takes to put them on their pump: this writes the
 * assignment for each new roster row from the plan that matches its weekday.
 *
 * Nothing is overwritten. A day that already carries that pump is left exactly
 * as it is — a plan fills a day in, it never argues with one somebody arranged
 * by hand. Inactive plans are skipped, which is how an arrangement is
 * suspended without being deleted.
 *
 * Lives on its own so the time table can call it inside its own transaction,
 * without the shifts module's repositories depending on each other.
 */
export async function applyPlans(
  tx: Prisma.TransactionClient,
  rostered: Array<{ id: string; userId: string; siteShiftId: string; days: number }>,
) {
  if (rostered.length === 0) return 0;
  const plans = await tx.pumpAttendantPlan.findMany({
    where: {
      status: "active",
      OR: rostered.map((row) => ({ userId: row.userId, siteShiftId: row.siteShiftId, weekday: row.days })),
    },
    select: { id: true, userId: true, siteShiftId: true, weekday: true, pumpId: true,
      nozzles: { select: { nozzleId: true } } },
  });
  if (plans.length === 0) return 0;

  let written = 0;
  for (const roster of rostered) {
    const theirs = plans.filter((plan) =>
      plan.userId === roster.userId && plan.siteShiftId === roster.siteShiftId && plan.weekday === roster.days);
    for (const plan of theirs) {
      const already = await tx.tblPumpAttendant.findFirst({
        where: { timeTableId: roster.id, pumpId: plan.pumpId }, select: { id: true },
      });
      if (already) continue;
      await tx.tblPumpAttendant.create({
        data: {
          timeTableId: roster.id,
          pumpId: plan.pumpId,
          // Stamped, so applying the plan again changes this row rather than
          // adding beside it — and so the grid can say where it came from.
          fromPlanId: plan.id,
          pumpAttendantNozzles: { create: plan.nozzles.map(({ nozzleId }) => ({ nozzleId })) },
        },
      });
      written += 1;
    }
  }
  return written;
}
