import { Prisma } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";

export interface LoadLineInput {
  requisitionLineId: string;
  quantity: number;
}

/**
 * Commits a requisition line's litres to cleared stock, as a load is built.
 *
 * **This is where the stock is committed.** A requisition is an ask and
 * accepting it is permission, so nothing is drawn until a truck is being
 * loaded. Here, for each line:
 *
 * 1. the cleared clearances of that product are walked oldest first, and a
 *    **draw** (`CentralStockOrder`) is created against each one it takes from —
 *    one line can span two batches, which is why this returns a list;
 * 2. the `saleOut` movement is written **with its `drawId`**, so it can later
 *    be corrected or reversed without touching another draw's;
 * 3. the line's `loadedQuantity` follows.
 *
 * A clearance's remaining room is its own quantity less what other draws have
 * already taken — the same sum the clearance screen and the stock reports use —
 * and a batch's physical balance caps it, because litres already gone cannot
 * be loaded however the paperwork reads.
 */
export async function drawForRequisitionLines(
  tx: Prisma.TransactionClient,
  lines: LoadLineInput[],
  actedBy: string,
) {
  const draws: Array<{ id: string; requisitionLineId: string; quantity: number }> = [];

  for (const input of lines) {
    const line = await tx.requisitionLine.findUnique({
      where: { id: input.requisitionLineId },
      select: {
        id: true, itemId: true, quantity: true, approvedQuantity: true, loadedQuantity: true,
        item: { select: { name: true } },
        requisition: { select: { id: true, requisitionNo: true, siteId: true, step: true } },
      },
    });
    if (!line) throw new NotFoundError("Requisition line");
    if (line.requisition.step !== "accepted" && line.requisition.step !== "loading") {
      throw new BusinessError("REQUISITION_NOT_ACCEPTED",
        `${line.requisition.requisitionNo} is ${line.requisition.step}; only an accepted requisition can be loaded`);
    }
    const granted = Number(line.approvedQuantity ?? line.quantity);
    const alreadyLoaded = Number(line.loadedQuantity);
    if (alreadyLoaded + input.quantity > granted) {
      throw new BusinessError("REQUISITION_OVER_LOAD",
        `${line.item.name} on ${line.requisition.requisitionNo}: ${granted - alreadyLoaded} of the ` +
        `${granted} granted is still to load, but ${input.quantity} was asked for`);
    }

    const stocks = await tx.centralStock.findMany({
      where: { itemId: line.itemId, status: "inStock" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        transactions: { select: { quantity: true, type: true } },
        stockClearances: {
          where: { status: "cleared" },
          orderBy: { createdAt: "asc" },
          select: { id: true, quantity: true, centralStockOrders: { select: { quantity: true } } },
        },
      },
    });

    let outstanding = input.quantity;
    for (const stock of stocks) {
      if (outstanding <= 0) break;
      let physical = stock.transactions.reduce((balance, movement) => {
        const quantity = Number(movement.quantity);
        return movement.type === "received" || movement.type === "reconcilliationIn"
          ? balance + quantity : balance - quantity;
      }, 0);
      for (const clearance of stock.stockClearances) {
        if (outstanding <= 0) break;
        const taken = clearance.centralStockOrders.reduce(
          (sum, draw) => sum + Number(draw.quantity), 0);
        const room = Math.min(
          Math.max(0, Number(clearance.quantity) - taken),
          Math.max(0, physical),
          outstanding,
        );
        if (room <= 0) continue;

        const draw = await tx.centralStockOrder.create({
          data: {
            clearanceId: clearance.id,
            centralStockId: stock.id,
            requisitionLineId: line.id,
            siteId: line.requisition.siteId,
            orderType: "internal",
            quantity: room,
            // An internal transfer is not a sale: the station is not charged,
            // so there is no price to put on it.
            unitPrice: 0,
            totalPrice: 0,
            createdBy: actedBy,
            // Drawn because the requisition was already accepted; the decision
            // was made there, and this row is the act of serving it.
            status: "approved",
            approvedBy: actedBy,
            approvedAt: new Date(),
          },
          select: { id: true },
        });
        await tx.stockTransaction.create({
          data: {
            centralStockId: stock.id, quantity: room, type: "saleOut",
            drawId: draw.id, createdBy: actedBy,
            note: `${line.requisition.requisitionNo} · ${line.item.name}`,
          },
        });
        await tx.centralStockOrderEvent.create({
          data: { orderId: draw.id, action: "requested", toQuantity: room, actedBy },
        });
        draws.push({ id: draw.id, requisitionLineId: line.id, quantity: room });
        outstanding -= room;
        physical -= room;
      }
    }

    if (outstanding > 0) {
      // Refused rather than part-served: a load built for less than it was
      // told to carry is a truck sent out wrong, and the transaction rolls
      // back so no half-draw is left behind.
      throw new BusinessError("CLEARED_STOCK_SHORT",
        `${line.item.name}: ${input.quantity - outstanding} of the ${input.quantity} requested ` +
        `could be drawn from cleared stock. Clear more stock first.`);
    }

    await tx.requisitionLine.update({
      where: { id: line.id },
      data: { loadedQuantity: { increment: input.quantity } },
    });
    if (line.requisition.step === "accepted") {
      await tx.requisition.update({ where: { id: line.requisition.id }, data: { step: "loading" } });
      await tx.requisitionTimeline.create({
        data: {
          requisitionId: line.requisition.id, step: "loading", changedBy: actedBy,
          comment: "On a loading order", toQuantity: input.quantity,
        },
      });
    }
  }

  return draws;
}
