import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { CompanySettingsRepository } from "../../modules/company-settings/company-settings.repository.js";

/**
 * What every email shows about the company that sent it: the logo picture, the
 * name, and how to reach it. Taken from the company profile saved under System
 * settings, so a changed logo or address shows in the next email sent.
 */
export interface CompanyBrand {
  name: string;
  /** Full URL of the logo, or `null` when none is saved; emails cannot show a path. */
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxId: string | null;
}

export type CompanyBrandSource = () => Promise<CompanyBrand | null>;

let source: CompanyBrandSource | null = null;

/** Registered once at startup, so the mail templates can read the saved profile. */
export function useCompanyBrand(next: CompanyBrandSource | null) {
  source = next;
}

/**
 * The saved profile, or `null` when none is registered or saved yet — the
 * caller then falls back to the name and address in the environment. A failure
 * to read it never stops an email going out.
 */
export async function companyBrand(): Promise<CompanyBrand | null> {
  if (!source) return null;
  try {
    return await source();
  } catch (error) {
    console.error("Could not read the company profile for an email:", error);
    return null;
  }
}

/** Reads the profile straight from the database; the logo as a full URL. */
export function companyBrandFromDb(db: PrismaClient, staticBase?: string): CompanyBrandSource {
  const repo = new CompanySettingsRepository(db);
  return async () => {
    const company = await repo.receipt(staticBase);
    if (!company) return null;
    return {
      name: company.name,
      logoUrl: company.logoUrl,
      address: company.address,
      phone: company.phone,
      email: company.email,
      website: company.website,
      taxId: company.taxId,
    };
  };
}
