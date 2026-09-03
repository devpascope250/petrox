import type { AuthUser } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { ConflictError, NotFoundError, forbidden } from "../../utils/errors.js";
import { CardsRepository } from "./cards.repository.js";
import type {
  CreateCardCopyInput,
  CreateCardInput,
  UpdateCardCopyInput,
  UpdateCardInput
} from "./cards.schema.js";

export class CardsService {
  constructor(private repo: CardsRepository) {}

  async listCards(query: PaginationQuery, actor: AuthUser) {
    const [items, total] = await this.repo.listCards(query, this.clientScope(actor));
    return paginatedData(items, total, query);
  }

  async findCard(id: bigint, actor: AuthUser) {
    const card = await this.repo.findCard(id, this.clientScope(actor));
    if (!card) throw new NotFoundError("Card");
    return card;
  }

  createCard(input: CreateCardInput) { return this.repo.createCard(input); }

  async updateCard(id: bigint, input: UpdateCardInput, actor: AuthUser) {
    await this.findCard(id, actor);
    return this.repo.updateCard(id, input);
  }

  async deleteCard(id: bigint, actor: AuthUser) {
    await this.findCard(id, actor);
    return this.repo.deleteCard(id);
  }

  async listCopies(query: PaginationQuery, actor: AuthUser) {
    const [items, total] = await this.repo.listCopies(query, this.clientScope(actor));
    return paginatedData(items, total, query);
  }

  async findCopy(id: bigint, actor: AuthUser) {
    const copy = await this.repo.findCopy(id, this.clientScope(actor));
    if (!copy) throw new NotFoundError("Card assignment");
    return copy;
  }

  async createCopy(input: CreateCardCopyInput, actor: AuthUser) {
    this.assertClientAccess(input.clientId, actor);
    await this.ensureClient(input.clientId);
    await this.ensureAvailableCard(input.cardId);
    if (input.cardCopyId) await this.ensureAvailableCard(input.cardCopyId);
    return this.repo.createCopy(input);
  }

  async updateCopy(id: bigint, input: UpdateCardCopyInput, actor: AuthUser) {
    await this.findCopy(id, actor);
    if (input.clientId) {
      this.assertClientAccess(input.clientId, actor);
      await this.ensureClient(input.clientId);
    }
    return this.repo.updateCopy(id, input);
  }

  async assignCopyCard(id: bigint, cardCopyId: bigint, actor: AuthUser) {
    const assignment = await this.findCopy(id, actor);
    if (BigInt(assignment.cardId) === cardCopyId) {
      throw new ConflictError("INVALID_CARD_COPY", "Copy card must be different from the main card");
    }
    if (assignment.cardCopyId && BigInt(assignment.cardCopyId) === cardCopyId) return assignment;
    await this.ensureAvailableCard(cardCopyId, id);
    return this.repo.assignCopyCard(id, cardCopyId);
  }

  async changeCopyStatus(id: bigint, actor: AuthUser) {
    const assignment = await this.findCopy(id, actor);
    return this.repo.changeCopyStatus(id, !assignment.status);
  }

  async deleteCopy(id: bigint, actor: AuthUser) {
    await this.findCopy(id, actor);
    return this.repo.deleteCopy(id);
  }

  private async ensureClient(id: string) {
    if (!(await this.repo.findClient(id))) throw new NotFoundError("Client");
  }

  private async ensureAvailableCard(id: bigint, excludedCopyId?: bigint) {
    const card = await this.repo.findRawCard(id);
    if (!card) throw new NotFoundError("Card");
    if (!card.availability) {
      throw new ConflictError("CARD_UNAVAILABLE", "Card is unavailable");
    }
    if (await this.repo.findActiveAssignment(id, excludedCopyId)) {
      throw new ConflictError("CARD_ALREADY_ASSIGNED", "Card is already assigned to a client");
    }
  }

  private clientScope(actor: AuthUser) {
    if (actor.position === "superAdmin" || actor.position === "siteManager") return undefined;
    if (!actor.clientId) throw forbidden("Your user account is not assigned to a client");
    return actor.clientId;
  }

  private assertClientAccess(clientId: string, actor: AuthUser) {
    const scope = this.clientScope(actor);
    if (scope && scope !== clientId) throw forbidden("You can only manage cards for your own client");
  }
}
