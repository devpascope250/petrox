import type { AuthUser } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { ConflictError, NotFoundError, forbidden } from "../../utils/errors.js";
import { CardsRepository } from "./cards.repository.js";
import type {
  AssignCardsInput,
  BindSerialNumberInput,
  CardClientQuery,
  CardCopyListQuery,
  CardListQuery,
  CardTransactionQuery,
  CreateCardCopyInput,
  CreateCardInput,
  UpdateCardCopyInput,
  UpdateCardInput
} from "./cards.schema.js";

export class CardsService {
  constructor(private repo: CardsRepository) {}

  async listCards(query: CardListQuery, actor: AuthUser) {
    const [items, total] = await this.repo.listCards(query, this.clientScope(actor));
    return paginatedData(items, total, query);
  }

  async findCard(id: bigint, actor: AuthUser) {
    const card = await this.repo.findCard(id, this.clientScope(actor));
    if (!card) throw new NotFoundError("Card");
    return card;
  }

  async listTransactions(id: bigint, query: CardTransactionQuery, actor: AuthUser) {
    await this.findCard(id, actor);
    const [items, total] = await this.repo.listTransactions(id, query);
    return paginatedData(items, total, query);
  }

  async createCard(input: CreateCardInput) {
    if (input.serialNumber) await this.assertSerialNumberFree(input.serialNumber);
    return this.repo.createCard(input);
  }

  async updateCard(id: bigint, input: UpdateCardInput, actor: AuthUser) {
    await this.findCard(id, actor);
    if (input.serialNumber) await this.assertSerialNumberFree(input.serialNumber, id);
    return this.repo.updateCard(id, input);
  }

  /**
   * Ties a record in the inventory to the physical card someone can hold, by
   * the number printed on it. Binding the number a card already carries is a
   * no-op rather than an error, so a double scan is harmless.
   */
  async bindSerialNumber(id: bigint, input: BindSerialNumberInput, actor: AuthUser) {
    const card = await this.findCard(id, actor);
    if (card.serialNumber === input.serialNumber) return card;
    await this.assertSerialNumberFree(input.serialNumber, id);
    return this.repo.bindSerialNumber(id, input.serialNumber);
  }

  /** Releases the number, so the physical card can be bound elsewhere. */
  async unbindSerialNumber(id: bigint, actor: AuthUser) {
    const card = await this.findCard(id, actor);
    if (card.serialNumber === null) return card;
    return this.repo.bindSerialNumber(id, null);
  }

  /**
   * What a given number is bound to, for checking before binding. Returns null
   * rather than a 404 — "nothing holds this number" is the good answer here.
   */
  findCardBySerialNumber(serialNumber: string, actor: AuthUser) {
    this.clientScope(actor);
    return this.repo.findCardBySerialNumber(serialNumber);
  }

  /**
   * A serial number identifies one physical card, so it can only be bound
   * once. The refusal names the card holding it — and the client it is
   * assigned to — since "already exists" alone leaves no way to act on it.
   */
  private async assertSerialNumberFree(serialNumber: string, excludedCardId?: bigint) {
    const holder = await this.repo.findCardBySerialNumber(serialNumber);
    if (!holder || (excludedCardId && holder.id === excludedCardId.toString())) return;
    const label = holder.cardNumber ? `card ${holder.cardNumber}` : `card #${holder.id}`;
    const assignment = holder.assignedTo
      ? `, assigned to ${holder.assignedTo.name || holder.assignedTo.clientCode}`
      : "";
    throw new ConflictError(
      "SERIAL_NUMBER_TAKEN",
      `Serial number ${serialNumber} is already bound to ${label}${assignment}`,
      { serialNumber, card: holder }
    );
  }

  async deleteCard(id: bigint, actor: AuthUser) {
    await this.findCard(id, actor);
    return this.repo.deleteCard(id);
  }

