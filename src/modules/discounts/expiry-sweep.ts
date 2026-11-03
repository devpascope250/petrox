import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";

/**
 * Rwanda keeps UTC+2 all year, as everything else that counts a business day
 * here does.
 */
const BUSINESS_OFFSET_MS = 2 * 60 * 60_000;

/** How often the sweep looks. A rate that ran out at midnight is retired by ten past. */
const EVERY_MS = 10 * 60_000;

/** Today in Rwanda, at midnight UTC — how a DATE column holds a day. */
function today(now = new Date()) {
  return new Date(`${new Date(now.getTime() + BUSINESS_OFFSET_MS).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * Retires the discounts and subsidies whose last day has passed.
 *
 * A rate that has run out already applies to nothing — `discountsInForce` and
 * `subsidyInForce` both check the dates as well as the status, so an expired
 * one was never given to a sale. What it did do was go on **reading as
 * active** on the screens, which is a different claim from the one the dates
 * make, and the one people act on.
 *
 * So the status is brought into line with the dates: active, and its last day
 * behind us, becomes inactive. Nothing is deleted and the dates are left
 * alone, so a retired rate can still be told from one somebody switched off —
 * an inactive rate whose `validTo` has passed expired on its own.
 *
 * A rate that has not started yet is left active on purpose: it is waiting,
 * not finished, and the dates already keep it out of every sale.
 */
export async function retireExpired(db: PrismaClient, now = new Date()) {
  const day = today(now);
  const [discounts, subsidies] = await Promise.all([
    // `validTo` is a moment, so the comparison is against the start of today:
    // a discount valid to yesterday 23:59 is out, one valid to today is not.
    db.discount.updateMany({ where: { status: "active", validTo: { lt: day } }, data: { status: "inactive" } }),
    db.subsidy.updateMany({ where: { status: "active", to: { lt: day } }, data: { status: "inactive" } }),
  ]);
  return { discounts: discounts.count, subsidies: subsidies.count };
}

/**
 * Starts the sweep: once at boot, so a server that was down over the turn of a
 * month catches up, then every ten minutes.
 */
export function startExpirySweep(app: FastifyInstance) {
  const run = () =>
    retireExpired(app.prisma)
      .then(({ discounts, subsidies }) => {
        if (discounts + subsidies > 0) {
          app.log.info({ discounts, subsidies }, "Retired rates whose last day has passed");
        }
      })
      .catch((error) => app.log.error({ err: error }, "Could not retire expired rates"));

  // In a promise, so even a synchronous failure is logged and never stops the
  // API from booting.
  Promise.resolve().then(run).catch(() => undefined);
  const timer = setInterval(run, EVERY_MS);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
}
