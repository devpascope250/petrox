import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateItemSchema, CreateUnitSchema } from "./items.schema.js";


export class ItemsRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    const items = await this.db.item.findMany({orderBy: { createdAt: "desc" } });
     return items;
  }

  create(data: CreateItemSchema) {
    return this.db.item.create({
      data: {
        name: data.name,
        descriptions: data.descriptions,
        baseUnitId: data.baseUnitId,
        parentId: data.parentId,
        itemUnits: {
          createMany: {
            data: data.units
          }
        }
      }
    });
  }

  async update(id: string, data: CreateItemSchema) {
    if(! await this.find(id)) throw new NotFoundError();
    return await this.db.$transaction(async(tx) => {
      await tx.item.update({ where: {id},data: {baseUnitId: data.baseUnitId, parentId: data.parentId, name: data.name, descriptions: data.descriptions}});
      await tx.itemUnit.deleteMany({
        where: {
          itemId: id,
          unitId: {
            notIn: data.units.map((unt) => unt.unitId)
          }
        }
      })


      const itemUnits = data.units.map(async(dt) => {
        return await tx.itemUnit.upsert(
          {
            where: {
              unitId_itemId: {
                itemId: id,
                unitId: dt.unitId
              }
            },
            update: {
              factorialValue: dt.factorialValue,
            },
            create: {
              factorialValue: dt.factorialValue,
              itemId: id,
              unitId: dt.unitId
            }
          }
        )
      });

      return await Promise.all(itemUnits);
    });
    }

  async changeItemStatus(id: string) {
    const item = await this.find(id);
    if(!item) throw new NotFoundError();
    return await this.db.item.update({where: {id}, data: {status: item.status === "active" ? "inactive" : "active"}})
  }

  find(id: string) {
    return this.db.item.findUnique({ where: { id }});
  }

  async deleteItem(id: string) {
    if(! await this.find(id)) throw new NotFoundError();
    return this.db.item.deleteMany({where: {id}})
  }

  // for units

  listUnits() {
    return this.db.unit.findMany({orderBy: {createdAt: "desc"}, select: {id: true, name: true, code: true, status: true}});
  }

  createUnit(data: CreateUnitSchema) {
    return this.db.unit.create({data});
  }

  findUnit(id: string) {
    return this.db.unit.findUnique({where: {id: id}, select: {id: true, name: true, code: true, status: true}});
  }

  async deleteUnit(id: string) {
    if (! await this.findUnit(id)) throw new NotFoundError();
    return await this.db.unit.delete({where: {id}});
  }

   async changeUnitStatus(id: string) {
    const unit = await this.findUnit(id);
    if(!unit) throw new NotFoundError();
    return await this.db.unit.update({where: {id}, data: {status: unit.status === "active" ? "inactive" : "active"}})
  }

  async updateUnit(id: string, data: Prisma.UnitUncheckedCreateInput) {
    if (! await this.findUnit(id)) throw new NotFoundError(); 
    return await this.db.unit.update(
      {
        where: {
          id
        },
        data: {
          ...data
        }
      }
    )
  }

}