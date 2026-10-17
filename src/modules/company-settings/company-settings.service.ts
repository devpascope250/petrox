import { rm } from "node:fs/promises";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import { parseInput } from "../../shared/validation/index.js";
import { staticUrl } from "../../utils/static-url.js";
import { readMobileForm } from "../mobile/transactions/transaction-form.js";
import { CompanySettingsRepository } from "./company-settings.repository.js";
import { companySettingsSchema } from "./company-settings.schema.js";

/** Removes an uploaded file by its `/uploads/…` path; anything else is left alone. */
async function removeUpload(logoPath: string | null) {
  if (!logoPath?.startsWith("/uploads/")) return;
  await rm(path.join(process.cwd(), "uploads", path.basename(logoPath)), { force: true });
}

export class CompanySettingsService {
  constructor(private repo: CompanySettingsRepository, private staticBase?: string) {}

  /** The profile as the web form shows it; empty until first saved. */
  async get() {
    const settings = await this.repo.get();
    return {
      configured: Boolean(settings?.companyName),
      companyName: settings?.companyName ?? "",
      address: settings?.address ?? null,
      phone: settings?.phone ?? null,
      email: settings?.email ?? null,
      taxId: settings?.taxId ?? null,
      website: settings?.website ?? null,
      currency: settings?.currency ?? "RWF",
      receiptFooter: settings?.receiptFooter ?? null,
      logoUrl: staticUrl(this.staticBase, settings?.logoPath ?? null),
      updatedAt: settings?.updatedAt ?? null,
    };
  }

  /**
   * Saves the profile. JSON, or multipart when a `logo` image comes with it;
   * a new logo replaces the old one, whose file is then deleted.
   */
  async save(request: FastifyRequest) {
    let body: unknown = request.body;
    let uploaded: string | undefined;
    let discard = async () => undefined as void;
    if (request.isMultipart()) {
      const form = await readMobileForm(request, [{ field: /^logo$/, kind: "image" }], 1);
      body = form.fields;
      uploaded = form.files.logo;
      discard = form.discard;
    }
    try {
      const { removeLogo, ...input } = parseInput(companySettingsSchema, body);
      const logoPath = uploaded ?? (removeLogo ? null : undefined);
      const { replacedLogo } = await this.repo.save(input, logoPath);
      await removeUpload(replacedLogo);
      return this.get();
    } catch (error) {
      await discard();
      throw error;
    }
  }

  async removeLogo() {
    const current = await this.repo.get();
    if (current?.logoPath) {
      // Only the logo changes: every other field is left out, so it is kept.
      await this.repo.save({ companyName: current.companyName, currency: current.currency }, null);
      await removeUpload(current.logoPath);
    }
    return this.get();
  }
}
