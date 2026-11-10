import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { currentPeriod, nextDocumentNumber } from "../../shared/numbering/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { itemAvailability } from "./stock-availability.js";
import type {
  AcceptRequisitionSchema,
  CreateRequisitionSchema,
  EditRequisitionSchema,
  RequisitionListQuery,
} from "./requisition.schema.js";

const requisitionSelect = {
  id: true,
  requisitionNo: true,
  siteId: true,
  site: { select: { id: true, name: true } },
  requestedBy: true,
  requester: { select: { id: true, firstName: true, lastName: true } },
  reason: true,
  step: true,
  decidedBy: true,
  decider: { select: { id: true, firstName: true, lastName: true } },
  decidedAt: true,
  createdAt: true,
  updatedAt: true,
  lines: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      itemId: true,
      item: { select: { id: true, name: true } },
      quantity: true,
      approvedQuantity: true,
      loadedQuantity: true,
      receivedQuantity: true,
    },
  },
} satisfies Prisma.RequisitionSelect;

export class RequisitionRepository {
  constructor(public db: PrismaClient) {}

  list(query: RequisitionListQuery, siteId?: string) {
    const where = this.matching(query, siteId);
    return this.db.$transaction([
      this.db.requisition.findMany({
        ...paginationArgs(query),
        where,
        // `createdAt` alone is not a total order, and a batch of requisitions
        // raised in the same second would then repeat across pages.
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: requisitionSelect,
      }),
      this.db.requisition.count({ where }),
    ]);
  }

