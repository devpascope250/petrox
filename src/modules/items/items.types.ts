import { Prisma } from "../../../prisma/generated/prisma/client.js";
import { StatusType } from "../../../prisma/generated/prisma/enums.js";

export interface ItemsAccessRow {
  id: string;
  name: string;
  descriptions?: string;
  parentId?: string | null;
  baseUnitId?: string | null;
}

export interface ItemsList {
  id: string;
  name: string;
  descriptions?: string;
  baseUnitId?: string;
  items: ItemsList[];
  tolerance?: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: StatusType;
    maxRate: Prisma.Decimal;
  } | null;
}
