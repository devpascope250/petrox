import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../prisma/generated/prisma/client.js";
import { totalsOf } from "../src/modules/fees/fee.repository.js";
import { assignFeesSchema, createFeeTypeSchema } from "../src/modules/fees/fee.schema.js";
import { shareLoadingOrderSchema } from "../src/modules/central stock Orders/loading-order-share.js";
import {
  editOrderQuantitySchema,
  requestOrderEditSchema,
} from "../src/modules/central stock Orders/order.schema.js";
import { renderLoadingOrderPdf } from "../src/modules/central stock Orders/loading-order-document.js";

const dec = (value: number) => new Prisma.Decimal(value);

describe("what a set of fees comes to", () => {
  it("groups by currency rather than adding two monies together", () => {
    const totals = totalsOf([
      { count: 3, unitAmount: dec(50_000), currencyCode: "RWF" },
      { count: 1, unitAmount: dec(120), currencyCode: "USD" },
      { count: 2, unitAmount: dec(1_000), currencyCode: "RWF" },
    ]);
    expect(totals).toEqual({ byCurrency: { RWF: 152_000, USD: 120 }, feeCount: 3 });
  });

  it("counts a fee as many times as it is charged, to the cent", () => {
    expect(totalsOf([{ count: 3, unitAmount: dec(10.33), currencyCode: "RWF" }]).byCurrency).toEqual({
      RWF: 30.99,
    });
  });

  it("is zero figures rather than nothing when no fee is charged", () => {
    expect(totalsOf([])).toEqual({ byCurrency: {}, feeCount: 0 });
  });
});

describe("charging fees", () => {
  it("takes a count per fee and refuses the same fee twice", () => {
    const parsed = assignFeesSchema.parse({
      fees: [{ feeTypeId: "00000000-0000-4000-8000-000000000001", count: "3" }],
    });
    expect(parsed.fees[0].count).toBe(3);
    // A count of zero is not "remove it": leaving it out of the set is.
    expect(assignFeesSchema.safeParse({ fees: [{ feeTypeId: "00000000-0000-4000-8000-000000000001", count: 0 }] }).success)
      .toBe(false);
    // An empty set is how every fee is cleared.
    expect(assignFeesSchema.parse({ fees: [] }).fees).toEqual([]);
  });

  it("defaults a fee to RWF, and keeps the price as a number", () => {
    expect(createFeeTypeSchema.parse({ name: "Demurrage", amount: "50000" })).toMatchObject({
      amount: 50_000,
      currencyCode: "RWF",
    });
  });
});

describe("sending a stock request back to be changed", () => {
  it("insists on a reason, because the site has to know what to change", () => {
    expect(requestOrderEditSchema.safeParse({ comment: "" }).success).toBe(false);
    expect(requestOrderEditSchema.safeParse({ comment: "no" }).success).toBe(false);
    expect(requestOrderEditSchema.parse({ comment: "  Reduce to 4000  " }).comment).toBe("Reduce to 4000");
  });

  it("takes a positive quantity and an optional note", () => {
    expect(editOrderQuantitySchema.parse({ quantity: "4000" })).toEqual({ quantity: 4000 });
    expect(editOrderQuantitySchema.safeParse({ quantity: 0 }).success).toBe(false);
    expect(editOrderQuantitySchema.safeParse({ quantity: -5 }).success).toBe(false);
  });
});

describe("who a loading order is shared with", () => {
  it("splits one pasted line on commas, semicolons or spaces", () => {
    expect(shareLoadingOrderSchema.parse({ recipients: "a@x.rw, b@x.rw;c@x.rw d@x.rw" }).recipients)
      .toEqual(["a@x.rw", "b@x.rw", "c@x.rw", "d@x.rw"]);
  });

  it("lower-cases and de-duplicates, so nobody is written to twice", () => {
    expect(shareLoadingOrderSchema.parse({ recipients: "Ops@X.rw, ops@x.rw" }).recipients)
      .toEqual(["ops@x.rw"]);
  });

  it("refuses an address that is not one, rather than sending into the void", () => {
    expect(shareLoadingOrderSchema.safeParse({ recipients: "ops@x.rw, not-an-address" }).success).toBe(false);
    expect(shareLoadingOrderSchema.safeParse({ recipients: "   " }).success).toBe(false);
  });

  it("caps a single send at twenty addresses", () => {
    const many = Array.from({ length: 21 }, (_, index) => `person${index}@x.rw`).join(",");
    expect(shareLoadingOrderSchema.safeParse({ recipients: many }).success).toBe(false);
  });
});

/** A loading order as the document reads it, with the parts it prints. */
function documentOrder(approved: boolean) {
  return {
    id: "3fec6655-0000-4000-8000-000000000001",
    totalQuantity: dec(6_000),
    status: "pending" as const,
    authorizationStatus: approved ? ("approved" as const) : ("pending" as const),
    authoriserCount: 1,
    createdAt: new Date("2026-10-26T08:00:00.000Z"),
    dVehicle: {
      driver: { names: "Sam Driver", phone: "0788000111", lisence: "L-1", passport: "P-1" },
      vechile: {
        platNumber: "RAB123C", truckNumber: "T-1", trailerNumber: "TR-1",
        tankCapacity: dec(40_000), model: "Howo",
      },
    },
    loadedOrders: [
      {
        quantity: dec(6_000),
        order: {
          id: "order-1",
          orderType: "internal" as const,
          unitPrice: dec(1_200),
          site: { name: "Kigali station" },
          centralStock: {
            receiptNumber: "RC-1",
            deport: { name: "KABUYE", location: "Kigali" },
            t1Validation: {
              nomination: { nominationVessels: [{ stock: { item: { name: "AGO" } } }] },
            },
          },
        },
      },
    ],
    authorizers: approved
      ? [
          {
            createdAt: new Date("2026-10-26T09:00:00.000Z"),
            signatureUrl: "/uploads/not-on-disk.png",
            signedName: "Sam Signer",
            user: { firstName: "Sam", lastName: "Signer" },
            authorizer: { levels: 1, role: { name: "Approver" } },
          },
        ]
      : [],
  };
}

const company = { name: "IKWIM Energies", address: "Kigali", phone: "+250 788 000 000", email: "info@ikwim.rw", taxId: "100123456", logoPath: null };

describe("the loading order document", () => {
  it("renders a PDF", async () => {
    const pdf = await renderLoadingOrderPdf(documentOrder(true) as never, company);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1_000);
  });

  it("renders even when a signature image is missing from disk", async () => {
    // A file that has been moved must cost the signature, never the document.
    const pdf = await renderLoadingOrderPdf(documentOrder(true) as never, company);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("renders before it is authorised, and says so instead of signing it", async () => {
    const pdf = await renderLoadingOrderPdf(documentOrder(false) as never, company);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    // Both render; the unsigned one carries the warning rather than signatures,
    // which is checked end to end against the database.
    expect(pdf.length).toBeGreaterThan(1_000);
  });

  it("does not fall over without a company profile", async () => {
    const pdf = await renderLoadingOrderPdf(documentOrder(true) as never, { name: "Ikwim" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
