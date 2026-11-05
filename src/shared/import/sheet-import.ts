import { z } from "zod";
import { AppError } from "../../utils/errors.js";

/**
 * Bulk create from a filled-in template.
 *
 * The spreadsheet itself is read in the browser — it is where the template was
 * built, and where the person can be told at once that they chose the wrong
 * file — so what arrives here is plain rows: the cell values by column name,
 * each carrying the `row` number it sat on in Excel. That number is what the
 * person is shown for a row that could not be created, so it must survive the
 * trip rather than be counted again here (blank rows in the middle would
 * shift it).
 *
 * Every row is still validated and resolved on this side: the sheet is a
 * convenience, not a trusted source, and names of other records (a supplier
 * type, a transporter) are looked up here.
 */
export const sheetRowSchema = z.looseObject({
  row: z.coerce.number().int().min(2).max(1_000_000),
});

export const sheetImportSchema = z.object({
  /** One batch, bounded the same way the template is. */
  rows: z.array(sheetRowSchema).min(1, "The sheet has no rows to import").max(2000),
});

export type SheetRow = z.infer<typeof sheetRowSchema>;
export type SheetImportInput = z.infer<typeof sheetImportSchema>;

export interface SheetImportResult {
  /** How many records were created. */
  created: number;
  /** Rows that were not, each with the reason, so the file can be corrected. */
  errors: { row: number; message: string }[];
}

/** A cell as text: trimmed, with blank read as nothing rather than "". */
export const text = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  // ExcelJS hands back `{ text, hyperlink }` for a linked cell and `{ result }`
  // for a formula; the browser side flattens those, and anything still an
  // object here is not a value a person typed.
  const raw = typeof value === "object" ? String((value as { text?: unknown }).text ?? "") : String(value);
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
};

/** A cell as a number, or `undefined` when blank; `NaN` when it is not one. */
export const num = (value: unknown): number | undefined => {
  const asText = text(value);
  return asText === undefined ? undefined : Number(asText.replace(/,/g, ""));
};

/** Why one row failed, in the words the person who filled the sheet needs. */
const reason = (error: unknown): string => {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join("; ");
  }
  // A 5xx is ours, not theirs, and its message is not for them.
  if (error instanceof AppError && error.statusCode < 500) return error.message;
  return "This row could not be imported";
};

/**
 * Creates each row in turn, keeping the rows that fail aside instead of
 * stopping: a sheet of fifty is usually right about forty-eight times, and
 * re-uploading the corrected file must not duplicate what already went in.
 *
 * One at a time on purpose — a row may need a lookup, and a single failing row
 * must not roll the others back.
 */
export async function importRows(
  rows: SheetRow[],
  create: (row: SheetRow) => Promise<unknown>,
): Promise<SheetImportResult> {
  const errors: SheetImportResult["errors"] = [];
  let created = 0;
  for (const row of rows) {
    try {
      await create(row);
      created += 1;
    } catch (error) {
      errors.push({ row: row.row, message: reason(error) });
    }
  }
  return { created, errors };
}
