import type { PrismaClient } from "../../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../../utils/errors.js";
import { CreateClearingAgentSchema } from "./agent.schema.js";
export class ClearanceAgentRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.clearingAgent.
    findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        names: true,
        fees: true,
        status: true,
        createdAt: true,
      },
    });
  }

  create(data: CreateClearingAgentSchema) {
    return this.db.clearingAgent.create({
      data: {
        names: data.names,
        fees: data.fees,
      },
    });
  }

  async update(id: string, data: CreateClearingAgentSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.clearingAgent.update({
      where: { id: id },
      data: {
        names: data.names,
        fees: data.fees,
      },
    });
  }


  async changeStatus(id: string) {
    const agent = await this.find(id);
    if (!agent) throw new NotFoundError();
    return await this.db.clearingAgent.update({
      where: { id },
      data: { status: agent.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.clearingAgent.findUnique({ where: { id } });
  }

  async delete(id: string) {
    const agent = await this.db.clearingAgent.findUnique({
      where: { id }, select: { _count: { select: { stockClearances: true } } },
    });
    if (!agent) throw new NotFoundError("Clearing agent not found");
    if (agent._count.stockClearances > 0) {
      throw new BusinessError("400", "An agent used by a clearance cannot be deleted; deactivate it instead");
    }
    return this.db.clearingAgent.delete({ where: { id } });
  }
}
