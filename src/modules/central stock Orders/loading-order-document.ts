import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";

/** What the document prints about the company it is issued by. */
export interface DocumentCompany {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
  logoPath?: string | null;
}

const money = (value: Prisma.Decimal | number | string) =>
  Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const day = (value: Date | null | undefined) =>
  value
    ? value.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";

/** An uploaded file's place on disk, or null when it is not there to embed. */
function uploadPath(stored: string | null | undefined) {
  if (!stored) return null;
  const name = path.basename(stored);
  const full = path.join(process.cwd(), "uploads", name);
  return existsSync(full) ? full : null;
}

/** Everything the document prints, read in one go. */
export async function loadingOrderForDocument(db: PrismaClient, id: string) {
  const order = await db.loadingOrder.findUnique({
    where: { id },
    select: {
      id: true,
      totalQuantity: true,
      status: true,
      authorizationStatus: true,
      authoriserCount: true,
      createdAt: true,
      dVehicle: {
        select: {
          driver: { select: { names: true, phone: true, lisence: true, passport: true } },
          vechile: {
            select: { platNumber: true, truckNumber: true, trailerNumber: true, tankCapacity: true, model: true },
          },
        },
      },
      loadedOrders: {
        orderBy: { createdAt: "asc" },
        select: {
          quantity: true,
          order: {
            select: {
              id: true,
              orderType: true,
              unitPrice: true,
              site: { select: { name: true } },
              centralStock: {
                select: {
                  receiptNumber: true,
                  deport: { select: { name: true, location: true } },
                  t1Validation: {
                    select: {
                      nomination: {
                        select: {
                          nominationVessels: {
                            take: 1,
                            select: { stock: { select: { item: { select: { name: true } } } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      authorizers: {
        orderBy: { createdAt: "asc" },
        select: {
          createdAt: true,
          signatureUrl: true,
          signedName: true,
          user: { select: { firstName: true, lastName: true } },
          authorizer: { select: { levels: true, role: { select: { name: true } } } },
        },
      },
    },
  });
  if (!order) throw new NotFoundError("Loading order");
  return order;
}

export type LoadingOrderDocumentData = Awaited<ReturnType<typeof loadingOrderForDocument>>;

/**
 * Renders a loading order as a PDF.
 *
 * Signatures are printed from the copy taken when each authoriser approved, so
 * a document reprinted a year later is the document that was signed. They
 * appear only once every authoriser has approved: a half-signed order is a
 * working paper, not an instruction to load, and printing partial signatures
 * invites it to be treated as one.
 */
export function renderLoadingOrderPdf(
  order: LoadingOrderDocumentData,
  company: DocumentCompany,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 44 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const fullyApproved = order.authorizationStatus === "approved";
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  /* ---- who issued it ---------------------------------------------------- */
  const logo = uploadPath(company.logoPath);
  if (logo) {
    try {
      doc.image(logo, left, 40, { fit: [120, 46] });
    } catch {
      // An unreadable image must not cost the whole document.
    }
  }
  doc.font("Helvetica-Bold").fontSize(15).text(company.name, logo ? left + 136 : left, 44);
  doc.font("Helvetica").fontSize(8.5).fillColor("#555555");
  const contact = [company.address, company.phone, company.email, company.taxId && `TIN ${company.taxId}`]
    .filter(Boolean)
    .join("  ·  ");
  if (contact) doc.text(contact, logo ? left + 136 : left, 62, { width: width - (logo ? 136 : 0) });

  doc.moveTo(left, 96).lineTo(right, 96).strokeColor("#dddddd").stroke();

  /* ---- the order itself -------------------------------------------------- */
  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(13).text("LOADING ORDER", left, 110);
  doc.font("Helvetica").fontSize(9).fillColor("#555555");
  doc.text(`No. ${order.id.slice(0, 8).toUpperCase()}`, left, 128);
  doc.text(`Issued ${day(order.createdAt)}`, left, 141);
  doc.fontSize(9).fillColor(fullyApproved ? "#15803d" : "#b45309");
  doc.text(
    fullyApproved ? "Authorized" : `Awaiting authorization (${order.authorizers.length}/${order.authoriserCount})`,
    left,
    128,
    { width, align: "right" },
  );

  /* ---- driver and truck -------------------------------------------------- */
  let y = 164;
  const driver = order.dVehicle.driver;
  const vehicle = order.dVehicle.vechile;
  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(10).text("Driver & vehicle", left, y);
  y += 16;
  doc.font("Helvetica").fontSize(9).fillColor("#333333");
  const facts: Array<[string, string]> = [
    ["Driver", driver.names],
    ["Phone", driver.phone ?? "—"],
    ["Licence", driver.lisence ?? "—"],
    ["Plate", vehicle.platNumber],
    ["Truck / trailer", `${vehicle.truckNumber ?? "—"} / ${vehicle.trailerNumber ?? "—"}`],
    ["Tank capacity", `${money(vehicle.tankCapacity)} L`],
  ];
  for (const [index, [label, value]] of facts.entries()) {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = left + column * (width / 2);
    doc.fillColor("#777777").text(label, x, y + row * 15, { width: width / 2 - 8, continued: false });
    doc.fillColor("#111111").text(value, x + 86, y + row * 15, { width: width / 2 - 94 });
  }
  y += Math.ceil(facts.length / 2) * 15 + 14;

  /* ---- what to load ------------------------------------------------------ */
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000").text("Load", left, y);
  y += 16;
  const columns = [
    { label: "Product", width: width * 0.26 },
    { label: "Receipt", width: width * 0.18 },
    { label: "Depot", width: width * 0.22 },
    { label: "Destination", width: width * 0.18 },
    { label: "Quantity", width: width * 0.16, align: "right" as const },
  ];
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#555555");
  let x = left;
  for (const column of columns) {
    doc.text(column.label, x, y, { width: column.width, align: column.align ?? "left" });
    x += column.width;
  }
  y += 13;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#eeeeee").stroke();
  y += 6;

  doc.font("Helvetica").fontSize(9).fillColor("#111111");
  for (const load of order.loadedOrders) {
    const stock = load.order.centralStock;
    const product =
      stock.t1Validation?.nomination?.nominationVessels?.[0]?.stock?.item?.name ?? "—";
    const cells = [
      product,
      stock.receiptNumber ?? "—",
      [stock.deport?.name, stock.deport?.location].filter(Boolean).join(", ") || "—",
      load.order.site?.name ?? (load.order.orderType === "b2b" ? "B2B" : "—"),
      `${money(load.quantity)} L`,
    ];
    x = left;
    for (const [index, column] of columns.entries()) {
      doc.text(cells[index], x, y, { width: column.width, align: column.align ?? "left" });
      x += column.width;
    }
    y += 15;
    if (y > doc.page.height - 200) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  }

  doc.moveTo(left, y + 2).lineTo(right, y + 2).strokeColor("#dddddd").stroke();
  y += 10;
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text("Total", left, y, { width: width - columns[4].width });
  doc.text(`${money(order.totalQuantity)} L`, left, y, { width, align: "right" });
  y += 28;

  /* ---- signatures -------------------------------------------------------- */
  doc.font("Helvetica-Bold").fontSize(10).text("Authorized by", left, y);
  y += 6;
  if (!fullyApproved) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor("#b45309");
    doc.text(
      `Not yet authorized — ${order.authorizers.length} of ${order.authoriserCount} approvals given. ` +
        "Signatures appear once every authorizer has approved.",
      left,
      y + 10,
      { width },
    );
  } else {
    const boxWidth = Math.min(180, width / Math.max(order.authorizers.length, 1) - 10);
    let signatureX = left;
    for (const approval of order.authorizers) {
      const signature = uploadPath(approval.signatureUrl);
      if (signature) {
        try {
          doc.image(signature, signatureX, y + 10, { fit: [boxWidth - 10, 38] });
        } catch {
          // Printed without the image rather than not printed at all.
        }
      }
      doc.moveTo(signatureX, y + 54).lineTo(signatureX + boxWidth - 10, y + 54)
        .strokeColor("#bbbbbb").stroke();
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111111");
      doc.text(
        approval.signedName ?? `${approval.user.firstName} ${approval.user.lastName}`.trim(),
        signatureX,
        y + 58,
        { width: boxWidth - 10 },
      );
      doc.font("Helvetica").fontSize(8).fillColor("#666666");
      doc.text(approval.authorizer.role.name, signatureX, y + 70, { width: boxWidth - 10 });
      doc.text(day(approval.createdAt), signatureX, y + 81, { width: boxWidth - 10 });
      signatureX += boxWidth;
    }
  }

  doc.font("Helvetica").fontSize(7.5).fillColor("#999999");
  doc.text(
    `${company.name} · printed ${day(new Date())}`,
    left,
    doc.page.height - doc.page.margins.bottom - 10,
    { width, align: "center" },
  );

  doc.end();
  return done;
}

/** The file name the document is offered under. */
export const loadingOrderFileName = (order: { id: string }) =>
  `loading-order-${order.id.slice(0, 8).toUpperCase()}.pdf`;
