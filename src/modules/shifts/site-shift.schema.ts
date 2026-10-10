import { z } from "zod";
import { uuidSchema } from "../../shared/validation/index.js";

/**
 * A shift running at one site. The hours are not set here: they belong to the
 * shift itself and are the same at every site.
 */
export const createSiteShiftSchema = z.object({
  shiftId: uuidSchema,
  siteId: uuidSchema,
});

export const siteShiftQuerySchema = z.object({
  siteId: uuidSchema.optional(),
});

export type CreateSiteShiftSchema = z.infer<typeof createSiteShiftSchema>;
export type SiteShiftQuerySchema = z.infer<typeof siteShiftQuerySchema>;
