import { describe, expect, it, vi } from "vitest";
import { furthestStage, recordStage } from "../src/modules/nominations/nomination-stage.js";

const LADDER = [
  { status: "awaiting", level: 1 },
  { status: "underLoading", level: 2 },
  { status: "t1Pending", level: 3 },
  { status: "t1Confirmed", level: 4 },
  { status: "inTransit", level: 5 },
  { status: "stockReceived", level: 6 },
];

/** A timeline holding one trip, already at `reached`. */
function ladderDb(reached: string | null) {
  const current = LADDER.find((stage) => stage.status === reached) ?? null;
  return {
    nominationTimeLineStatus: {
      findFirst: vi.fn(({ where }: any) => {
        const stage = LADDER.find((s) => s.status === where.status);
        return stage ? { id: `stage-${stage.level}`, ...stage } : null;
      }),
    },
    nominationTimeLine: {
      findFirst: vi.fn(() => (current ? { timeLineStatus: current } : null)),
      create: vi.fn((args: any) => args.data),
    },
  };
}

describe("recording a stage", () => {
  it("writes one the trip has not reached", async () => {
    const tx = ladderDb("awaiting");
    expect(await recordStage(tx as never, "nom-1", "underLoading", "user-1")).toMatchObject({
      status: "underLoading",
      level: 2,
    });
    expect(tx.nominationTimeLine.create).toHaveBeenCalledWith({
      data: { nominationId: "nom-1", timeLineStatusId: "stage-2", changedBy: "user-1" },
    });
  });

  it("writes the first stage of a trip with no history", async () => {
    const tx = ladderDb(null);
    expect(await recordStage(tx as never, "nom-1", "awaiting")).toMatchObject({ level: 1 });
    expect(tx.nominationTimeLine.create).toHaveBeenCalledOnce();
  });

  it("refuses to drag a trip back down the ladder", async () => {
    // The bug this exists for: a level 2 entry stamped after level 4, which
    // reads as nonsense however the history is sorted.
    const tx = ladderDb("t1Confirmed");
    expect(await recordStage(tx as never, "nom-1", "underLoading")).toBeNull();
    expect(tx.nominationTimeLine.create).not.toHaveBeenCalled();
  });

  it("records a stage once, however many times it is reached", async () => {
    const tx = ladderDb("inTransit");
    expect(await recordStage(tx as never, "nom-1", "inTransit")).toBeNull();
    expect(tx.nominationTimeLine.create).not.toHaveBeenCalled();
  });

  it("says so when the ladder itself is missing a rung", async () => {
    const tx = ladderDb("awaiting");
    tx.nominationTimeLineStatus.findFirst = vi.fn().mockReturnValue(null);
    await expect(recordStage(tx as never, "nom-1", "inTransit")).rejects.toMatchObject({
      code: "STAGE_MISSING",
    });
  });

  it("reads the furthest stage by level, not by when it was written", async () => {
    const tx = ladderDb("t1Confirmed");
    expect(await furthestStage(tx as never, "nom-1")).toEqual({ status: "t1Confirmed", level: 4 });
    expect(tx.nominationTimeLine.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { timeLineStatus: { level: "desc" } } }),
    );
  });
});
