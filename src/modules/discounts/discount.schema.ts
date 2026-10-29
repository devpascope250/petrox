import { z } from "zod";
import { StatusType } from "../../../prisma/generated/prisma/enums.js";
import { uuidSchema } from "../../shared/validation/index.js";

const decimalSchema = (label: string, allowZero = false) => z.union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,10})(?:\.\d)?$/, `${label} must have at most 11 integer digits and 1 decimal place`))
  .refine((value) => allowZero || Number(value) > 0, `${label} must be greater than zero`);

/**
 * A discount rate is a **percentage of what the sale is worth**, so it cannot
 * exceed 100: at 100% the fuel is free, and above it the pump would be paying
 * the customer. One decimal place, matching the column.
 */
const percentSchema = (label: string, allowZero = false) => decimalSchema(label, allowZero)
  .refine((value) => Number(value) <= 100, `${label} is a percentage, so it cannot be more than 100`);

const rangeSchema = z.object({
  from: decimalSchema("Range start", true),
  to: decimalSchema("Range end"),
  /** The percentage off a sale whose quantity falls inside this volume band. */
  rate: percentSchema("Discount rate"),
  siteId: uuidSchema,
  status: z.enum(StatusType).default(StatusType.active)
}).strict().refine((range) => Number(range.from) < Number(range.to), {
  path: ["to"],
  message: "Range end must be greater than range start"
});

const commonSchema = {
  siteId: uuidSchema.optional(),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date(),
  status: z.enum(StatusType).default(StatusType.active)
};

const fixedDiscountSchema = z.object({
  type: z.literal("fixed"),
  /** The percentage off a sale for this client — the same rate at any volume. */
  value: percentSchema("Discount value"),
  clientId: uuidSchema,
  ...commonSchema
}).strict();

const rangingDiscountSchema = z.object({
  type: z.literal("ranging"),
  /** Always `0`: a ranging discount's tiers carry the percentages. */
  value: percentSchema("Discount value", true),
  rangingDiscounts: z.array(rangeSchema).min(1, "At least one ranging discount is required"),
  ...commonSchema
}).strict();

function validateDiscount(input: z.infer<typeof fixedDiscountSchema> | z.infer<typeof rangingDiscountSchema>, context: z.RefinementCtx) {
  if (input.validFrom >= input.validTo) {
    context.addIssue({ code: "custom", path: ["validTo"], message: "Valid to must be later than valid from" });
  }
  if (input.type !== "ranging") return;

  const bySite = new Map<string, Array<{ from: number; to: number; index: number }>>();
  input.rangingDiscounts.forEach((range, index) => {
    const ranges = bySite.get(range.siteId) ?? [];
    ranges.push({ from: Number(range.from), to: Number(range.to), index });
    bySite.set(range.siteId, ranges);
  });
  for (const ranges of bySite.values()) {
    ranges.sort((left, right) => left.from - right.from || left.to - right.to);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index]!.from < ranges[index - 1]!.to) {
        context.addIssue({
          code: "custom",
          path: ["rangingDiscounts", ranges[index]!.index, "from"],
          message: "Ranges for the same site must not overlap"
        });
      }
    }
  }
}

export const discountParamsSchema = z.object({ id: uuidSchema });
export const createDiscountSchema = z.discriminatedUnion("type", [fixedDiscountSchema, rangingDiscountSchema])
  .superRefine(validateDiscount);
export const updateDiscountSchema = createDiscountSchema;

export type CreateDiscountInput = z.infer<typeof createDiscountSchema>;
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>;
export type RangingDiscountInput = z.infer<typeof rangeSchema>;
