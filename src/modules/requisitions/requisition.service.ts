import type { AuthUser } from "../../shared/auth/context-user.js";
import { isSiteBound } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError, forbidden } from "../../utils/errors.js";
import { RequisitionRepository } from "./requisition.repository.js";
import type {
  AcceptRequisitionSchema,
  CreateRequisitionSchema,
  EditRequisitionSchema,
  RequisitionListQuery,
} from "./requisition.schema.js";

/**
 * A station asking head office for stock.
 *
 * Who may do what is decided here rather than by the schema: a station raises
 * and corrects its own requisitions, head office decides them. A station
 * manager is held to their own station throughout — on the list, on the one
 * record, and on every move.
 */
export class RequisitionService {
  constructor(private repo: RequisitionRepository) {}

  /** The station a site-bound actor is pinned to; nothing for head office. */
  private scope(actor: AuthUser): string | undefined {
    if (!isSiteBound(actor)) return undefined;
    if (!actor.siteId) throw forbidden("Your account is not assigned to a station");
    return actor.siteId;
  }

  async list(query: RequisitionListQuery, actor: AuthUser) {
    const siteId = this.scope(actor);
    const [[items, total], counts] = await Promise.all([
      this.repo.list(query, siteId),
      this.repo.counts(query, siteId),
    ]);
    // The per-rung counts travel with the page so the stepper's header does not
    // need a second round trip, and cannot disagree with the rows.
    return { ...paginatedData(items, total, query), counts };
  }

  steps() { return this.repo.steps(); }

  async find(id: string, actor: AuthUser) {
    const requisition = await this.repo.find(id);
    if (!requisition) throw new NotFoundError("Requisition");
    this.assertReachable(requisition.siteId, actor);
    return requisition;
  }

  async timeline(id: string, actor: AuthUser) {
    await this.find(id, actor);
    return this.repo.timeline(id);
  }

  /**
   * What the cleared stock can still serve for each product on it.
   *
   * Read before deciding, so whoever accepts sees the figure rather than
   * meeting it as a refusal.
   */
  async availability(id: string, actor: AuthUser) {
    await this.find(id, actor);
    return this.repo.availability(id);
  }

  /** The loads carrying it, and how far their authorization has got. */
  async loads(id: string, actor: AuthUser) {
    await this.find(id, actor);
    return this.repo.loads(id);
  }

  /**
   * Raises one. A site-bound actor's own station is used whatever the request
   * said; head office must name a station, since it has none of its own.
   */
  async create(input: CreateRequisitionSchema, actor: AuthUser) {
    const own = this.scope(actor);
    const siteId = own ?? input.siteId;
    if (!siteId) throw new BusinessError("SITE_REQUIRED", "Name the station this is for");
    return this.repo.create({ ...input, siteId, requestedBy: actor.userId });
  }

  /** Accepting is head office's decision, never the station's. */
  async accept(id: string, input: AcceptRequisitionSchema, actor: AuthUser) {
    await this.assertHeadOffice(id, actor);
    return this.repo.accept(id, input, actor.userId);
  }

  async reject(id: string, comment: string, actor: AuthUser) {
    await this.assertHeadOffice(id, actor);
    return this.repo.decide(id, "rejected", comment, actor.userId);
  }

  async requestChange(id: string, comment: string, actor: AuthUser) {
    await this.assertHeadOffice(id, actor);
    return this.repo.decide(id, "changeRequested", comment, actor.userId);
  }

  /**
   * Withdrawn. The station may withdraw its own while it is still undecided;
   * head office may withdraw any.
   */
  async cancel(id: string, comment: string, actor: AuthUser) {
    const requisition = await this.owned(id, actor);
    if (isSiteBound(actor) && requisition.requestedBy !== actor.userId) {
      throw forbidden("Only whoever raised a requisition can withdraw it");
    }
    return this.repo.decide(id, "cancelled", comment, actor.userId);
  }

  /** The station's own correction, after it was handed back. */
  async edit(id: string, input: EditRequisitionSchema, actor: AuthUser) {
    const requisition = await this.owned(id, actor);
    // Head office does not retype the figure: the station owns the request, so
    // it goes back with a reason and they change it.
    if (!isSiteBound(actor) && requisition.requestedBy !== actor.userId) {
      throw forbidden("A requisition is corrected by the station that raised it");
    }
    return this.repo.edit(id, input, actor.userId);
  }

  private async owned(id: string, actor: AuthUser) {
    const requisition = await this.repo.owner(id);
    if (!requisition) throw new NotFoundError("Requisition");
    this.assertReachable(requisition.siteId, actor);
    return requisition;
  }

  private async assertHeadOffice(id: string, actor: AuthUser) {
    if (isSiteBound(actor)) {
      throw forbidden("A station cannot decide its own requisition");
    }
    const requisition = await this.repo.owner(id);
    if (!requisition) throw new NotFoundError("Requisition");
    return requisition;
  }

  private assertReachable(siteId: string, actor: AuthUser) {
    const own = this.scope(actor);
    if (own && own !== siteId) throw new NotFoundError("Requisition");
  }
}
