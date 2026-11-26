import { z } from "zod";

const HistoryCursorSchema = z
  .string()
  .min(1)
  .max(1_000)
  .transform((value, context) => {
    try {
      const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
      return z
        .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
        .strict()
        .parse(decoded);
    } catch {
      context.addIssue({ code: "custom", message: "Cursor is malformed" });
      return z.NEVER;
    }
  });

export const HistoryPaginationQuery = {
  cursor: HistoryCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
};

export const HistoryDateRangeQuery = {
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
};

export function historyCursor(item: { createdAt: Date; cursorCreatedAt?: string; id: string }) {
  return Buffer.from(
    JSON.stringify({
      createdAt: item.cursorCreatedAt ?? item.createdAt.toISOString(),
      id: item.id,
    }),
    "utf8",
  ).toString("base64url");
}
