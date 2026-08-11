import bcrypt from "bcryptjs";
import type { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { hashPin } from "../../utils/crypto.js";
import type { createUserSchema } from "./users.schema.js";
import { UsersRepository } from "./users.repository.js";
import { NotFoundError } from "../../utils/errors.js";

export class UsersService {
  constructor(private repo: UsersRepository, private config: AppConfig) {}

  async list(query: PaginationQuery) {
    const [items, total] = await this.repo.list(query);
    return paginatedData(items, total, query);
  }

  async find(id: string) { return await this.repo.find(id); }

  async create(input: z.infer<typeof createUserSchema>) {
    const { password, pin, ...profile } = input;
    return this.repo.create({
      ...profile,
      passwordHash: await bcrypt.hash(password, 12),
      pinHash: pin ? hashPin(pin, this.config.PIN_HMAC_SECRET) : null
    });
  }

  async changeStatus(id: string){
    return await this.repo.updateStatus(id);    
  }
}