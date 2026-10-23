import { paginatedData } from "../../shared/pagination/index.js";
import { VehicleLocationRepository } from "./vehicle-location.repository.js";
import type {
  AssignVehicleLocationSchema,
  MarkArrivedSchema,
  VehicleLocationListQuery,
} from "./vehicle-location.schema.js";

export class VehicleLocationService {
  constructor(private repo: VehicleLocationRepository) {}

  async list(query: VehicleLocationListQuery) {
    const [items, total] = await this.repo.list(query);
    return paginatedData(items, total, query);
  }

  /** Where a trip's vehicle stands now, and everywhere it has stood. */
  async forNomination(nominationId: string) {
    const [current, history] = await Promise.all([
      this.repo.activeForNomination(nominationId),
      this.repo.historyForNomination(nominationId),
    ]);
    return { current, history };
  }

  assign(input: AssignVehicleLocationSchema, userId: string) {
    return this.repo.assign(input, userId);
  }

  markArrived(id: string, input: MarkArrivedSchema) {
    return this.repo.markArrived(id, input.arrivedAt ?? new Date());
  }
}
