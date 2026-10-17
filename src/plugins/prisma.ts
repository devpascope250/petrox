import { PrismaClient } from "../../prisma/generated/prisma/client.js";
import fp from "fastify-plugin";

export default fp(async (app) => {
  // A client's PIN hash never leaves the database by accident: it is left out
  // of every result, and read only where a PIN is checked (`omit: false` there).
  const prisma = new PrismaClient({ omit: { client: { pinHash: true } } });
  await prisma.$connect();
  app.decorate("prisma", prisma);
  app.addHook("onClose", async () => prisma.$disconnect());
}, { name: "prisma" });
