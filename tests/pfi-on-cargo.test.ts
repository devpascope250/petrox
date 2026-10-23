import { describe, expect, it, vi } from "vitest";
import { createCargoSchema } from "../src/modules/cargo/cargo.schema.js";
import { CargoRepository } from "../src/modules/cargo/cargo.repository.js";
import { createPfiSchema } from "../src/modules/pfi/pfi.schema.js";
import { PfiRepository } from "../src/modules/pfi/pfi.repository.js";

const CARGO = "cl9ebqhxk00003b600tymydho";
const CURRENCY = "00000000-0000-4000-8000-000000000001";

const cargoFields = {
  deportId: "dep-1", orderId: "ord-1", vesselName: "Vessel N-T",
  receivedDate: "2026-10-01", expirationDate: "2026-12-01",
  quantityInKg: "23", quantityInLitre: "500", blRef: "BL-1",
};
const pfiFields = {
  currencyId: CURRENCY, currancyCode: "RWF",
  pfiReference: "PFI-0001", unitPrice: "595", amount: "297500",
};

describe("a PFI is raised against a cargo", () => {
  it("takes a cargo id, not a nomination", () => {
    const parsed = createPfiSchema.parse({ ...pfiFields, cargoId: CARGO });
    expect(parsed).toMatchObject({ cargoId: CARGO, amount: 297500, unitPrice: 595 });
    // The old shape is refused rather than quietly ignored.
    expect(createPfiSchema.safeParse({ ...pfiFields, nominationId: CARGO }).success).toBe(false);
    expect(createPfiSchema.safeParse({ ...pfiFields, cargoId: "not-a-cuid" }).success).toBe(false);
  });

  it("refuses a cargo that does not exist, rather than orphaning the PFI", async () => {
    const db = { cargo: { findUnique: vi.fn().mockResolvedValue(null) }, pfi: { create: vi.fn() } };
    await expect(new PfiRepository(db as never).create({ ...pfiFields, cargoId: CARGO, amount: 1, unitPrice: 1 } as never))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(db.pfi.create).not.toHaveBeenCalled();
  });

  it("gives every PFI its own generated code", async () => {
    const db = {
      cargo: { findUnique: vi.fn().mockResolvedValue({ id: CARGO }) },
      pfi: { create: vi.fn((args: any) => args.data) },
    };
    const repo = new PfiRepository(db as never);
    const input = { ...pfiFields, cargoId: CARGO, amount: 1, unitPrice: 1 } as never;
    const first: any = await repo.create(input);
    const second: any = await repo.create(input);
    // A shipment may be invoiced more than once; the codes still differ.
    expect(first.pifCode).not.toBe(second.pifCode);
    expect(first.cargoId).toBe(CARGO);
  });
});

describe("recording a cargo with its PFI", () => {
  /** An order with room for the cargo, and a create that reports what it was given. */
  function cargoDb() {
    const create = vi.fn((args: any) => ({ id: CARGO, ...args.data }));
    return {
      db: {
        order: { findUnique: vi.fn().mockResolvedValue({ id: "ord-1", quantity: 1000, cargos: [] }) },
        cargo: { create },
      },
      create,
    };
  }

  it("reads the PFI from a JSON form field and writes both in one go", async () => {
    const input = createCargoSchema.parse({ ...cargoFields, pfi: JSON.stringify(pfiFields) });
    expect(input.pfi).toMatchObject({ pfiReference: "PFI-0001", amount: 297500 });

    const { db, create } = cargoDb();
    await new CargoRepository(db as never).create(input);
    const data = create.mock.calls[0][0].data;
    expect(data.pfis.create).toMatchObject({
      pfiReference: "PFI-0001", currancyCode: "RWF", amount: 297500, unitPrice: 595,
    });
    expect(data.pfis.create.pifCode).toMatch(/^PFI/);
  });

  it("records the cargo alone when no PFI came with it", async () => {
    const input = createCargoSchema.parse(cargoFields);
    expect(input.pfi).toBeUndefined();

    const { db, create } = cargoDb();
    await new CargoRepository(db as never).create(input);
    expect(create.mock.calls[0][0].data.pfis).toBeUndefined();
  });

  it("refuses a half-filled PFI instead of recording a cargo with a broken one", () => {
    const half = { ...pfiFields, amount: undefined };
    expect(createCargoSchema.safeParse({ ...cargoFields, pfi: JSON.stringify(half) }).success).toBe(false);
    expect(createCargoSchema.safeParse({ ...cargoFields, pfi: "not json" }).success).toBe(false);
    // An empty field is "no PFI", which is how a form sends an untouched block.
    expect(createCargoSchema.parse({ ...cargoFields, pfi: "" }).pfi).toBeUndefined();
  });
});

describe("the two documents on a new cargo", () => {
  it("keeps the shipment's paperwork and the proforma apart", () => {
    // The PFI block is JSON and carries no file; the file travels as its own
    // part, which is what stops one document overwriting the other.
    const input = createCargoSchema.parse({
      ...cargoFields,
      pfi: JSON.stringify(pfiFields),
      supportingDocUrl: "/uploads/bill-of-lading.pdf",
    });
    expect(input.supportingDocUrl).toBe("/uploads/bill-of-lading.pdf");
    expect(input.pfi?.supportingDocUrl).toBeUndefined();

    // The route fills the PFI's own slot after parsing, from its own field.
    const withPfiDoc = createCargoSchema.parse({
      ...cargoFields,
      pfi: JSON.stringify({ ...pfiFields, supportingDocUrl: "/uploads/proforma.pdf" }),
      supportingDocUrl: "/uploads/bill-of-lading.pdf",
    });
    expect(withPfiDoc.pfi?.supportingDocUrl).toBe("/uploads/proforma.pdf");
    expect(withPfiDoc.supportingDocUrl).not.toBe(withPfiDoc.pfi?.supportingDocUrl);
  });

  it("writes the proforma's document onto the PFI, not onto the cargo", async () => {
    const create = vi.fn((args: any) => ({ id: CARGO, ...args.data }));
    const db = {
      order: { findUnique: vi.fn().mockResolvedValue({ id: "ord-1", quantity: 1000, cargos: [] }) },
      cargo: { create },
    };
    const input = createCargoSchema.parse({
      ...cargoFields,
      supportingDocUrl: "/uploads/bill-of-lading.pdf",
      pfi: JSON.stringify({ ...pfiFields, supportingDocUrl: "/uploads/proforma.pdf" }),
    });
    await new CargoRepository(db as never).create(input);

    const data = create.mock.calls[0][0].data;
    expect(data.supportingDocUrl).toBe("/uploads/bill-of-lading.pdf");
    expect(data.pfis.create.supportingDocUrl).toBe("/uploads/proforma.pdf");
  });
});
