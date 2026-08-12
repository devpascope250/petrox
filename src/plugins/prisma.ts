import { PrismaClient } from "../../prisma/generated/prisma/client.js";
import fp from "fastify-plugin";

export default fp(async (app) => {
  const prisma = new PrismaClient();
  await prisma.$connect();
  app.decorate("prisma", prisma);
  app.addHook("onClose", async () => prisma.$disconnect());
}, { name: "prisma" });
