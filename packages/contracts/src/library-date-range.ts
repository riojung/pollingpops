import { z } from "zod";

export const LibraryFilterDateSchema = z.iso
  .date()
  .refine((date) => !date.startsWith("0000-"), "Date must have a year between 0001 and 9999");

const LibraryFilterTimestampSchema = z.iso
  .datetime()
  .refine((time) => !time.startsWith("0000-"), "Date must have a year between 0001 and 9999")
  .refine((time) => !/\.\d{4,}Z$/.test(time), "Timestamp must use millisecond precision")
  .transform((time) => new Date(time).toISOString());

export const LibraryDateRangeQuerySchema = z
  .strictObject({
    from: LibraryFilterTimestampSchema.optional(),
    to: LibraryFilterTimestampSchema.optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    path: ["to"],
    message: "End date must be on or after the start date",
  });
