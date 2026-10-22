import { describe, expect, it } from "vitest";
import { documentUrl } from "../src/utils/static-url.js";

const config = { STATIC_URL: "https://petrox.quicko.rw", APP_URL: "http://localhost:7000" };

describe("a stored document's address", () => {
  it("puts the public host in front of the stored path", () => {
    expect(documentUrl(config, "/uploads/invoice.pdf")).toBe(
      "https://petrox.quicko.rw/uploads/invoice.pdf",
    );
  });

  it("leaves no document as no document", () => {
    // It used to read `APP_URL + null`, which rendered as a link that 404s.
    expect(documentUrl(config, null)).toBeNull();
    expect(documentUrl(config, undefined)).toBeNull();
  });

  it("falls back to the app's own address when no public one is set", () => {
    expect(documentUrl({ APP_URL: "http://localhost:7000" }, "/uploads/a.pdf")).toBe(
      "http://localhost:7000/uploads/a.pdf",
    );
  });

  it("does not double a slash, whatever the base ends with", () => {
    expect(documentUrl({ STATIC_URL: "https://x.rw/", APP_URL: "http://y" }, "/uploads/a.pdf")).toBe(
      "https://x.rw/uploads/a.pdf",
    );
  });

  it("leaves a path that is already a full URL alone", () => {
    expect(documentUrl(config, "https://files.example.rw/a.pdf")).toBe(
      "https://files.example.rw/a.pdf",
    );
  });
});
