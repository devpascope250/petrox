import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { AppConfig } from "./config/env.js";
import authRoutes from "./modules/auth/auth.routes.js";
import moduleRoutes from "./modules/modules/modules.routes.js";
import roleRoutes from "./modules/roles/roles.routes.js";
import ItemsRoutes from "./modules/items/items.routes.js";
import ItemToleranceRateRoutes from "./modules/item-tolerance-rates/item-tolerance-rate.routes.js";
import userRoutes from "./modules/users/users.routes.js";
import SupplierRoutes from "./modules/supplier/supplier.routes.js";
import OrdersRoutes from "./modules/orders/orders.routes.js";
import DeportsRoutes from "./modules/deports/deport.routes.js";
import TransporterRoutes from "./modules/transporters/transporter.routes.js";
import VehiclesRoutes from "./modules/vehicles/vehicles.routes.js";
import DriversRoutes from "./modules/drivers/driver.routes.js";
import StockRoutes from "./modules/stock/stock.routes.js";
import NominationsRoutes from "./modules/nominations/nominations.routes.js";
import CargoRoutes from "./modules/cargo/cargo.routes.js";
import CargoInvoiceRoutes from "./modules/cargo-invoices/cargo-invoice.routes.js";
import PfiRoutes from "./modules/pfi/pfi.routes.js";
import T1ValidationRoutes from "./modules/t1 validation/t1-validation.routes.js";
import CentralStockRoutes from "./modules/central-stock/central-stock.routes.js";
import StockClearanceRoutes from "./modules/stock clearance/clearance.routes.js";
import ClearanceAgentRoutes from "./modules/stock clearance/agents/agent.routes.js";
import PssRoutes from "./modules/sites/sites.routes.js";
import CuvesRoutes from "./modules/Cuve/cuve.routes.js";
import PumpRoutes from "./modules/pump/pump.routes.js";
import DisplayRoutes from "./modules/display/display.routes.js";
import NozzlesRoutes from "./modules/nozzle/nozzle.routes.js";
import StockOutOrdersRoutes from "./modules/central stock Orders/order.routes.js";
import LocationRoutes from "./modules/locations/location.routes.js";
import CompanyAccountRoutes from "./modules/company-accounts/company-account.routes.js";
import ClientWalletRoutes from "./modules/client-wallets/client-wallet.routes.js";
import CardsRoutes from "./modules/cards/cards.routes.js";
import ClientsRoutes from "./modules/clients/clients.routes.js";
import DiscountRoutes from "./modules/discounts/discount.routes.js";
import CouponPlanRoutes from "./modules/coupon-plans/coupon-plan.routes.js";
import ClientCouponRoutes from "./modules/client-coupons/client-coupon.routes.js";
import authPlugin from "./plugins/auth.js";
import jwtPlugin from "./plugins/jwt.js";
import prismaPlugin from "./plugins/prisma.js";
import { globalErrorHandler } from "./utils/error-handler.js";
import { success } from "./shared/http/index.js";

export async function buildApp(config: AppConfig, options: FastifyServerOptions = {}) {
  const app = Fastify({bodyLimit: 10 * 1024 * 1024, logger: options.logger ?? { level: config.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie", "body.password", "body.pin", "body.refreshToken", "body.token"] }, ...options });
  app.decorate("config", config);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(helmet);
  await app.register(cors, { origin: config.CORS_ORIGIN.split(",").map((v) => v.trim()), credentials: true });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(prismaPlugin);
  await app.register(cookie);
  await app.register(jwtPlugin);
  await app.register(authPlugin);
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 2
    }
  });
  await app.register(fastifyStatic, {
  root: path.join(process.cwd(), "uploads"),
  prefix: "/uploads/",
});
  app.setErrorHandler(globalErrorHandler);
  app.get("/health", async () => success({ status: "ok" }));
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(userRoutes, { prefix: "/api/v1/users" });
  await app.register(roleRoutes, { prefix: "/api/v1/roles" });
  await app.register(ItemsRoutes, { prefix: "/api/v1/items" });
  await app.register(ItemToleranceRateRoutes, { prefix: "/api/v1/item-tolerance-rates" });
  await app.register(moduleRoutes, { prefix: "/api/v1/modules" });
  await app.register(SupplierRoutes, { prefix: "/api/v1/suppliers" });
  await app.register(OrdersRoutes, { prefix: "/api/v1/orders" });
  await app.register(DeportsRoutes, { prefix: "/api/v1/deports" });
  await app.register(TransporterRoutes, { prefix: "/api/v1/transporters" });
  await app.register(VehiclesRoutes, { prefix: "/api/v1/vehicles" });
  await app.register(DriversRoutes, { prefix: "/api/v1/drivers" });
  await app.register(CargoRoutes, { prefix: "/api/v1/cargo" });
  await app.register(CargoInvoiceRoutes, { prefix: "/api/v1/cargo-invoices" });
  await app.register(StockRoutes, { prefix: "/api/v1/stock" });
  await app.register(NominationsRoutes, { prefix: "/api/v1/nominations" });
  await app.register(PfiRoutes, { prefix: "/api/v1/pfi" });
  await app.register(T1ValidationRoutes, { prefix: "/api/v1/t1-validation" });
  await app.register(CentralStockRoutes, { prefix: "/api/v1/central-stock" });
  await app.register(StockClearanceRoutes, { prefix: "/api/v1/stock-clearances" });
  await app.register(ClearanceAgentRoutes, { prefix: "/api/v1/clearing-agents" });
  await app.register(PssRoutes, { prefix: "/api/v1/sites" });
  await app.register(CuvesRoutes, { prefix: "/api/v1/cuves" });
  await app.register(PumpRoutes, { prefix: "/api/v1/pumps" });
  await app.register(DisplayRoutes, { prefix: "/api/v1/displays" });
  await app.register(NozzlesRoutes, { prefix: "/api/v1/nozzles" });
  await app.register(StockOutOrdersRoutes, { prefix: "/api/v1/stock-out-orders" });
  await app.register(LocationRoutes, { prefix: "/api/v1/locations" });
  await app.register(CompanyAccountRoutes, { prefix: "/api/v1/company-accounts" });
  await app.register(ClientWalletRoutes, { prefix: "/api/v1/client-wallets" });
  await app.register(CardsRoutes, { prefix: "/api/v1/cards" });
  await app.register(ClientsRoutes, { prefix: "/api/v1/clients" });
  await app.register(DiscountRoutes, { prefix: "/api/v1/discounts" });
  await app.register(CouponPlanRoutes, { prefix: "/api/v1/coupon-plans" });
  await app.register(ClientCouponRoutes, { prefix: "/api/v1/client-coupons" });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ success: false, error: { statusCode: 404, code: "ROUTE_NOT_FOUND", message: `Route ${request.method} ${request.url} not found`, requestId: request.id } }));
  return app;
}
