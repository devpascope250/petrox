import bcrypt from "bcryptjs";
import type { AppConfig } from "../../config/env.js";
import type { AuthUser } from "../../shared/auth/context-user.js";
import { emailNewAccount } from "../../shared/emails/new-account-email.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { generateTemporaryPin, hashPin } from "../../utils/crypto.js";
import { hashClientPin } from "./client-pin.js";
import { BusinessError, NotFoundError, forbidden } from "../../utils/errors.js";
import type { CreateUserInput, UpdateClientDetailsInput, UpdateUserInput } from "./clients.schema.js";
import { ClientRepository } from "./clients.repository.js";

/** An organisation as shown: whether it has a coupon PIN, never the PIN itself. */
function presentOrganization<T extends { pinHash: string | null; users: unknown[] }>({ pinHash, ...client }: T) {
  return { ...client, hasPin: Boolean(pinHash), userCount: client.users.length };
}

export class ClientService {
  constructor(private repo: ClientRepository, private config: AppConfig) {}

  async list(query: PaginationQuery, actor: AuthUser) {
    const [items, total] = await this.repo.list(query, actor);
    return paginatedData(items, total, query);
  }

  /** The organisations, each with its users and whether it has a coupon PIN (never the PIN itself). */
  async organizations(query: PaginationQuery, actor: AuthUser) {
    const [rows, total] = await this.repo.organizations(query, actor);
    return paginatedData(rows.map(presentOrganization), total, query);
  }

  /** Edits an organisation's own details, PIN included. A client admin may only edit their own. */
  async updateOrganization(id: string, input: UpdateClientDetailsInput, actor: AuthUser) {
    if (!(await this.repo.findOrganization(id))) throw new NotFoundError("Client");
    this.assertCanManage({ clientId: id }, actor);
    return presentOrganization(await this.repo.updateOrganization(id, this.clientData(input)));
  }

  async find(id: string) {
    const user = await this.repo.find(id);
    if (!user) throw new NotFoundError("User");
    return user;
  }

  /** `find` for request handlers, so a caller cannot read outside its client. */
  async get(id: string, actor: AuthUser) {
    const user = await this.find(id);
    this.assertCanManage(user, actor);
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

    // The PIN entered on the form; without one, a generated PIN is shown once.
    const temporaryPin = input.pin ? undefined : generateTemporaryPin();
    const clientPin = input.position === "clientAdmin" ? input.clientDetails.pin : undefined;
    const user = await this.repo.create(
      input,
      await bcrypt.hash(input.password, 12),
      hashPin(input.pin ?? temporaryPin!, this.config.PIN_HMAC_SECRET),
      clientPin ? hashClientPin(clientPin, this.config.PIN_HMAC_SECRET) : undefined
    );
    // The password is only ever known here, so this is the one chance to send it.
    emailNewAccount(user, { password: input.password, pin: temporaryPin });
    return { ...user, ...(temporaryPin ? { temporaryPin } : {}) };
  }

  async update(id: string, input: UpdateUserInput, actor: AuthUser) {
    const target = await this.find(id);
    this.assertCanManage(target, actor);
    const { password, pin, clientDetails, ...profile } = input;

    // Only super administrators may move a user between roles; otherwise a
    // client administrator could grant itself an administrative role.
    if (profile.roleId !== undefined && actor.position !== "superAdmin") {
      throw forbidden("Only super administrators can change a user's role");
    }
    if (clientDetails && !target.clientId) {
      throw new BusinessError(
        "NOT_A_CLIENT_USER",
        "This user is not attached to a client, so client details cannot be updated"
      );
    }

    return this.repo.update(
      id,
      {
        ...profile,
        ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
        ...(pin !== undefined
          ? { pinHash: pin ? hashPin(pin, this.config.PIN_HMAC_SECRET) : null }
          : {})
      },
      clientDetails && target.clientId
        ? { id: target.clientId, data: this.clientData(clientDetails) }
        : undefined
    );
  }

  /** Client details as stored: a new PIN becomes its hash, `null` removes it. */
  private clientData({ pin, ...details }: NonNullable<UpdateUserInput["clientDetails"]>) {
    return {
      ...details,
      ...(pin !== undefined ? { pinHash: pin ? hashClientPin(pin, this.config.PIN_HMAC_SECRET) : null } : {}),
    };
  }

  /** A client administrator may only reach users inside its own client. */
  private assertCanManage(target: { clientId: string | null }, actor: AuthUser) {
    if (actor.position === "superAdmin") return;
    if (actor.position === "clientAdmin") {
      if (!actor.clientId || target.clientId !== actor.clientId) {
        throw forbidden("Client administrators can only manage users for their own client");
      }
      return;
    }
    throw forbidden("Only super administrators and client administrators can manage users");
  }

  async changeStatus(id: string, actor: AuthUser) {
    this.assertCanManage(await this.find(id), actor);
    return this.repo.updateStatus(id);
  }

  async delete(id: string, actor: AuthUser) {
    if (id === actor.userId) throw forbidden("You cannot delete your own account");
    this.assertCanManage(await this.find(id), actor);
    return this.repo.delete(id);
  }
}
