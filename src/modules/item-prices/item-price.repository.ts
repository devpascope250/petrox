import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import type { CreateItemPrice, UpdateItemPrice } from "./item-price.schema.js";

const unitSelect = { select: { id: true, name: true, code: true } } as const;

const priceSelect = {
  id: true, itemUnitId: true, price: true, status: true, createdAt: true,
  itemUnit: {
    select: {
      id: true, factorialValue: true,
      item: { select: { id: true, name: true, baseUnit: unitSelect } },
      unit: unitSelect,
    },
  },
  user: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ItemPriceSelect;

function present(row: Prisma.ItemPriceGetPayload<{ select: typeof priceSelect }>) {
  return { ...row, price: Number(row.price) };
}

type Tx = Prisma.TransactionClient;

/**
 * Prices are never deleted: a price that no longer applies is switched off, so
 * the list doubles as the price history. An item unit has at most one active
 * price at a time — that is the one a sale is priced at.
 */
export class ItemPriceRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    const rows = await this.db.itemPrice.findMany({
      select: priceSelect,
      // Active first, then newest: the price in force sits above its history.
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return rows.map(present);
  }

  async find(id: string) {
    const row = await this.db.itemPrice.findUnique({ where: { id }, select: priceSelect });
    if (!row) throw new NotFoundError("Item price");
    return present(row);
  }

  /** The item units a price can be set for: every active unit of every active item. */
  async options() {
    const itemUnits = await this.db.itemUnit.findMany({
      where: { status: "active", item: { status: "active" } },
      select: {
        id: true, factorialValue: true,
        item: { select: { id: true, name: true, baseUnit: unitSelect } },
        unit: unitSelect,
        itemPrices: { where: { status: "active" }, select: { id: true, price: true }, take: 1 },
      },
      orderBy: [{ item: { name: "asc" } }, { unit: { name: "asc" } }],
    });
    return {
      itemUnits: itemUnits.map(({ itemPrices, ...itemUnit }) => ({
        ...itemUnit, currentPrice: itemPrices[0] ? Number(itemPrices[0].price) : null,
      })),
    };
  }

  private async assertItemUnit(tx: Tx, itemUnitId: string) {
    const itemUnit = await tx.itemUnit.findUnique({ where: { id: itemUnitId }, select: { status: true } });
    if (!itemUnit) throw new NotFoundError("Item unit");
    if (itemUnit.status !== "active") throw new BusinessError("ITEM_UNIT_INACTIVE", "That item unit is not active");
  }

  /** Switches off every other active price of an item unit, keeping `keepId` on. */
  private retireOthers(tx: Tx, itemUnitId: string, keepId?: string) {
    return tx.itemPrice.updateMany({
      where: { itemUnitId, status: "active", id: keepId ? { not: keepId } : undefined },
      data: { status: "inactive" },
    });
  }

  /** A new price takes over from the one in force, which stays on record as inactive. */
  create(input: CreateItemPrice, userId: string) {
    return this.db.$transaction(async (tx) => {
      await this.assertItemUnit(tx, input.itemUnitId);
      const replaced = await this.retireOthers(tx, input.itemUnitId);
      const row = await tx.itemPrice.create({
        data: { itemUnitId: input.itemUnitId, price: input.price, createdBy: userId },
        select: priceSelect,
      });
      return { ...present(row), replaced: replaced.count };
    });
  }

  update(id: string, input: UpdateItemPrice) {
    return this.db.$transaction(async (tx) => {
      const current = await tx.itemPrice.findUnique({ where: { id }, select: { itemUnitId: true, status: true } });
      if (!current) throw new NotFoundError("Item price");
      const itemUnitId = input.itemUnitId ?? current.itemUnitId;
      if (itemUnitId !== current.itemUnitId) {
        await this.assertItemUnit(tx, itemUnitId);
        // Moving an active price onto another item unit takes over there too.
        if (current.status === "active") await this.retireOthers(tx, itemUnitId, id);
      }
      const row = await tx.itemPrice.update({
        where: { id }, data: { itemUnitId, price: input.price }, select: priceSelect,
      });
      return present(row);
    });
  }

  /** Toggles a price on or off. Switching one on switches off the one it replaces. */
  changeStatus(id: string) {
    return this.db.$transaction(async (tx) => {
      const current = await tx.itemPrice.findUnique({ where: { id }, select: { itemUnitId: true, status: true } });
      if (!current) throw new NotFoundError("Item price");
      const status = current.status === "active" ? "inactive" : "active";
      const replaced = status === "active" ? (await this.retireOthers(tx, current.itemUnitId, id)).count : 0;
      const row = await tx.itemPrice.update({ where: { id }, data: { status }, select: priceSelect });
      return { ...present(row), replaced };
    });
  }
}
