import type { AuthUser } from "../../shared/auth/context-user.js";
import { forbidden, NotFoundError } from "../../utils/errors.js";
import { ClientCarRepository } from "./client-car.repository.js";
import type { ClientCarListQuery, CreateClientCar, UpdateClientCar } from "./client-car.schema.js";

/**
 * Head office (super admin and other staff with the permission) works on any
 * client's cars. A client's own users only ever see and touch their client's.
 */
function clientScope(actor: AuthUser): string | undefined {
  if (actor.position !== "clientAdmin" && actor.position !== "clientUser") return undefined;
  if (!actor.clientId) throw forbidden("Your account is not linked to a client");
  return actor.clientId;
}

export class ClientCarService {
  constructor(private repo: ClientCarRepository) {}

  private assertClient(clientId: string, actor: AuthUser) {
    const scoped = clientScope(actor);
    if (scoped && scoped !== clientId) throw forbidden("You can only manage your own client's cars");
  }

  /** Loads a car and checks the caller may work on it; another client's car reads as not found. */
  private async carFor(id: string, actor: AuthUser) {
    const car = await this.repo.find(id);
    const scoped = clientScope(actor);
    if (scoped && car.clientId !== scoped) throw new NotFoundError("Car");
    return car;
  }

  list(query: ClientCarListQuery, actor: AuthUser) {
    return this.repo.list(query, clientScope(actor));
  }

  async find(id: string, actor: AuthUser) {
    await this.carFor(id, actor);
    return this.repo.findWithHistory(id);
  }

  async create(input: CreateClientCar, actor: AuthUser) {
    this.assertClient(input.clientId, actor);
    const client = await this.repo.findClient(input.clientId);
    if (!client) throw new NotFoundError("Client");
    return this.repo.create(input);
  }

  async update(id: string, input: UpdateClientCar, actor: AuthUser) {
    await this.carFor(id, actor);
    return this.repo.update(id, input);
  }

  async changeStatus(id: string, actor: AuthUser) {
    await this.carFor(id, actor);
    return this.repo.changeStatus(id);
  }

  items() {
    return this.repo.items();
  }

  clients(search: string | undefined, actor: AuthUser) {
    return this.repo.clients(search, clientScope(actor));
  }

  async clientCards(clientId: string, actor: AuthUser) {
    this.assertClient(clientId, actor);
    return this.repo.clientCards(clientId);
  }

  async assignCards(id: string, cardCopyIds: bigint[], actor: AuthUser) {
    await this.carFor(id, actor);
    return this.repo.assignCards(id, cardCopyIds);
  }

  async unassignCard(id: string, cardCopyId: bigint, actor: AuthUser) {
    await this.carFor(id, actor);
    return this.repo.unassignCard(id, cardCopyId);
  }
}
