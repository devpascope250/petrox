import { z } from "zod";
import { nonEmptyNameSchema, paginationQuerySchema, uuidSchema} from "../../shared/validation/index.js";

/**
 * A page of nozzles, newest first, narrowed by the site their pump stands at,
 * the pump itself, or a search on name and code. Every filter is optional.
 */
export const nozzleListQuerySchema = paginationQuerySchema.extend({
  siteId: z.string().trim().min(1).max(191).optional(),
  pumpId: z.string().trim().min(1).max(191).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export type NozzleListQuery = z.infer<typeof nozzleListQuerySchema>;

export const createNozzleSchema = z.object({
    name: nonEmptyNameSchema,
    pumpId: uuidSchema,
    displayId: uuidSchema,
    cuveId: uuidSchema,
    nozzleCode: nonEmptyNameSchema,
    status: z.enum(["active", "inactive"]).default("active"),
  });

/** The code scanned off a physical nozzle. */
const scannedCodeSchema = z.string().trim().min(1, "Scan the nozzle's code").max(100, "That code is too long");

export const bindNozzleCodeSchema = z.object({ nozzleCode: scannedCodeSchema }).strict();
export const nozzleCodeLookupSchema = z.object({ code: scannedCodeSchema });

export type CreateNozzleSchema = z.infer<typeof createNozzleSchema>;