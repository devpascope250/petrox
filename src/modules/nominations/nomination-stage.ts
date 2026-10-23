import type { Prisma } from "../../../prisma/generated/prisma/client.js";
import type { TimeLineStatus } from "../../../prisma/generated/prisma/enums.js";
import { BusinessError } from "../../utils/errors.js";

type Tx = Prisma.TransactionClient;

/**
 * The stages a trip climbs, in order. Nothing reads these numbers directly —
 * they live on `NominationTimeLineStatus.level` — but recording a stage has to
 * know whether the trip is already past it.
 */
export async function furthestStage(tx: Tx, nominationId: string) {
  const entry = await tx.nominationTimeLine.findFirst({
    where: { nominationId },
    orderBy: { timeLineStatus: { level: "desc" } },
    select: { timeLineStatus: { select: { status: true, level: true } } },
  });
  return entry?.timeLineStatus ?? null;
}

/**
 * Records that a trip reached a stage — once, and only if it has not already
 * passed it.
 *
 * The ladder is a ladder: a trip that has had its T1 confirmed cannot later be
 * "loading in progress". Writing stages straight into the timeline let that
 * happen, and a history with a level 2 entry stamped after level 4 reads as
 * nonsense however it is sorted. So every stage is recorded through here, and a
 * stage already reached or already overtaken is skipped rather than written.
 *
 * Returns the stage recorded, or `null` when there was nothing to record.
 */
export async function recordStage(
  tx: Tx,
  nominationId: string,
  status: TimeLineStatus,
  changedBy?: string | null,
) {
  const stage = await tx.nominationTimeLineStatus.findFirst({
    where: { status },
    select: { id: true, level: true, status: true },
  });
  if (!stage) {
    throw new BusinessError(
      "STAGE_MISSING",
      `The "${status}" stage is not set up. Run the database migrations and the seed.`,
    );
  }

  const furthest = await furthestStage(tx, nominationId);
  // Already here, or already past it: the history keeps what it has.
  if (furthest && furthest.level >= stage.level) return null;

  await tx.nominationTimeLine.create({
    data: { nominationId, timeLineStatusId: stage.id, changedBy: changedBy ?? null },
  });
  return stage;
}
