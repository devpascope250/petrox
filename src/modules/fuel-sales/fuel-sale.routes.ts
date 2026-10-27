import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { FuelSaleService } from "./fuel-sale.service.js";
import { FuelSaleRepository } from "./fuel-sale.repository.js";
import { parseFuelSaleMultipart } from "./fuel-sale-upload.js";
import {
  createFuelSaleSchema, fuelSaleListQuerySchema, fuelSaleOptionsQuerySchema, fuelSaleQuoteQuerySchema,
  fuelSaleReportQuerySchema,
} from "./fuel-sale.schema.js";

/** A JSON body cannot name a document: only an upload sets `referenceDocUrl`. */
function stripDocuments(body: unknown) {
  const sale = body as { payments?: unknown } | null;
  if (!sale || !Array.isArray(sale.payments)) return body;
  return { ...sale, payments: sale.payments.map((payment) => ({ ...(payment as object), referenceDocUrl: undefined })) };
}

/**
 * Fuel sold through the nozzles: `/fuel-sales` (the sales and recording one),
 * `/fuel-sales/options` (what the form and filters offer) and
 * `/fuel-sales/report` (totals by day, shift, nozzle, account and seller).
 *
 * Two modules guard it: "Fuel Sales" (`fuel.sales.*`) and "Fuel Sales Report"
 * (`fuel.sales.report.*`). The report also lists the sales behind its totals,
 * so its read permission opens the list too.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new FuelSaleService(new FuelSaleRepository(app.prisma));
  const read = app.authorize("fuel.sales.read", "fuel.sales.report.read");

  app.get("/options", { preHandler: [app.authenticate, app.authorize("fuel.sales.read", "fuel.sales.create", "fuel.sales.report.read")] }, async (request) =>
    success(await service.options(parseInput(fuelSaleOptionsQuerySchema, request.query).siteId, request.contextUser!)));
  // What a sale of a given volume would come to, discount included: the form
  // asks as the litres are typed, so it can collect the discounted amount.
  app.get("/quote", { preHandler: [app.authenticate, app.authorize("fuel.sales.create", "fuel.sales.read")] }, async (request) =>
    success(await service.quote(parseInput(fuelSaleQuoteQuerySchema, request.query), request.contextUser!)));
  app.get("/report", { preHandler: [app.authenticate, app.authorize("fuel.sales.report.read")] }, async (request) =>
    success(await service.report(parseInput(fuelSaleReportQuerySchema, request.query), request.contextUser!)));
  app.get("/", { preHandler: [app.authenticate, read] }, async (request) =>
    success(await service.list(parseInput(fuelSaleListQuerySchema, request.query), request.contextUser!)));
  app.get("/:id", { preHandler: [app.authenticate, read] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id, request.contextUser!)));
  // JSON, or multipart when a payment carries its reference document.
  app.post("/", { preHandler: [app.authenticate, app.authorize("fuel.sales.create")] }, async (request, reply) => {
    const body = request.isMultipart()
      ? await parseFuelSaleMultipart(request)
      : stripDocuments(request.body);
    return created(reply, await service.record(parseInput(createFuelSaleSchema, body), request.contextUser!));
  });
};

export default routes;
