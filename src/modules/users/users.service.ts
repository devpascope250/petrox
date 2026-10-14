import bcrypt from "bcryptjs";
import type { AppConfig } from "../../config/env.js";
import type { AuthUser } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { generateTemporaryPin, hashPin } from "../../utils/crypto.js";
import { BusinessError, NotFoundError, forbidden } from "../../utils/errors.js";
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

  /**
   * What a create-user form may offer: the positions this actor is allowed to
   * create, each with the extra field it requires, plus the lists those fields
   * select from. The rules mirror `create` exactly, so the form can never offer
   * a choice the API would then reject.
   */
  async formOptions(actor: AuthUser) {
    if (actor.position !== "superAdmin" && actor.position !== "clientAdmin") {
      throw forbidden("Only super administrators and client administrators can create users");
    }
    const isClientAdmin = actor.position === "clientAdmin";
    if (isClientAdmin && !actor.clientId) {
      throw forbidden("Your user account is not assigned to a client");
    }

    const [sites, clients] = await this.repo.formOptions(
      isClientAdmin ? actor.clientId! : undefined
    );

    // A client administrator may only ever create client users for its own
    // client, so it is offered that one position and no sites.
    const positions = isClientAdmin
      ? [{ value: "clientUser", label: "Client user", requires: "clientId" }]
      : [
          { value: "siteManager", label: "Site manager", requires: "siteId" },
          { value: "clientAdmin", label: "Client administrator", requires: "clientDetails" },
          { value: "clientUser", label: "Client user", requires: "clientId" },
          { value: "superAdmin", label: "Super administrator", requires: null },
          { value: "others", label: "Other site staff", requires: null }
        ];

    return { positions, sites: isClientAdmin ? [] : sites, clients };
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
    const user = await this.repo.create(
      input,
      await bcrypt.hash(input.password, 12),
      hashPin(input.pin ?? temporaryPin!, this.config.PIN_HMAC_SECRET)
    );
    return { ...user, ...(temporaryPin ? { temporaryPin } : {}) };
  }

  /** `find` for request handlers, so a caller cannot read outside its reach. */
  async get(id: string, actor: AuthUser) {
    const user = await this.find(id);
    this.assertCanManage(user, actor);
    return user;
  }

  async update(id: string, input: UpdateUserInput, actor: AuthUser) {
    const target = await this.find(id);
    this.assertCanManage(target, actor);
    const { password, pin, ...profile } = input;

    const changesAccess = profile.roleId !== undefined || profile.position !== undefined;
    // Otherwise a client administrator could promote a user, or itself, into
    // an administrative role or position.
    if (changesAccess && actor.position !== "superAdmin") {
      throw forbidden("Only super administrators can change a user's role or position");
    }
    // Guards against locking yourself out, or quietly widening your own access.
    if (changesAccess && id === actor.userId) {
      throw forbidden("You cannot change your own role or position");
    }
    if (profile.position !== undefined && profile.position !== target.position) {
      const isClient = (position: string | null) =>
        position === "clientAdmin" || position === "clientUser";
      // This endpoint has no field for the client, so moving into or out of a
      // client position would leave the user attached to the wrong one, or none.
      if (isClient(target.position) || isClient(profile.position)) {
        throw new BusinessError(
          "POSITION_CHANGE_NOT_ALLOWED",
          "Only staff positions can be changed here. Client users stay attached to their client."
        );
      }
    }

    return this.repo.update(id, {
      ...profile,
      ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
      ...(pin !== undefined
        ? { pinHash: pin ? hashPin(pin, this.config.PIN_HMAC_SECRET) : null }
        : {})
    });
  }

  async changeStatus(id: string, actor: AuthUser) {
    if (id === actor.userId) throw forbidden("You cannot deactivate your own account");
    this.assertCanManage(await this.find(id), actor);
    return this.repo.updateStatus(id);
  }

  async assignSite(userId: string, siteId: string, actor: AuthUser) {
    this.assertCanManage(await this.find(userId), actor);
    if (!(await this.repo.findSite(siteId))) throw new NotFoundError("Site");
    return this.repo.assignSite(userId, siteId);
  }

  async delete(id: string, actor: AuthUser) {
    if (id === actor.userId) throw forbidden("You cannot delete your own account");
    this.assertCanManage(await this.find(id), actor);
    return this.repo.delete(id);
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
}
