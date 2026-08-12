import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyServerOptions } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { AppConfig } from "./config/env.js";
import authRoutes from "./modules/auth/auth.routes.js";
import moduleRoutes from "./modules/modules/modules.routes.js";
import roleRoutes from "./modules/roles/roles.routes.js";
import ItemsRoutes from "./modules/items/items.routes.js";
import userRoutes from "./modules/users/users.routes.js";
import SupplierRoutes from "./modules/supplier/supplier.routes.js";
import OrdersRoutes from "./modules/orders/orders.routes.js";
import DeportsRoutes from "./modules/deports/deport.routes.js";
import TransporterRoutes from "./modules/transporters/transporter.routes.js";
import VehiclesRoutes from "./modules/vehicles/vehicles.routes.js";
import DriversRoutes from "./modules/drivers/driver.routes.js";
import authPlugin from "./plugins/auth.js";
import jwtPlugin from "./plugins/jwt.js";
import prismaPlugin from "./plugins/prisma.js";
import { globalErrorHandler } from "./utils/error-handler.js";
import { success } from "./shared/http/index.js";

export async function buildApp(config: AppConfig, options: FastifyServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? { level: config.LOG_LEVEL, redact: ["req.headers.authorization", "body.password", "body.pin", "body.refreshToken", "body.token"] }, ...options });
  app.decorate("config", config);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(helmet);
  await app.register(cors, { origin: config.CORS_ORIGIN.split(",").map((v) => v.trim()), credentials: true });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(prismaPlugin);
  await app.register(jwtPlugin);
  await app.register(authPlugin);
  app.setErrorHandler(globalErrorHandler);
  app.get("/health", async () => success({ status: "ok" }));
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(userRoutes, { prefix: "/api/v1/users" });
  await app.register(roleRoutes, { prefix: "/api/v1/roles" });
  await app.register(ItemsRoutes, { prefix: "/api/v1/items" });
  await app.register(moduleRoutes, { prefix: "/api/v1/modules" });
  await app.register(SupplierRoutes, { prefix: "/api/v1/suppliers" });
  await app.register(OrdersRoutes, { prefix: "/api/v1/orders" });
  await app.register(DeportsRoutes, { prefix: "/api/v1/deports" });
  await app.register(TransporterRoutes, { prefix: "/api/v1/transporters" });
  await app.register(VehiclesRoutes, { prefix: "/api/v1/vehicles" });
  await app.register(DriversRoutes, { prefix: "/api/v1/drivers" });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ success: false, error: { statusCode: 404, code: "ROUTE_NOT_FOUND", message: `Route ${request.method} ${request.url} not found`, requestId: request.id } }));
  return app;
}


