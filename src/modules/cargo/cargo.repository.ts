import type { CargoStatus, Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { generatePfiCode } from "../../utils/randomCodegen.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { cargoMovement } from "./cargo-movement.js";
import type { CargoListQuery, CreateCargoSchema, ReturnCargoSchema } from "./cargo.schema.js";

/**
 * Cargo statuses whose litres are no longer the order's.
 *
 * A cancelled shipment never arrived; a returned one went back; a replaced one
 * went back and another came instead. None of them occupies the order any
 * more, so a replacement for a 200,000 L shipment fits a 200,000 L order.
 */
const NOT_AGAINST_THE_ORDER = ["cancelled", "returned", "replaced"] as const;

/** What the return record and the chain need, wherever a cargo is read. */
const returnSelect = {
  orderBy: { createdAt: "desc" },
  select: {
    id: true, kind: true, reason: true, quantityInLitre: true, quantityInKg: true,
    refundAmount: true, currencyCode: true, supportingDocUrl: true, createdAt: true,
    user: { select: { id: true, firstName: true, lastName: true } },
    replacementCargo: {
      select: { id: true, blRef: true, vesselName: true, status: true, quantityInLitre: true },
    },
  },
} satisfies Prisma.Cargo$returnsArgs;
export class CargoRepository {
  constructor(private db: PrismaClient) {}
  /**
   * One page of the cargo list with the total behind it. Cargo accumulates for
   * as long as the company imports, so the whole list is never returned.
   */
  async list(query: CargoListQuery) {
    const { startDate, endDate, status, orderId, deportId, search } = query;
    const where: Prisma.CargoWhereInput = {
      ...(startDate || endDate
        ? { receivedDate: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } }
        : {}),
      ...(status ? { status } : {}),
      ...(orderId ? { orderId } : {}),
      ...(deportId ? { deportId } : {}),
      ...(search
        ? {
            OR: [
              { blRef: { contains: search } },
              { tansisRef: { contains: search } },
              { outurnRef: { contains: search } },
              { vesselName: { contains: search } },
            ],
          }
        : {}),
    };
    return this.db.$transaction([
      this.db.cargo.findMany({
      where,
      ...paginationArgs(query),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        blRef: true,
        createdAt: true,
        quantityInKg: true,
        quantityInLitre: true,
        outurnRef: true,
        receivedDate: true,
        expirationDate: true,
        supportingDocUrl: true,
        tansisRef: true,
        vesselName: true,
        order: true,
        deport: true,
        stocks: {
          select: {
            id: true,
            item: true,
            quantity: true,
            receivedDate: true,
            status: true,
            itemId: true
          }
        },
        cargoInvoices: true,
        // What became of it, and the shipment that came instead.
        returns: returnSelect,
        replacementFor: {
          select: {
            id: true, kind: true, reason: true, createdAt: true,
            cargo: { select: { id: true, blRef: true, vesselName: true, quantityInLitre: true } },
          },
        },
        // What its drawer lists beside the invoices.
        pfis: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, pifCode: true, pfiReference: true, currancyCode: true,
            unitPrice: true, amount: true, supportingDocUrl: true, createdAt: true,
            currency: { select: { id: true, code: true, name: true } },
          },
        },
      },
    }),
      this.db.cargo.count({ where }),
    ]);
  }

  /**
   * A shipment cannot carry more than its order still has unaccounted for.
   *
   * `exclude` drops a cargo's own litres from the running total, so re-saving
   * one is not refused by the volume it already holds — and a cancelled,
   * returned or replaced shipment is not counted at all, which is what lets a
   * replacement be raised against a fully delivered order.
   */
  private async assertWithinOrder(orderId: string, quantityInLitre: number, exclude?: string) {
    const order = await this.db.order.findUnique({
      where: { id: orderId },
      select: {
        quantity: true,
        cargos: { select: { id: true, status: true, quantityInLitre: true } },
      },
    });
    if (!order) throw new NotFoundError("Order");
    const ordered = Number(order.quantity);
    const already = order.cargos.reduce((total, cargo) =>
      cargo.id === exclude || NOT_AGAINST_THE_ORDER.includes(cargo.status as never)
        ? total
        : total + Number(cargo.quantityInLitre), 0);
    if (quantityInLitre + already > ordered) {
      const free = Math.max(0, ordered - already);
      throw new BusinessError("400",
        `The Cargo Quantities must be less than or equal to ordered quanties. `
        + `This order has ${free.toLocaleString("en-US")} L of ${ordered.toLocaleString("en-US")} L still unaccounted for.`);
    }
  }

  async create(data: CreateCargoSchema) {
    await this.assertWithinOrder(data.orderId, data.quantityInLitre);

    const { pfi } = data;
    return await this.db.cargo.create({
      data: {
        deportId: data.deportId,
        orderId: data.orderId,
        expirationDate: data.expirationDate,
        quantityInKg: data.quantityInKg,
        quantityInLitre: data.quantityInLitre,
        receivedDate: data.receivedDate,
        vesselName: data.vesselName,
        status: "pending",
        tansisRef: data.tansisRef,
        outurnRef: data.outurnRef,
        supportingDocUrl: data.supportingDocUrl,
        blRef: data.blRef,
        // Raised with the shipment when the supplier's invoice came with it.
        // One write, so a refused PFI — a reference already used — leaves no
        // cargo behind either.
        ...(pfi
          ? {
              pfis: {
                create: {
                  currencyId: pfi.currencyId,
                  currancyCode: pfi.currancyCode,
                  pfiReference: pfi.pfiReference,
                  pifCode: generatePfiCode(),
                  unitPrice: pfi.unitPrice,
                  amount: pfi.amount,
                  supportingDocUrl: pfi.supportingDocUrl,
                },
              },
            }
          : {}),
      },
      include: { pfis: true },
    });
  }

  async update(id: string, data: CreateCargoSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    // `id` is excluded: a cargo's own litres are already in the order's total,
    // and counting them twice refused every edit that kept the quantity.
    await this.assertWithinOrder(data.orderId, data.quantityInLitre, id);
    return await this.db.cargo.update({
      where: { id: id },
     data: {
      deportId: data.deportId,
        orderId: data.orderId,
        expirationDate: data.expirationDate,
        quantityInLitre: data.quantityInLitre,
        quantityInKg: data.quantityInKg,
        receivedDate: data.receivedDate,
        vesselName: data.vesselName,
        tansisRef: data.tansisRef,
        outurnRef: data.outurnRef,
        supportingDocUrl: data.supportingDocUrl,
        blRef: data.blRef
      },
    });
  }

  /** How far this shipment's litres have travelled — see `cargo-movement`. */
  movement(id: string) {
    return cargoMovement(this.db, id);
  }

  /**
   * Sends an approved shipment back to the supplier.
   *
   * Nothing is rewritten. The cargo keeps its quantities and references; a
   * `CargoReturn` records what went back, why, and what the supplier owes, and
   * the depot stock it raised goes to `returned` so it stops counting as stock
   * and stops being offered to a nomination. A shipment whose fuel has already
   * moved is refused, with the rung that blocks it named.
   *
   * `replaced` differs from `returned` in one way only: it expects a new
   * shipment to be raised against the return afterwards. The reversal is the
   * same, because the fuel left either way.
   */
  async returnCargo(id: string, input: ReturnCargoSchema, userId: string) {
    return this.db.$transaction(async (tx) => {
      const cargo = await tx.cargo.findUnique({
        where: { id },
        select: { id: true, status: true, quantityInLitre: true, quantityInKg: true },
      });
      if (!cargo) throw new NotFoundError("Cargo");
      /*
       * Only an approved shipment can go back: that is what "taken back" means.
       * A pending one was never counted in stock and is cancelled instead, and
       * one already cancelled, returned or replaced has been dealt with.
       */
      if (cargo.status !== "approved") {
        throw new BusinessError("CARGO_NOT_APPROVED",
          cargo.status === "pending"
            ? "This shipment has not been approved, so there is no stock to reverse. Cancel it instead."
            : `This shipment is already ${cargo.status}.`);
      }

      const movement = await cargoMovement(tx, id);
      if (movement && !movement.returnable) {
        throw new BusinessError("CARGO_HAS_MOVED", movement.blockedBy!);
      }

      const record = await tx.cargoReturn.create({
        data: {
          cargoId: id,
          kind: input.kind,
          // Snapshot, not a reference: what went back is what the shipment
          // said at the time, whatever is edited afterwards.
          quantityInLitre: cargo.quantityInLitre,
          quantityInKg: cargo.quantityInKg,
          reason: input.reason,
          supportingDocUrl: input.supportingDocUrl ?? null,
          refundAmount: input.refundAmount ?? null,
          currencyCode: input.currencyCode ?? null,
          decidedBy: userId,
        },
        select: { id: true },
      });

      /*
       * The stock rows keep their quantity — the figure as it stood is part of
       * the record — and change status only. The stock report leaves a
       * returned row out of its totals, and a nomination will not draw on it.
       */
      await tx.stock.updateMany({
        where: { cargoId: id, status: { notIn: ["returned", "cancelled"] } },
        data: { status: "returned" },
      });

      await tx.cargo.update({
        where: { id },
        data: { status: input.kind === "replaced" ? "replaced" : "returned" },
      });
      return tx.cargoReturn.findUniqueOrThrow({ where: { id: record.id }, select: returnSelect.select });
    });
  }

  /**
   * The shipment raised in place of one that went back.
   *
   * A new cargo in its own right — `pending` until it arrives and is approved,
   * like any other — linked to the return so either record shows the other.
   * The original is left exactly as it was.
   */
  async createReplacement(id: string, data: CreateCargoSchema) {
    const original = await this.db.cargo.findUnique({
      where: { id },
      select: {
        status: true,
        returns: { where: { kind: "replaced" }, orderBy: { createdAt: "desc" },
          select: { id: true, replacementCargoId: true } },
      },
    });
    if (!original) throw new NotFoundError("Cargo");
    if (original.status !== "replaced") {
      throw new BusinessError("CARGO_NOT_REPLACED",
        "Mark the shipment as replaced first, saying why it went back; then raise the one that came instead.");
    }
    const open = original.returns.find((row) => row.replacementCargoId === null);
    if (!open) {
      throw new BusinessError("REPLACEMENT_EXISTS",
        "This shipment already has its replacement. Record a new return if another one goes back.");
    }
    await this.assertWithinOrder(data.orderId, data.quantityInLitre);

    // One write: a replacement that cannot be linked must not exist as a
    // stray cargo nobody can tell apart from an ordinary shipment.
    return this.db.$transaction(async (tx) => {
      const replacement = await tx.cargo.create({
        data: {
          deportId: data.deportId,
          orderId: data.orderId,
          expirationDate: data.expirationDate,
          quantityInKg: data.quantityInKg,
          quantityInLitre: data.quantityInLitre,
          receivedDate: data.receivedDate,
          vesselName: data.vesselName,
          status: "pending",
          tansisRef: data.tansisRef,
          outurnRef: data.outurnRef,
          supportingDocUrl: data.supportingDocUrl,
          blRef: data.blRef,
          ...(data.pfi
            ? { pfis: { create: {
                currencyId: data.pfi.currencyId,
                currancyCode: data.pfi.currancyCode,
                pfiReference: data.pfi.pfiReference,
                pifCode: generatePfiCode(),
                unitPrice: data.pfi.unitPrice,
                amount: data.pfi.amount,
                supportingDocUrl: data.pfi.supportingDocUrl,
              } } }
            : {}),
        },
        include: { pfis: true },
      });
      await tx.cargoReturn.update({
        where: { id: open.id },
        data: { replacementCargoId: replacement.id },
      });
      return replacement;
    });
  }

  async changeStatus(id: string, status: CargoStatus, receivedDate: Date) {
    const cargo = await this.find(id);
    if (!cargo) throw new NotFoundError();
    /*
     * Approving or cancelling only. `returned` and `replaced` reverse stock
     * that has already been counted and must say why, so they have their own
     * endpoint — reached here they would flip a pending shipment to "returned"
     * with no return record behind it.
     */
    if (status !== "approved" && status !== "cancelled") {
      throw new BusinessError("CARGO_STATUS_NOT_DIRECT",
        "A shipment is sent back through its own return, which records why. This only approves or cancels.");
    }
    return await this.db.$transaction(async(tx) => {
      await tx.stock.create({
        data: {
          itemId: cargo.order.itemId,
          cargoId: id,
          quantity: cargo.quantityInLitre,
          deportId: cargo.deportId,
          receivedDate,
          status: status === "approved" ? "received" : "cancelled"
        }
      })
      return await tx.cargo.update({
      where: { id , status: {equals: "pending"}},
      data: { status },
    });
    })
    
  }

  /**
   * One cargo, whole. It carries the fields an edit form binds to as well as
   * those `changeStatus` needs, so a client never has to find its row in the
   * list — which is served a page at a time and may not hold it.
   */
  find(id: string) {
    return this.db.cargo.findUnique({ where: { id }, select: {
      id: true,
      status: true,
      vesselName: true,
      receivedDate: true,
      expirationDate: true,
      blRef: true,
      tansisRef: true,
      outurnRef: true,
      orderId: true,
      quantityInLitre: true,
      quantityInKg: true,
      deportId: true,
      supportingDocUrl: true,
      order: {
        select: {
          itemId: true
        }
      },
      pfis: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, pifCode: true, pfiReference: true, currancyCode: true,
          unitPrice: true, amount: true, supportingDocUrl: true, createdAt: true,
          currency: { select: { id: true, code: true, name: true } },
        },
      },
      cargoInvoices: {
        orderBy: { createdAt: "asc" },
      },
      returns: returnSelect,
      replacementFor: {
        select: {
          id: true, kind: true, reason: true, createdAt: true,
          cargo: { select: { id: true, blRef: true, vesselName: true, quantityInLitre: true } },
        },
      },
    } });
  }

  async getAllVehiclesByid(id: string) {
    return await this.db.driverVehicles.findMany({where: {vehicleId: id, status: "active"}});
  }
}
