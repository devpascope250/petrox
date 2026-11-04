import { z } from "zod";
import { uuidSchema } from "../../../shared/validation/index.js";

/**
 * Who may authorize a stock clearance.
 *
 * Named people, not roles — unlike the loading-order `Authorizers` — because
 * each of them is emailed the moment a clearance is raised, and an address
 * belongs to a person.
 */
export const clearanceAuthorizerMemberSchema = z.object({
  authorizerId: uuidSchema,
  /** Shown in the email and on the approval list; free text, e.g. "Finance manager". */
  position: z.string().trim().max(120).optional(),
  /** Ordering only. Every active authorizer must approve, whatever their level. */
  level: z.coerce.number().int().positive().optional(),
});

export type ClearanceAuthorizerMemberSchema = z.infer<typeof clearanceAuthorizerMemberSchema>;

export const clearanceDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(500).optional(),
}).refine((data) => data.decision === "approved" || Boolean(data.reason), {
  message: "A reason is required when rejecting a clearance",
  path: ["reason"],
});

export type ClearanceDecisionSchema = z.infer<typeof clearanceDecisionSchema>;
