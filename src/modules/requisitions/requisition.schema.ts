import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/**
 * A new requisition. The site is **not** here: a station manager raises one for
 * their own station and the service fills it in, so a request cannot be made in
 * another site's name. A super administrator names the site instead.
 */
export const createRequisitionSchema = z.object({
  siteId: uuidSchema.optional(),
  reason: z.string().trim().max(1000).optional(),
  lines: z.array(z.object({
    itemId: uuidSchema,
    quantity: z.coerce.number().positive("Ask for more than nothing"),
  })).min(1, "A requisition needs at least one product")
    .max(20)
    // One line per product: two lines for the same product are one ask written
    // twice, and they would be accepted and loaded as if they were separate.
    .refine((lines) => new Set(lines.map((line) => line.itemId)).size === lines.length,
      "Each product may appear only once"),
});

/** The station's own correction, allowed only while it was handed back. */
export const editRequisitionSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
  comment: z.string().trim().max(1000).optional(),
  lines: z.array(z.object({
    /** The line being changed. A line cannot be added or dropped on an edit. */
    id: uuidSchema,
    quantity: z.coerce.number().positive(),
  })).min(1),
});

/**
 * Accepting. A quantity may be cut per line — head office often grants less
 * than was asked — and leaving a line out accepts it as asked.
 */
export const acceptRequisitionSchema = z.object({
  comment: z.string().trim().max(1000).optional(),
  lines: z.array(z.object({
    id: uuidSchema,
    approvedQuantity: z.coerce.number().positive(),
  })).max(20).optional(),
});

/** Refusing, or handing back for a change: both have to say why. */
export const requisitionReasonSchema = z.object({
  comment: z.string().trim().min(1, "Say why — the station reads this").max(1000),
});

export const requisitionListQuerySchema = paginationQuerySchema.extend({
  /** Matched against the number, the reason, the station and the products. */
  search: z.string().trim().max(80).optional(),
  step: z.enum([
    "submitted", "accepted", "loading", "delivered", "changeRequested", "rejected", "cancelled",
  ]).optional(),
  siteId: uuidSchema.optional(),
  itemId: uuidSchema.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export type CreateRequisitionSchema = z.infer<typeof createRequisitionSchema>;
export type EditRequisitionSchema = z.infer<typeof editRequisitionSchema>;
export type AcceptRequisitionSchema = z.infer<typeof acceptRequisitionSchema>;
export type RequisitionReasonSchema = z.infer<typeof requisitionReasonSchema>;
export type RequisitionListQuery = z.infer<typeof requisitionListQuerySchema>;
