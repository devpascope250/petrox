import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { ConflictError, NotFoundError } from "../../utils/errors.js";
import type { CardSettingInput, CreateCardType, UpdateCardType } from "./card-type.schema.js";

const cardTypeSelect = {
  id: true, name: true, description: true, status: true, createdAt: true, updatedAt: true,
  user: { select: { id: true, firstName: true, lastName: true } },
  setting: {
    select: {
      requirePin: true, requirePlateNumber: true, capturePlatePicture: true, requireOdometer: true,
      showBalance: true, captureDisplay: true,
      allowCredit: true, hasLimit: true, limitAmount: true, limitPeriod: true, updatedAt: true,
    },
  },
  _count: { select: { cards: true } },
} satisfies Prisma.CardTypeSelect;

function present({ _count, setting, ...row }: Prisma.CardTypeGetPayload<{ select: typeof cardTypeSelect }>) {
  return {
    ...row,
    cardCount: _count.cards,
    setting: setting ? { ...setting, limitAmount: setting.limitAmount === null ? null : Number(setting.limitAmount) } : null,
  };
}

/** A limit's amount and period only mean something while the limit is on. */
function settingData(setting: CardSettingInput) {
  return {
    ...setting,
    limitAmount: setting.hasLimit ? setting.limitAmount ?? null : null,
    limitPeriod: setting.hasLimit ? setting.limitPeriod ?? null : null,
  };
}

/**
 * Kinds of card and the rules each follows. Never deleted: a type no longer
 * handed out is switched off, so the cards that carry it keep it.
 */
export class CardTypeRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    const rows = await this.db.cardType.findMany({ select: cardTypeSelect, orderBy: [{ status: "asc" }, { name: "asc" }] });
    return rows.map(present);
  }

  async find(id: string) {
    const row = await this.db.cardType.findUnique({ where: { id }, select: cardTypeSelect });
    if (!row) throw new NotFoundError("Card type");
    return present(row);
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const taken = await this.db.cardType.findUnique({ where: { name }, select: { id: true } });
    if (taken && taken.id !== exceptId) throw new ConflictError("CARD_TYPE_EXISTS", `A card type named ${name} already exists`);
  }

  /** A type always gets its settings row, with the defaults when none are sent. */
  async create(input: CreateCardType, userId: string) {
    await this.assertNameFree(input.name);
    const setting = settingData(input.setting ?? {
      requirePin: true, requirePlateNumber: false, capturePlatePicture: false, requireOdometer: false,
      showBalance: true, captureDisplay: false,
      allowCredit: false, hasLimit: false,
    });
    const row = await this.db.cardType.create({
      data: { name: input.name, description: input.description ?? null, createdBy: userId, setting: { create: setting } },
      select: cardTypeSelect,
    });
    return present(row);
  }

  async update(id: string, input: UpdateCardType) {
    await this.find(id);
    if (input.name) await this.assertNameFree(input.name, id);
    const setting = input.setting ? settingData(input.setting) : undefined;
    const row = await this.db.cardType.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        // Upsert: a type made before settings existed gets its row now.
        setting: setting ? { upsert: { create: setting, update: setting } } : undefined,
      },
      select: cardTypeSelect,
    });
    return present(row);
  }

  async changeStatus(id: string) {
    const current = await this.find(id);
    const row = await this.db.cardType.update({
      where: { id }, data: { status: current.status === "active" ? "inactive" : "active" }, select: cardTypeSelect,
    });
    return present(row);
  }
}
