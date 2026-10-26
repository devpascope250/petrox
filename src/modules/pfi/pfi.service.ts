import type { AppConfig } from "../../config/env.js";
import { documentUrl } from "../../utils/static-url.js";
import { DatesQuerySchema } from "../../shared/validation/primitives.js";
import { within2DaysPeriod } from "../../utils/utils.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PagedDatesQuery } from "../../shared/validation/index.js";
import { Prisma } from "../../../prisma/generated/prisma/client.js";
import { totalsOf } from "../fees/fee.repository.js";
import { PfiRepository } from "./pfi.repository.js";
import { CreateCurrancySchema, CreatePfiSchema } from "./pfi.schema.js";
export class PfiService {
  constructor(private repo: PfiRepository, private config: AppConfig) {
  }

  async list(query: PagedDatesQuery) {
    // No window asked for still means a window: the last two days.
    const dates = within2DaysPeriod(query.startDate, query.endDate);
    const [pfis, total] = await this.repo.list({ ...query, ...dates });
    return paginatedData(
      pfis.map((pfi) => this.withFees(this.withDocumentUrl(pfi))),
      total,
      query,
    );
  }

  /**
   * What the fees on a proforma come to, beside its own amount — grouped by
   * currency, since a fee is not always in the money of the invoice.
   */
  private withFees<T extends { fees?: Array<{ count: number; unitAmount: Prisma.Decimal; currencyCode: string }> }>(
    pfi: T,
  ) {
    const fees = pfi.fees ?? [];
    return { ...pfi, feeTotals: totalsOf(fees).byCurrency };
  }
  async find(id: string) {
    const pfi = await this.repo.find(id);
    return pfi ? this.withDocumentUrl(pfi) : pfi;
  }

  async create(input: CreatePfiSchema) {
    return this.withDocumentUrl(await this.repo.create(input));
  }

  async update(id: string, input: CreatePfiSchema) {
    return this.withDocumentUrl(await this.repo.update(id, input));
  }

  private withDocumentUrl<T extends { supportingDocUrl: string | null }>(pfi: T): T {
    // `STATIC_URL` is the public address uploads are served at, so the document
    // opens from the web app's own origin too — see `documentUrl`.
    return { ...pfi, supportingDocUrl: documentUrl(this.config, pfi.supportingDocUrl) };
  }

  async updateCurrency(id: string, input: CreateCurrancySchema) {
    return await this.repo.updateCurrency(id, input);
  }

  async createCurrency(data: CreateCurrancySchema) {
    return await this.repo.createCurrency(data);
  }

  async listCurrency() {
    return await this.repo.listCurrency()
  }

}
