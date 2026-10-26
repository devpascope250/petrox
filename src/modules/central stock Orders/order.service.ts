import { CentralOrderStatus } from "../../../prisma/generated/prisma/enums.js";
import type { AppConfig } from "../../config/env.js";
import { isSiteBound, type AuthUser } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import { NotFoundError, forbidden } from "../../utils/errors.js";
import { within2DaysPeriod } from "../../utils/utils.js";
import { CentralStockOrderRepository } from "./order.repository.js";
import { notifyLoadingOrderAuthorizers } from "./loading-order-notify.js";
import {
  loadingOrderFileName,
  loadingOrderForDocument,
  renderLoadingOrderPdf,
} from "./loading-order-document.js";
import {
  loadingOrderShares,
  shareLoadingOrder,
  type ShareLoadingOrderSchema,
} from "./loading-order-share.js";
import { CentralStockOrderReportQuerySchema, CreateCentralStockOrderSchema, CreateLoadingOrderSchema, LoadingOrderStatusSchema, ReceptionOrdersQuerySchema, ReceiveLoadingOrderSchema } from "./order.schema.js"
import type { EditOrderQuantitySchema, RequestOrderEditSchema } from "./order.schema.js";

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
  /**
   * Raises a loading order and tells the authorisers whose turn it is.
   *
   * The email is sent after the order is committed and never blocks it: an
   * order that exists with nobody told is a nuisance, one that failed to exist
   * because a mail server was down is worse.
   */
  async createLoadingOrders(input: CreateLoadingOrderSchema) {
    const orders = await this.repo.createLoadingOrders(input);
    for (const order of Array.isArray(orders) ? orders : [orders]) {
      const id = (order as { id?: string }).id;
      if (!id) continue;
      notifyLoadingOrderAuthorizers(this.repo.db, id).catch((error) => {
        console.error(`Could not notify the authorizers of loading order ${id}:`, error);
      });
    }
    return orders;
  }

  /** The loading order as a PDF, with the signatures once it is authorised. */
  async loadingOrderDocument(id: string) {
    const order = await loadingOrderForDocument(this.repo.db, id);
    const company = await this.documentCompany();
    return { pdf: await renderLoadingOrderPdf(order, company), fileName: loadingOrderFileName(order) };
  }

  async shareLoadingOrder(id: string, input: ShareLoadingOrderSchema, actor: AuthUser) {
    return shareLoadingOrder(this.repo.db, id, input, actor.userId, await this.documentCompany());
  }

  loadingOrderShares(id: string) {
    return loadingOrderShares(this.repo.db, id);
  }

  /** What the document is issued under; the bare name until a profile is saved. */
  private async documentCompany() {
    const settings = await this.repo.db.companySettings.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { companyName: true, address: true, phone: true, email: true, taxId: true, logoPath: true },
    });
    return {
      name: settings?.companyName || this.config.COMPANY_NAME,
      address: settings?.address ?? null,
      phone: settings?.phone ?? null,
      email: settings?.email ?? null,
      taxId: settings?.taxId ?? null,
      logoPath: settings?.logoPath ?? null,
    };
  }
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

  changeOrderStatus(id: string, status: CentralOrderStatus, actor: AuthUser) {
    if (isSiteBound(actor)) throw forbidden("Only head office can approve, reject or cancel stockout orders");
    return this.repo.changeOrderStatus(id, status, actor.userId);
  }

  /**
   * Head office asking the site to change the quantity it asked for. The same
   * decision as approving or rejecting, so the same people may make it.
   */
  requestEdit(id: string, input: RequestOrderEditSchema, actor: AuthUser) {
    if (isSiteBound(actor)) {
      throw forbidden("Only head office can send a stockout request back to be changed");
    }
    return this.repo.requestEdit(id, input.comment, actor.userId);
  }

  /**
   * The site changing what it asked for, while the request is open for changes.
   *
   * A site manager may only touch their own site's request: the repository
   * refuses anything that is not in `editing`, and this refuses another site's.
   */
  async editQuantity(id: string, input: EditOrderQuantitySchema, actor: AuthUser) {
    if (isSiteBound(actor)) {
      const order = await this.repo.findOrder(id);
      if (!order) throw new NotFoundError("Central stock order not found");
      if (order.siteId !== this.requireSite(actor)) {
        throw forbidden("You can only change your own site's request");
      }
    }
    return this.repo.editQuantity(id, input.quantity, input.comment, actor.userId);
  }

  events(id: string) {
    return this.repo.events(id);
  }
}
