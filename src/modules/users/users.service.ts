import bcrypt from "bcryptjs";
import type { AppConfig } from "../../config/env.js";
import type { AuthUser } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { generateTemporaryPin, hashPin } from "../../utils/crypto.js";
import { NotFoundError, forbidden } from "../../utils/errors.js";
import type { CreateUserInput, UpdateUserInput } from "./users.schema.js";
import { UsersRepository } from "./users.repository.js";

export class UsersService {
  constructor(private repo: UsersRepository, private config: AppConfig) {}

  async list(query: PaginationQuery) {
    const [items, total] = await this.repo.list(query);
    return paginatedData(items, total, query);
  }

  async find(id: string) {
    const user = await this.repo.find(id);
    if (!user) throw new NotFoundError("User");
    return user;
  }

  async create(input: CreateUserInput, actor: AuthUser) {
    if (actor.position === "clientAdmin") {
      if (input.position !== "clientUser") {
        throw forbidden("Client administrators can only create client users");
      }
      if (!actor.clientId || input.clientId !== actor.clientId) {
        throw forbidden("Client administrators can only create users for their own client");
      }
    } else if (actor.position !== "superAdmin") {
      throw forbidden("Only super administrators and client administrators can create users");
    }

    const temporaryPin = generateTemporaryPin();
    const user = await this.repo.create(
      input,
      await bcrypt.hash(input.password, 12),
      hashPin(temporaryPin, this.config.PIN_HMAC_SECRET)
    );
    return { ...user, temporaryPin };
  }

  async update(id: string, input: UpdateUserInput) {
    await this.find(id);
    const { password, pin, ...profile } = input;
    return this.repo.update(id, {
      ...profile,
      ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
      ...(pin !== undefined
        ? { pinHash: pin ? hashPin(pin, this.config.PIN_HMAC_SECRET) : null }
        : {})
    });
  }

  changeStatus(id: string) {
    return this.repo.updateStatus(id);
  }

  async assignSite(userId: string, siteId: string) {
    await this.find(userId);
    if (!(await this.repo.findSite(siteId))) throw new NotFoundError("Site");
    return this.repo.assignSite(userId, siteId);
  }

  async delete(id: string, actor: AuthUser) {
    if (id === actor.userId) throw forbidden("You cannot delete your own account");
    await this.find(id);
    return this.repo.delete(id);
  }
}
