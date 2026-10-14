import { CentralOrderStatus } from "../../../prisma/generated/prisma/enums.js";
import type { AppConfig } from "../../config/env.js";
import { isSiteBound, type AuthUser } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import { forbidden } from "../../utils/errors.js";
import { within2DaysPeriod } from "../../utils/utils.js";
import { CentralStockOrderRepository } from "./order.repository.js";
import { CentralStockOrderReportQuerySchema, CreateCentralStockOrderSchema, CreateLoadingOrderSchema, LoadingOrderStatusSchema, ReceptionOrdersQuerySchema, ReceiveLoadingOrderSchema } from "./order.schema.js";

export class CentralStockOrderService {
  constructor(private repo: CentralStockOrderRepository, private config: AppConfig) {}
  async list(query: CentralStockOrderReportQuerySchema, actor: AuthUser) {
    const dates = within2DaysPeriod(query.startDate, query.endDate);

    // Site staff see every order for their own site — and totals over just those.
    const report = await this.repo.list({
      ...query, ...dates,
      ...(isSiteBound(actor) && { siteId: this.requireSite(actor) }),
    });
    return {
      ...report,
      orders: report.orders.map((order) => ({
        ...order,
        clearance: {
          ...order.clearance,
          supportingDocUrl: this.documentUrl(order.clearance.supportingDocUrl),
          dmsDocUrl: this.documentUrl(order.clearance.dmsDocUrl),
        },
      })),
    };
  }
  find(id: string) { return this.repo.find(id); }
  create(input: CreateCentralStockOrderSchema) { return this.repo.create(input); }

  /**
   * What site staff cannot choose when ordering: they order fuel for their own
   * site (an internal order), and it waits for head office to approve it.
   * Whatever the request said about the site, type, status or approver is
   * replaced. Nothing for a super administrator, who names the site.
   */
  siteOrderFields(actor: AuthUser) {
    if (!isSiteBound(actor)) return {};
    return { siteId: this.requireSite(actor), orderType: "internal" as const, status: "pending" as const, approvedBy: undefined };
  }
  /** A site manager sees only the loads carrying orders for his site. */
  listLoadingOrders(actor: AuthUser) {
    return this.repo.listLoadingOrders(this.siteScope(actor));
  }
  createLoadingOrders(input: CreateLoadingOrderSchema) { return this.repo.createLoadingOrders(input); }
  updateLoadingOrderStatus(id: string, input: LoadingOrderStatusSchema) {
    return this.repo.updateLoadingOrderStatus(id, input);
  }

  async listReceptionOrders(query: ReceptionOrdersQuerySchema, actor: AuthUser) {
    this.assertReceptionAccess(actor);
    const [items, total] = await this.repo.listReceptionOrders(query, this.siteScope(actor));
    return paginatedData(items, total, query);
  }

  async receiveLoadingOrder(id: string, input: ReceiveLoadingOrderSchema, actor: AuthUser) {
    if (actor.position !== "siteManager") {
      throw forbidden("Only site managers can receive loading orders into a cuve");
    }
    return this.repo.receiveLoadingOrder(id, input, { siteId: this.requireSite(actor) }, actor.userId);
  }

  private documentUrl(path: string | null) {
    return path ? `${this.config.APP_URL}${path}` : null;
  }

  private assertReceptionAccess(actor: AuthUser) {
    if (actor.position !== "superAdmin" && actor.position !== "siteManager") {
      throw forbidden("Only super administrators and site managers can view reception orders");
    }
  }

  /** For site staff: every order for their own site, whoever raised it. */
  private siteScope(actor: AuthUser) {
    return isSiteBound(actor) ? { siteId: this.requireSite(actor) } : undefined;
  }

  private requireSite(actor: AuthUser) {
    if (!actor.siteId) throw forbidden("Your user account is not assigned to an active site");
    return actor.siteId;
  }

  changeOrderStatus(id: string, status: CentralOrderStatus) {
    return this.repo.changeOrderStatus(id, status);
  }
}
