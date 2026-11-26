import type { Prisma, StockTransaction } from "../../../prisma/generated/prisma/client.js";

/**
 * What is actually left on a receipt, worked out from its movements.
 *
 * The movements are the truth about the fuel: `quantityAt20C` is the figure
 * the receipt was written with and only reconciliation moves it, so a batch
 * sold down to nothing still shows its full landed quantity there. This is the
 * same number the reconciliation guard reports as "The Remaining Stock is …".
 */
export function calculatingRemainStock(
  transactions: Array<{
    quantity: number | { toString(): string };
    type: StockTransaction["type"];
  }>,
) {
  return transactions.reduce((stock, transaction) => {
    switch (transaction.type) {
      case "received":
      case "reconcilliationIn":
        return stock + Number(transaction.quantity);
      case "saleOut":
      case "reconcilliationOut":
        return stock - Number(transaction.quantity);
      default:
        return stock;
    }
  }, 0);
}

/**
 * Set a receipt's `status` to match what is left on it: `stockOut` once its
 * movements net to nothing, `inStock` while any remains.
 *
 * **Derived, never typed.** `status` used to be a column nothing ever wrote —
 * accepted on input, indexed, filtered on, and left at `inStock` for the life
 * of every receipt, so an emptied batch went on offering itself to the stock
 * pickers forever. A flag that can disagree with the movements it describes is
 * worse than no flag, so it is recomputed from them on every write that moves
 * fuel rather than set by whoever happened to empty it.
 *
 * It swings **both ways** on purpose: a `reconcilliationIn` that corrects a
 * mistake, or a draw that is rejected and gives its litres back, puts the
 * receipt back `inStock`. A receipt holding fuel must never be marked empty.
 *
 * Called **after** the movement has been written, inside the same transaction,
 * so it reads the balance the caller has just created.
 *
 * Negative is treated as empty rather than left `inStock`: more has gone out
 * than ever came in, which is a data error the reports already flag in red —
 * but there is certainly nothing there to sell.
 */
export async function settleStockStatus(
  tx: Prisma.TransactionClient,
  centralStockId: string,
) {
  const transactions = await tx.stockTransaction.findMany({
    where: { centralStockId },
    select: { quantity: true, type: true },
  });
  const status = calculatingRemainStock(transactions) <= 0 ? "stockOut" : "inStock";
  await tx.centralStock.update({ where: { id: centralStockId }, data: { status } });
  return status;
}