  /**
   * How many requisitions sit on each rung, for the stepper's header.
   *
   * One grouped query rather than a count per rung, and never the page's own
   * rows: a page of fifteen cannot say how many are waiting.
   */
  async counts(query: RequisitionListQuery, siteId?: string) {
    // The rung is what the header counts, so it is not also a filter here.
    const { step: _ignored, ...rest } = query;
    const rows = await this.db.requisition.groupBy({
      by: ["step"],
      where: this.matching(rest, siteId),
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((row) => [row.step, row._count._all]));
  }

  find(id: string) {
    return this.db.requisition.findUnique({ where: { id }, select: requisitionSelect });
  }

  timeline(requisitionId: string) {
    return this.db.requisitionTimeline.findMany({
      where: { requisitionId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true, step: true, comment: true, fromQuantity: true, toQuantity: true, createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  /** The seeded ladder, so a client draws the stepper from the same source. */
  steps() {
    return this.db.requisitionStep.findMany({
      orderBy: [{ level: "asc" }, { step: "asc" }],
      select: { step: true, level: true, description: true },
    });
  }

  async create(input: CreateRequisitionSchema & { siteId: string; requestedBy: string }) {
    return this.db.$transaction(async (tx) => {
      // Inside the transaction, which is what makes the number gap-free.
      const requisitionNo = await nextDocumentNumber(tx, {
        name: "requisition", period: currentPeriod(), prefix: "REQ",
      });
      const requisition = await tx.requisition.create({
        data: {
          requisitionNo,
          siteId: input.siteId,
          requestedBy: input.requestedBy,
          reason: input.reason ?? null,
          step: "submitted",
          lines: { create: input.lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity })) },
        },
        select: requisitionSelect,
      });
      await tx.requisitionTimeline.create({
        data: {
          requisitionId: requisition.id, step: "submitted", changedBy: input.requestedBy,
          comment: input.reason ?? null,
          toQuantity: input.lines.reduce((sum, line) => sum + line.quantity, 0),
        },
      });
      return requisition;
    });
  }

  /**
   * Accepts it, cutting any line the decision reduced.
   *
   * A line left out of the decision is accepted as asked. A cut above what was
   * asked is refused: granting more than a station requested is a new request,
   * not a decision on this one.
   */
  async accept(id: string, input: AcceptRequisitionSchema, actedBy: string) {
    return this.db.$transaction(async (tx) => {
      const current = await this.decidable(tx, id, ["submitted"]);
      const cuts = new Map((input.lines ?? []).map((line) => [line.id, line.approvedQuantity]));
      for (const [lineId] of cuts) {
        if (!current.lines.some((line) => line.id === lineId)) {
          throw new NotFoundError("Requisition line");
        }
      }
      /*
       * Nothing is granted that the cleared stock cannot serve.
       *
       * Checked here, inside the transaction that accepts, and against what
       * other requisitions have already been promised — not only against what
       * is physically there. Accepting does not reserve the litres (they are
       * committed when a load is built), so this figure is the only thing
       * standing between two stations being told yes for the same fuel.
       */
      const availability = await itemAvailability(
        tx, current.lines.map((line) => line.itemId), id);
      for (const line of current.lines) {
        const approved = cuts.get(line.id) ?? Number(line.quantity);
        if (approved > Number(line.quantity)) {
          throw new BusinessError("REQUISITION_OVER_GRANT",
            `${line.item.name}: ${approved} is more than the ${line.quantity} asked for`);
        }
        const stock = availability.get(line.itemId)!;
        if (approved > stock.available) {
          throw new BusinessError("REQUISITION_STOCK_SHORT",
            `${line.item.name}: only ${stock.available.toLocaleString()} of cleared stock is free — ` +
            `${stock.cleared.toLocaleString()} cleared, ${stock.drawn.toLocaleString()} already drawn, ` +
            `${stock.promised.toLocaleString()} promised to other requisitions`);
        }
        await tx.requisitionLine.update({ where: { id: line.id }, data: { approvedQuantity: approved } });
      }
      await tx.requisitionTimeline.create({
        data: {
          requisitionId: id, step: "accepted", changedBy: actedBy, comment: input.comment ?? null,
          fromQuantity: current.lines.reduce((sum, line) => sum + Number(line.quantity), 0),
          toQuantity: current.lines.reduce(
            (sum, line) => sum + (cuts.get(line.id) ?? Number(line.quantity)), 0),
        },
      });
      return tx.requisition.update({
        where: { id },
        data: { step: "accepted", decidedBy: actedBy, decidedAt: new Date() },
        select: requisitionSelect,
      });
    });
  }

  /** Refused outright, or handed back to the station to change a quantity. */
  async decide(
    id: string,
    step: "rejected" | "cancelled" | "changeRequested",
    comment: string,
    actedBy: string,
  ) {
    return this.db.$transaction(async (tx) => {
      // A requisition already accepted is being served: refusing it then would
      // leave loaded litres pointing at a refused request.
      const from: Array<"submitted" | "changeRequested" | "accepted"> =
        step === "changeRequested" ? ["submitted"] : ["submitted", "changeRequested"];
      const current = await this.decidable(tx, id, from);
      await tx.requisitionTimeline.create({
        data: {
          requisitionId: id, step, changedBy: actedBy, comment,
          fromQuantity: current.lines.reduce((sum, line) => sum + Number(line.quantity), 0),
        },
      });
      return tx.requisition.update({
        where: { id },
        data: {
          step,
          // Handing it back is not a decision: it stays undecided until the
          // station has changed it and it comes round again.
          ...(step === "changeRequested" ? {} : { decidedBy: actedBy, decidedAt: new Date() }),
        },
        select: requisitionSelect,
      });
    });
  }

  /**
   * The station's new figures, allowed only while it was handed back.
   *
   * Saving returns it to `submitted`: the point of handing it back is that the
   * person who asked owns the request, and head office decides again afterwards.
   */
  async edit(id: string, input: EditRequisitionSchema, actedBy: string) {
    return this.db.$transaction(async (tx) => {
      const current = await this.decidable(tx, id, ["changeRequested"]);
      const was = current.lines.reduce((sum, line) => sum + Number(line.quantity), 0);
      for (const line of input.lines) {
        const existing = current.lines.find((row) => row.id === line.id);
        if (!existing) throw new NotFoundError("Requisition line");
        await tx.requisitionLine.update({
          where: { id: line.id },
          // The approved figure is cleared: it belonged to a decision that is
          // no longer the request being decided.
          data: { quantity: line.quantity, approvedQuantity: null },
        });
      }
      const now = await tx.requisitionLine.findMany({
        where: { requisitionId: id }, select: { quantity: true },
      });
      const becomes = now.reduce((sum, line) => sum + Number(line.quantity), 0);
      if (becomes === was) throw new BusinessError("REQUISITION_UNCHANGED", "The quantities are unchanged");
      await tx.requisitionTimeline.create({
        data: {
          requisitionId: id, step: "submitted", changedBy: actedBy,
          comment: input.comment ?? null, fromQuantity: was, toQuantity: becomes,
        },
      });
      return tx.requisition.update({
        where: { id },
        data: { step: "submitted", ...(input.reason === undefined ? {} : { reason: input.reason }) },
        select: requisitionSelect,
      });
    });
  }

  /**
   * What the cleared stock can still serve, for each product on a requisition.
   *
   * Read before deciding, so whoever accepts sees the figure rather than
   * discovering it as a refusal. The same calculation the decision itself
   * applies, so the two cannot disagree.
   */
  async availability(id: string) {
    const lines = await this.db.requisitionLine.findMany({
      where: { requisitionId: id },
      select: { id: true, itemId: true, quantity: true, approvedQuantity: true, item: { select: { name: true } } },
    });
    if (lines.length === 0) throw new NotFoundError("Requisition");
    const stock = await itemAvailability(this.db, lines.map((line) => line.itemId), id);
    return lines.map((line) => ({
      lineId: line.id,
      itemName: line.item.name,
      asked: Number(line.quantity),
      ...stock.get(line.itemId)!,
      /** Whether what was asked for can be granted in full right now. */
      canGrantInFull: Number(line.quantity) <= stock.get(line.itemId)!.available,
    }));
  }

  /**
   * The loads carrying this requisition, with their authorization standing.
   *
   * A load is authorized by a ladder of roles — the same `Authorizers` a
   * loading order has always used — and it cannot be received until every
   * active one has signed. Shown here so the station watching its requisition
   * can see what it is waiting for, and whoever may sign can sign from the
   * same screen.
   */
  async loads(requisitionId: string) {
    const loads = await this.db.loadingOrder.findMany({
      where: { loadedOrders: { some: { order: { requisitionLine: { requisitionId } } } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true, totalQuantity: true, status: true, authorizationStatus: true,
        authoriserCount: true, createdAt: true,
        dVehicle: { select: {
          vechile: { select: { platNumber: true, truckNumber: true } },
          driver: { select: { names: true, phone: true } },
        } },
        authorizers: { orderBy: { createdAt: "asc" }, select: {
          id: true, signedName: true, createdAt: true,
          authorizer: { select: { levels: true, role: { select: { id: true, name: true } } } },
        } },
        loadedOrders: {
          where: { order: { requisitionLine: { requisitionId } } },
          select: { quantity: true, order: { select: { requisitionLineId: true } } },
        },
        orderReceptions: { select: {
          id: true, receivedQty: true, createdAt: true, comment: true,
          cuve: { select: { id: true, name: true } },
        } },
      },
    });
    // How many signatures a load still needs, from the live configuration
    // rather than the count stored when it was raised.
    const required = await this.db.authorizers.count({
      where: { type: "LOADING_ORDER", status: "active" },
    });
    return loads.map((load) => ({
      ...load,
      approval: {
        approved: load.authorizers.length,
        required,
        /** The roles that have not signed yet, so the wait has a name. */
        outstanding: Math.max(0, required - load.authorizers.length),
      },
    }));
  }

  /** One requisition, for a caller that must check whose station it is. */
  owner(id: string) {
    return this.db.requisition.findUnique({
      where: { id },
      select: { id: true, siteId: true, requestedBy: true, step: true },
    });
  }

  /** The rung it is on now, refusing the move if it cannot be made from there. */
  private async decidable(
    tx: Prisma.TransactionClient,
    id: string,
    from: ReadonlyArray<"submitted" | "changeRequested" | "accepted">,
  ) {
    const current = await tx.requisition.findUnique({
      where: { id },
      select: { id: true, step: true, lines: {
        select: { id: true, itemId: true, quantity: true, item: { select: { name: true } } } } },
    });
    if (!current) throw new NotFoundError("Requisition");
    if (!from.includes(current.step as (typeof from)[number])) {
      throw new BusinessError("REQUISITION_STEP",
        `A ${current.step} requisition cannot be moved this way`);
    }
    return current;
  }

  private matching(query: Omit<RequisitionListQuery, "step"> & { step?: RequisitionListQuery["step"] }, siteId?: string): Prisma.RequisitionWhereInput {
    const term = query.search?.trim();
    return {
      // A station manager's own station wins over anything the request asked
      // for, so a crafted query cannot read another station's requisitions.
      ...(siteId ? { siteId } : query.siteId ? { siteId: query.siteId } : {}),
      ...(query.step ? { step: query.step } : {}),
      ...(query.itemId ? { lines: { some: { itemId: query.itemId } } } : {}),
      ...(query.startDate || query.endDate
        ? { createdAt: { ...(query.startDate && { gte: query.startDate }), ...(query.endDate && { lte: query.endDate }) } }
        : {}),
      ...(term
        ? {
            OR: [
              { requisitionNo: { contains: term } },
              { reason: { contains: term } },
              { site: { is: { name: { contains: term } } } },
              { lines: { some: { item: { is: { name: { contains: term } } } } } },
              { requester: { is: { firstName: { contains: term } } } },
              { requester: { is: { lastName: { contains: term } } } },
            ],
          }
        : {}),
    };
  }
}
