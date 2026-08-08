import type { PrismaClient } from "../../../generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { PermissionSchemaBody } from "./permission.schema.js";

export class ModulesRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(data: PermissionSchemaBody) {
    return await this.db.permission.create(
      {
        data: {
          ...data
        }
      }
    );
  }

  async findOne(id: string) {
    return await this.db.permission.findFirst({where: {id}});
  }

  async edit(id: string, data: PermissionSchemaBody) {
    if(!await this.findOne(id)) throw new NotFoundError(`This Permission ${data.code} does not existed`);
    return await this.db.permission.create({data: {...data}});
  }

  async delete (id: string) {
    if (!await this.findOne(id)) throw new NotFoundError(`This Permission ${id} does not exist`);
    return await this.db.permission.delete({where: {id}});
  }

  
}
