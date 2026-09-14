import { paginatedData } from "../../shared/pagination/index.js";
import type { AuthUser } from "../../shared/auth/context-user.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { BusinessError, NotFoundError, forbidden } from "../../utils/errors.js";
import { ClientWalletRepository } from "./client-wallet.repository.js";
import type {
  CreateClientWalletInput,
  TransferWalletToCardInput,
  BuyWalletCouponsInput,
  CreateWalletMovementInput,
  UpdateClientWalletInput,
  WalletMovementQuery
} from "./client-wallet.schema.js";
import { within2DaysPeriod } from "../../utils/utils.js";

export class ClientWalletService {
  constructor(private repo: ClientWalletRepository) {}

  async list(query: PaginationQuery, actor: AuthUser) {
    const [items, total] = await this.repo.list(query, this.clientScope(actor));
    return paginatedData(items, total, query);
  }

  async find(id: string, actor: AuthUser) {
    const wallet = await this.repo.find(id, this.clientScope(actor));
    if (!wallet) throw new NotFoundError("Client wallet");
    return wallet;
  }

  async create(input: CreateClientWalletInput, actor: AuthUser) {
    this.assertClientAccess(input.clientId, actor);
    await this.ensureClientExists(input.clientId);
    return this.repo.create(input, actor.userId);
  }

  async update(id: string, input: UpdateClientWalletInput, actor: AuthUser) {
    await this.find(id, actor);
    this.assertClientAccess(input.clientId, actor);
    await this.ensureClientExists(input.clientId);
    return this.repo.update(id, input, this.clientScope(actor));
  }

  async changeStatus(id: string, actor: AuthUser) {
    const clientId = this.clientScope(actor);
    const wallet = await this.find(id, actor);
    const status = wallet.status === "active" ? "inactive" : "active";
    return this.repo.changeStatus(id, status, clientId);
  }

  async listMovements(id: string, query: WalletMovementQuery, actor: AuthUser) {
    await this.find(id, actor);
    const dates = within2DaysPeriod(query.startDate, query.endDate);
    const [items, total] = await this.repo.listMovements(id, { ...query, ...dates });
    return paginatedData(items, total, query);
  }

  async createMovement(id: string, input: CreateWalletMovementInput, actor: AuthUser) {
    const wallet = await this.find(id, actor);
    if (wallet.status !== "active") {
      throw new BusinessError("WALLET_INACTIVE", "Movements cannot be made on an inactive wallet");
    }
    return this.repo.createMovement(id, input, this.clientScope(actor));
  }

  transferToCard(id: string, input: TransferWalletToCardInput, actor: AuthUser) {
    return this.repo.transferToCard(id, input, actor.userId, this.clientScope(actor));
  }

  buyCoupons(id: string, input: BuyWalletCouponsInput, actor: AuthUser) {
    return this.repo.buyCoupons(id, input, this.clientScope(actor));
  }

  private async ensureClientExists(clientId: string) {
    if (!(await this.repo.findClient(clientId))) throw new NotFoundError("Client");
  }

  private clientScope(actor: AuthUser) {
    if (actor.position === "superAdmin" || actor.position === "siteManager") return undefined;
    if (!actor.clientId) throw forbidden("Your user account is not assigned to a client");
    return actor.clientId;
  }

  private assertClientAccess(clientId: string, actor: AuthUser) {
    const scopedClientId = this.clientScope(actor);
    if (scopedClientId && clientId !== scopedClientId) {
      throw forbidden("You can only manage wallets for your own client");
    }
  }
}