  async listCopies(query: CardCopyListQuery, actor: AuthUser) {
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

  /**
   * Hands several free cards to one client, as main cards and copies of them.
   * A copy's main card is either assigned as a main card in the same request,
   * or one the client already holds.
   */
  async assignCards(input: AssignCardsInput, actor: AuthUser) {
    this.assertClientAccess(input.clientId, actor);
    await this.ensureClient(input.clientId);
    for (const card of input.cards) await this.ensureAvailableCard(card.cardId);
    const mainsHere = new Set(input.cards.filter((card) => card.copyOf === undefined).map((card) => String(card.cardId)));
    for (const card of input.cards) {
      if (card.copyOf === undefined || mainsHere.has(String(card.copyOf))) continue;
      if (!(await this.repo.findClientMainCard(input.clientId, card.copyOf))) {
        throw new ConflictError(
          "INVALID_MAIN_CARD",
          "A copy must be made of a main card assigned in the same request or already held by this client"
        );
      }
    }
    return this.repo.assignCards(input);
  }

  async searchClients(query: CardClientQuery, actor: AuthUser) {
    const [items, total] = await this.repo.searchClients(query, this.clientScope(actor));
    return paginatedData(items, total, query);
  }

  /**
   * A client's cards as the operator thinks of them: each main card, with the
   * copies made of it beneath.
   *
   * An assignment without a copy card is the main card's own; one with a copy
   * card is a copy of it. `assignmentId` is what new copies are added through —
   * the main card's own assignment, or failing that one of its active copies.
   */
  async clientCards(clientId: string, actor: AuthUser) {
    this.assertClientAccess(clientId, actor);
    const client = await this.repo.findClientSummary(clientId);
    if (!client) throw new NotFoundError("Client");
    const assignments = await this.repo.listClientAssignments(clientId);

    type Assignment = (typeof assignments)[number];
    const groups = new Map<string, {
      main: Assignment | null;
      card: Assignment["card"];
      copies: Assignment[];
    }>();
    for (const assignment of assignments) {
      const group = groups.get(assignment.cardId) ?? { main: null, card: assignment.card, copies: [] };
      if (assignment.cardCopyId) group.copies.push(assignment);
      else group.main ??= assignment;
      groups.set(assignment.cardId, group);
    }

    const cards = [...groups.values()].map(({ main, card, copies }) => {
      const active = main?.status || copies.some((copy) => copy.status);
      const anchor = main?.status ? main : (copies.find((copy) => copy.status) ?? main ?? copies[0]!);
      return {
        card,
        assignmentId: anchor.id,
        mainAssignmentId: main?.id ?? null,
        status: main ? main.status : active,
        copies: copies.map((copy) => ({
          assignmentId: copy.id,
          card: copy.copyCard!,
          lastIndex: copy.lastIndex,
          status: copy.status
        }))
      };
    });
    return { client, cards };
  }

  async updateCopy(id: bigint, input: UpdateCardCopyInput, actor: AuthUser) {
    await this.findCopy(id, actor);
    if (input.clientId) {
      this.assertClientAccess(input.clientId, actor);
      await this.ensureClient(input.clientId);
    }
    return this.repo.updateCopy(id, input);
  }

  /** Changes an assignment's PIN, or resets it to the default when `pin` is left out. */
  async setPin(id: bigint, pin: string | undefined, actor: AuthUser) {
    await this.findCopy(id, actor);
    return this.repo.setPin(id, pin);
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

  /**
   * Gives the assignment's main card more copies. The main card is already
   * held by this assignment, so only the copy cards need to be free.
   */
  async addCopyCards(id: bigint, cardCopyIds: bigint[], actor: AuthUser) {
    const assignment = await this.findCopy(id, actor);
    if (!assignment.status) {
      throw new ConflictError("ASSIGNMENT_INACTIVE", "Activate the assignment before adding copies to it");
    }
    if (cardCopyIds.some((cardCopyId) => BigInt(assignment.cardId) === cardCopyId)) {
      throw new ConflictError("INVALID_CARD_COPY", "Copy card must be different from the main card");
    }
    for (const cardCopyId of cardCopyIds) await this.ensureAvailableCard(cardCopyId);
    return this.repo.addCopyCards(id, cardCopyIds);
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
