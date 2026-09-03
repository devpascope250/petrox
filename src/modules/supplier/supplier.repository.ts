import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateSupplierSchema, CreateSupplierTypeSchema } from "./supplier.schema.js";


export class SupplerRepository {
  constructor(private db: PrismaClient) {}

  list(query: PaginationQuery) {
    return  this.db.supplier.findMany({orderBy: { createdAt: "desc" }, select: {
      id: true,
      address: true,
      name: true,
      phone: true,
      status: true,
      tinNumber: true,
      supplierType: {
        select: {
          id: true,
          status: true,
          type: true
        }
      }
      } })
  }

  create(data: CreateSupplierSchema) {
    return this.db.supplier.create({
      data: {
        name: data.name,
        address: data.address,
        phone: data.address,
        tinNumber: data.tinNumber,
        supplierTypeId: data.supplierTypeId
      }
    });
  }

  async update(id: string, data: CreateSupplierSchema) {
    if(! await this.find(id)) throw new NotFoundError();
    return await this.db.supplier.update(
      {
        where: {id: id},
        data: data
      }
    )
    }

  async changeSupplierStatus(id: string) {
    const supplier = await this.find(id);
    if(!supplier) throw new NotFoundError();
     await this.db.supplier.update({where: {id}, data: {status: supplier.status === "active" ? "inactive" : "active"}})
  }

  find(id: string) {
    return this.db.supplier.findUnique({ where: { id }});
  }

  // for Supplier Type

  listSupplierType(query: PaginationQuery) {
    return this.db.$transaction([
      this.db.supplierType.findMany({...paginationArgs(query), orderBy: {createdAt: "desc"}, select: {id: true, type: true, status: true}}),
      this.db.supplierType.count()
    ]);
  }

  createSupplierType(data: CreateSupplierTypeSchema) {
    return this.db.supplierType.create({data});
  }

  findSupplierType(id: string) {
    return this.db.supplierType.findUnique({where: {id: id}, select: {id: true, type: true, status: true}});
  }


   async changeSupplierTypeStatus(id: string) {
    const type = await this.findSupplierType(id);
    if(!type) throw new NotFoundError();
    return await this.db.supplierType.update({where: {id}, data: {status: type.status === "active" ? "inactive" : "active"}, select: {id: true, status: true, type: true}})
  }

  async updateSupplierType(id: string, data: CreateSupplierTypeSchema) {
    if (! await this.findSupplierType(id)) throw new NotFoundError(); 
    return await this.db.supplierType.update(
      {
        where: {
          id
        },
        data: {
          type: data.type
        }
      }
    )
  }

}
