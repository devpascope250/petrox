import { describe, expect, it, vi } from "vitest";
import { parseInput } from "../src/shared/validation/index.js";
import { companySettingsSchema } from "../src/modules/company-settings/company-settings.schema.js";
import { CompanySettingsRepository } from "../src/modules/company-settings/company-settings.repository.js";
import { MobileTransactionsService } from "../src/modules/mobile/transactions/transactions.service.js";

const parse = (body: unknown) => parseInput(companySettingsSchema, body);

describe("company settings input", () => {
  it("keeps fields left out, and clears fields sent blank", () => {
    const parsed = parse({ companyName: "IKWIM", currency: "rwf", website: "", address: "  " });
    expect(parsed).toMatchObject({ companyName: "IKWIM", currency: "RWF", website: null, address: null });
    expect(parsed.phone).toBeUndefined();
    expect(parsed.email).toBeUndefined();
  });

  it("reads multipart text, where removeLogo arrives as a string", () => {
    expect(parse({ companyName: "IKWIM", currency: "RWF", removeLogo: "true" }).removeLogo).toBe(true);
  });

  it("refuses a missing name, a bad email and a currency that is not a 3-letter code", () => {
    expect(() => parse({ companyName: "", currency: "RW", email: "nope" })).toThrow();
  });
});

describe("company on receipts", () => {
  it("is null until the profile is saved, then carries the logo as a full URL", async () => {
    const db = { companySettings: { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
      companyName: "IKWIM Energies Ltd", address: "KN 5 Rd", phone: null, email: null, taxId: "102345678",
      website: null, currency: "RWF", logoPath: "/uploads/logo.png", receiptFooter: "Thank you",
    }) } };
    const repo = new CompanySettingsRepository(db as never);
    expect(await repo.receipt("https://api.example.com")).toBeNull();
    expect(await repo.receipt("https://api.example.com")).toMatchObject({
      name: "IKWIM Energies Ltd", taxId: "102345678", logoUrl: "https://api.example.com/uploads/logo.png", receiptFooter: "Thank you",
    });
  });

  it("is added to a single sale read by the POS", async () => {
    const repo = { find: vi.fn().mockResolvedValue({ transactionCode: "PSST1", amount: 100 }) };
    const service = new MobileTransactionsService(repo as never, async () => ({ name: "IKWIM" }));
    const sale = await service.find({ device: { siteId: "site" } } as never, "PSST1");
    expect(sale).toMatchObject({ transactionCode: "PSST1", company: { name: "IKWIM" } });
  });
});
