import { afterEach, describe, expect, it, vi } from "vitest";
import ejs from "ejs";
import path from "node:path";
import { useCompanyBrand, type CompanyBrand } from "../src/shared/emails/company-brand.js";

const company: CompanyBrand = {
  name: "IKWIM Energies Ltd",
  logoUrl: "https://petrox.example.rw/uploads/logo-1.png",
  address: "KN 4 Ave, Kigali",
  phone: "+250 788 000 000",
  email: "info@ikwim.rw",
  website: "https://ikwim.rw",
  taxId: "100123456",
};

const templates = ["new-account", "password-reset", "password-reset-success", "welcome-new-customer", "backup-report"];

/** Renders a template the way the email service does, with everything it is given. */
const render = (name: string) =>
  ejs.renderFile(path.join(process.cwd(), "src/shared/emails/templates", `${name}.ejs`), {
    company,
    currentYear: 2026,
    companyName: company.name,
    companyAddress: company.address,
    privacyPolicyLink: "https://ikwim.rw/privacy",
    termsLink: "https://ikwim.rw/terms",
    supportLink: "https://ikwim.rw/support",
    unsubscribeLink: "https://ikwim.rw/unsubscribe",
    // The fields each individual template needs.
    userName: "Pascal",
    loginEmail: "pascal@example.rw",
    password: "Str0ngPass!",
    pin: "4821",
    accountType: "Site manager",
    loginLink: "https://app.ikwim.rw/login",
    resetLink: "https://app.ikwim.rw/reset",
    expiryHours: "1",
    ipAddress: "41.0.0.1",
    requestDate: "21/10/2026",
    resetDate: "21/10/2026",
    location: "Kigali",
    browserInfo: "Chrome",
    userEmail: "pascal@example.rw",
    dashboardLink: "https://app.ikwim.rw/dashboard",
    registrationDate: "21/10/2026",
    socialLinks: { twitter: "https://x.com/i", facebook: "https://fb.com/i", linkedin: "https://lnkd.in/i" },
    ok: true,
    fileName: "backup.enc",
    size: "12.00 MB",
    expiresAt: "04/11/2026",
    error: "",
    backupsLink: "https://app.ikwim.rw/backups",
  });

afterEach(() => {
  useCompanyBrand(null);
  vi.restoreAllMocks();
});

describe("every email", () => {
  it.each(templates)("shows the company's logo picture and details in %s", async (name) => {
    const html = await render(name);
    expect(html).toContain(company.logoUrl);
    expect(html).toContain("IKWIM Energies Ltd");
    expect(html).toContain("KN 4 Ave, Kigali");
    expect(html).toContain("+250 788 000 000");
    expect(html).toContain("TIN: 100123456");
    // Who built the system, on every email that leaves it.
    expect(html).toContain("Powered by");
    expect(html).toContain('href="https://itec.rw/"');
  });

  it("leaves out the picture, and each missing detail, when the profile has none", async () => {
    const bare = { ...company, logoUrl: null, phone: null, website: null, taxId: null };
    const html = String(
      await ejs.renderFile(path.join(process.cwd(), "src/shared/emails/templates/new-account.ejs"), {
        company: bare, currentYear: 2026, companyName: bare.name, companyAddress: bare.address,
        userName: "Pascal", loginEmail: "p@x.rw", password: "p", pin: null,
        accountType: "Staff", loginLink: "https://app.ikwim.rw/login",
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("TIN:");
    expect(html).toContain("IKWIM Energies Ltd");
  });
});

describe("the new account email", () => {
  it("carries the address, the password and the PIN, and says to change it", async () => {
    const html = String(await render("new-account"));
    expect(html).toContain("pascal@example.rw");
    expect(html).toContain("Str0ngPass!");
    expect(html).toContain("4821");
    expect(html).toContain("Site manager");
    expect(html).toContain("https://app.ikwim.rw/login");
    expect(html).toContain("Change this password as soon as you sign in");
  });

  it("leaves the PIN out when none was generated", async () => {
    const html = String(
      await ejs.renderFile(path.join(process.cwd(), "src/shared/emails/templates/new-account.ejs"), {
        company, currentYear: 2026, companyName: company.name, companyAddress: company.address,
        userName: "Pascal", loginEmail: "p@x.rw", password: "Str0ngPass!", pin: null,
        accountType: "Client user", loginLink: "https://app.ikwim.rw/login",
      }),
    );
    expect(html).not.toContain("PIN (for the pump terminal)");
    expect(html).toContain("Str0ngPass!");
  });
});

describe("the company profile behind the emails", () => {
  it("is read from the registered source, and a failure to read it is not fatal", async () => {
    const { companyBrand } = await import("../src/shared/emails/company-brand.js");
    expect(await companyBrand()).toBeNull();

    useCompanyBrand(async () => company);
    expect(await companyBrand()).toEqual(company);

    vi.spyOn(console, "error").mockImplementation(() => {});
    useCompanyBrand(async () => { throw new Error("database is down"); });
    expect(await companyBrand()).toBeNull();
  });
});

/** The whole path, from creating a user down to what the mailer is handed. */
describe("creating a user", () => {
  it("emails the new account its address, password and generated PIN", async () => {
    const sent: { to: string; subject: string; html: string }[] = [];
    vi.doMock("../src/utils/mailer.js", () => ({
      sendMail: async (message: { to: string; subject: string; html: string }) => {
        sent.push(message);
        return true;
      },
    }));
    vi.resetModules();
    const { UsersService } = await import("../src/modules/users/users.service.js");
    // Reset modules, so the brand has to be registered on the fresh instance
    // the service now reads — the same one `app.ts` registers at startup.
    const brand = await import("../src/shared/emails/company-brand.js");
    brand.useCompanyBrand(async () => company);

    const created = {
      id: "user-1", email: "newbie@example.rw", firstName: "Newbie", lastName: "N",
      position: "siteManager", clientId: null,
    };
    const repo = { create: vi.fn().mockResolvedValue(created) };
    const config = { PIN_HMAC_SECRET: "x".repeat(32) } as never;
    const service = new UsersService(repo as never, config);

    const result = await service.create(
      {
        position: "siteManager", email: "newbie@example.rw", password: "Str0ngPass!",
        firstName: "Newbie", lastName: "N", siteId: "site-1",
      } as never,
      { position: "superAdmin", userId: "admin", clientId: null } as never,
    );

    // A PIN was not given, so one was generated and returned once.
    expect(result.temporaryPin).toMatch(/^\d{4,8}$/);
    // The email is sent without the creation waiting for it.
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].subject).toBe("Your IKWIM Energies Ltd account");
    expect(sent[0].html).toContain("newbie@example.rw");
    expect(sent[0].html).toContain("Str0ngPass!");
    expect(sent[0].html).toContain(result.temporaryPin!);
    expect(sent[0].html).toContain("Site manager");
    // And the company's picture and details, as in every email.
    expect(sent[0].html).toContain(company.logoUrl);
    expect(sent[0].html).toContain("info@ikwim.rw");
    vi.doUnmock("../src/utils/mailer.js");
  });
});
