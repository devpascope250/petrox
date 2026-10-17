import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { staticUrl } from "../../utils/static-url.js";
import type { CompanySettingsInput } from "./company-settings.schema.js";

/** The company profile: a single row, created on first save. */
export class CompanySettingsRepository {
  constructor(private db: PrismaClient) {}

  get() {
    return this.db.companySettings.findFirst({ orderBy: { updatedAt: "desc" } });
  }

  /** Creates the row on first save, updates it after. Returns the saved row and the logo it replaced. */
  async save(
    input: Pick<CompanySettingsInput, "companyName" | "currency"> & Partial<Omit<CompanySettingsInput, "removeLogo">>,
    logoPath: string | null | undefined,
  ) {
    const current = await this.get();
    const data = { ...input, ...(logoPath !== undefined ? { logoPath } : {}) };
    const saved = current
      ? await this.db.companySettings.update({ where: { id: current.id }, data })
      : await this.db.companySettings.create({ data });
    const replacedLogo = logoPath !== undefined && current?.logoPath && current.logoPath !== logoPath ? current.logoPath : null;
    return { saved, replacedLogo };
  }

  /**
   * What a receipt prints about the company, or `null` until the profile has
   * been saved. The logo is a full URL, for a POS that fetches it.
   */
  async receipt(staticBase?: string) {
    const settings = await this.get();
    if (!settings?.companyName) return null;
    return {
      name: settings.companyName,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      taxId: settings.taxId,
      website: settings.website,
      currency: settings.currency,
      logoUrl: staticUrl(staticBase, settings.logoPath),
      receiptFooter: settings.receiptFooter,
    };
  }
}
