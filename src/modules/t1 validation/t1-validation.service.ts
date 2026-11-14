import { CargoStatus, ExtraT1ValidationStatus } from "../../../prisma/generated/prisma/enums.js";
import type { AppConfig } from "../../config/env.js";
import { within2DaysPeriod } from "../../utils/utils.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PagedDatesQuery } from "../../shared/validation/index.js";
import { T1RaiseRepository, T1ValidationRepository } from "./t1-validation.repository.js";
import {
  CreateExtraT1ValidationsSchema, CreateT1ValidationsSchema, T1ListQuery,
  T1RaiseOrdersQuery, T1RaiseTripsQuery, T1RaiseVehiclesQuery,
} from "./t1-validation.schema.js";
export class T1ValidationSrvice {
  constructor(private repo: T1ValidationRepository, private config: AppConfig) {
  }

  async listByCompleted() {
    const t1 = await this.repo.listByCompleted();
    return t1.map((al) => {
      return  {
        ...al,
        supportingDocUrl: `${this.config.APP_URL}${al.supportingDocUrl}`
      }
    })
  }

    async list(query: T1ListQuery) {
    // No window asked for still means a window: the last two days.
    const dates = within2DaysPeriod(query.startDate, query.endDate);
    const [t1, total] = await this.repo.list({ ...query, ...dates });
    const items = t1.map((al) => {
      return  {
        ...al,
        supportingDocUrl: `${this.config.APP_URL}${al.supportingDocUrl}`
      }
    });
    return paginatedData(items, total, query);
  }

  async find(id: string) { 
    const cargo = await this.repo.find(id);
    return {
      ...cargo,
      supportingDocUrl: `${this.config.APP_URL}${cargo?.supportingDocUrl}`
    }; 
  }

  create(input: CreateT1ValidationsSchema) {
    return this.repo.create(input);
  }

  createExtraT1(input: CreateExtraT1ValidationsSchema) {
    return this.repo.createExtraT1(input);
  }

  async update(id: string, extraT1Id: string, input: CreateT1ValidationsSchema) {
    return await this.repo.update(id, extraT1Id, input);
  }

  async updateStatus (id: string, status: ExtraT1ValidationStatus, createdAt?: string) {
    return await this.repo.changeStatus(id, status, createdAt);
  }

}

/**
 * Finding the trip a customs document belongs to: order, then truck, then the
 * trip. Each step is a page of a list, so a depot with thousands of trips
 * behaves like one with ten.
 */
export class T1RaiseService {
  constructor(private repo: T1RaiseRepository) {}

  async orders(query: T1RaiseOrdersQuery) {
    const [items, total] = await this.repo.orders(query);
    return paginatedData(items, total, query);
  }

  async vehicles(query: T1RaiseVehiclesQuery) {
    const [items, total] = await this.repo.vehicles(query);
    return paginatedData(items, total, query);
  }

  async trips(query: T1RaiseTripsQuery) {
    const [items, total] = await this.repo.trips(query);
    return paginatedData(items, total, query);
  }
}