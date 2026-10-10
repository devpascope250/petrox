import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, ConflictError, NotFoundError } from "../../utils/errors.js";
import type { CreateItemUnit, UpdateItemUnit } from "./item-unit.schema.js";

const unitSelect = { select: { id: true, name: true, code: true } } as const;

const itemUnitSelect = {
  id: true, itemId: true, unitId: true, factorialValue: true, status: true, createdAt: true,
  item: { select: { id: true, name: true, baseUnitId: true, baseUnit: unitSelect } },
  unit: unitSelect,
  // The price in force, so the list shows what each unit sells for.
  itemPrices: { where: { status: "active" }, select: { id: true, price: true }, take: 1 },
  _count: { select: { itemPrices: true } },
} satisfies Prisma.ItemUnitSelect;

function present({ itemPrices, _count, item: { baseUnitId, ...item }, ...row }: Prisma.ItemUnitGetPayload<{ select: typeof itemUnitSelect }>) {
  return {
    ...row, item,
    isBaseUnit: row.unitId === baseUnitId,
    currentPrice: itemPrices[0] ? Number(itemPrices[0].price) : null,
    priceCount: _count.itemPrices,
  };
}

/**
 * The units an item can be measured — and priced — in. There is no delete: a
 * unit that is no longer used is switched off, which keeps the prices set for
 * it on record.
 */
export class ItemUnitRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    const rows = await this.db.itemUnit.findMany({
      select: itemUnitSelect,
      orderBy: [{ item: { name: "asc" } }, { factorialValue: "asc" }],
    });
    return rows.map(present);
  }

  async find(id: string) {
    const row = await this.db.itemUnit.findUnique({ where: { id }, select: itemUnitSelect });
    if (!row) throw new NotFoundError("Item unit");
    return present(row);
  }

  /** The active items and units the form offers. */
  async options() {
    const [items, units] = await Promise.all([
      this.db.item.findMany({
        where: { status: "active" },
        select: { id: true, name: true, baseUnit: unitSelect, itemClass: { select: { id: true, name: true } } },
        orderBy: { name: "asc" },
      }),
      this.db.unit.findMany({ where: { status: "active" }, ...unitSelect, orderBy: { name: "asc" } }),
    ]);
    return { items: items.map(({ itemClass, ...item }) => ({ ...item, parent: itemClass })), units };
  }

  private async assertPair(itemId: string, unitId: string, exceptId?: string) {
    const [item, unit, taken] = await Promise.all([
      this.db.item.findUnique({ where: { id: itemId }, select: { name: true } }),
      this.db.unit.findUnique({ where: { id: unitId }, select: { name: true } }),
      this.db.itemUnit.findUnique({ where: { unitId_itemId: { unitId, itemId } }, select: { id: true } }),
    ]);
    if (!item) throw new NotFoundError("Item");
    if (!unit) throw new NotFoundError("Unit");
    if (taken && taken.id !== exceptId) {
      throw new ConflictError("ITEM_UNIT_EXISTS", `${item.name} already has the unit ${unit.name}`);
    }
  }

  async create(input: CreateItemUnit) {
    await this.assertPair(input.itemId, input.unitId);
    const row = await this.db.itemUnit.create({ data: input, select: itemUnitSelect });
    return present(row);
  }

  async update(id: string, input: UpdateItemUnit) {
    const current = await this.find(id);
    const itemId = input.itemId ?? current.itemId;
    const unitId = input.unitId ?? current.unitId;
    if (itemId !== current.itemId || unitId !== current.unitId) {
      // Prices were set for this item in this unit; pointing the row elsewhere
      // would quietly re-label them.
      if (current.priceCount > 0) {
        throw new BusinessError("ITEM_UNIT_HAS_PRICES",
          "Prices are set for this item unit, so its item and unit cannot change. Switch it off and add a new one instead.");
      }
      await this.assertPair(itemId, unitId, id);
    }
    const row = await this.db.itemUnit.update({
      where: { id }, data: { itemId, unitId, factorialValue: input.factorialValue }, select: itemUnitSelect,
    });
    return present(row);
  }

  async changeStatus(id: string) {
    const current = await this.find(id);
    const row = await this.db.itemUnit.update({
      where: { id }, data: { status: current.status === "active" ? "inactive" : "active" }, select: itemUnitSelect,
    });
    return present(row);
  }
}
