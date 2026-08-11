import type { PrismaClient } from "../../../generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";

export class OrderRepository {
  constructor(private db: PrismaClient) {}

  async listBy() {
    const orders = await this.db.order.findMany({orderBy: { createdAt: "desc" }, select: {
      id: true,
      orderCode: true,
      orderDate: true,
      quantity: true,
      item: {
        select : {
          name: true,
          baseUnit: true,
          status: true, 
        }
      },
       supplier: {
        select: {
          name: true,
          phone: true
        }
       },
      createdUser: {
        select: {
          firstName: true,
          lastName: true
        }
      }
    } });
     return orders;
  }

    async listBy() {
    const orders = await this.db.order.findMany({orderBy: { createdAt: "desc" }, select: {
      id: true,
      orderCode: true,
      orderDate: true,
      quantity: true,
      item: {
        select : {
          name: true,
          baseUnit: true,
          status: true, 
        }
      },
       supplier: {
        select: {
          name: true,
          phone: true
        }
       },
      createdUser: {
        select: {
          firstName: true,
          lastName: true
        }
      }
    } });
     return orders;
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

  listSupplierType() {
    return this.db.supplierType.findMany({orderBy: {createdAt: "desc"}, select: {id: true, type: true, status: true}});
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