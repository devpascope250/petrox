import { paginatedData } from "../../shared/pagination/index.js";
import { ConflictError, NotFoundError } from "../../utils/errors.js";
import { ParkingRepository } from "./parking.repository.js";
import type { CreateParkingSchema, ParkingListQuery } from "./parking.schema.js";

export class ParkingService {
  constructor(private repo: ParkingRepository) {}

  async list(query: ParkingListQuery) {
    const [items, total] = await this.repo.list(query);
    return paginatedData(items, total, query);
  }

  active() {
    return this.repo.active();
  }

  async find(id: string) {
    const parking = await this.repo.find(id);
    if (!parking) throw new NotFoundError("Parking");
    return parking;
  }

  async create(input: CreateParkingSchema) {
    return this.guardDuplicate(() => this.repo.create(input), input);
  }

  async update(id: string, input: CreateParkingSchema) {
    return this.guardDuplicate(() => this.repo.update(id, input), input);
  }

  changeStatus(id: string) {
    return this.repo.changeStatus(id);
  }

  /**
   * One parking per name and place. The database says so too, so two requests
   * racing cannot both win; this only turns that into a message worth reading.
   */
  private async guardDuplicate<T>(write: () => Promise<T>, input: CreateParkingSchema) {
    try {
      return await write();
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new ConflictError(
          "PARKING_EXISTS",
          `A parking called "${input.name}" is already recorded at ${input.location}`,
        );
      }
      throw error;
    }
  }
}
