import { z } from "zod";

const publicSegments = new Set([
  "home",
  "library",
  "dashboard",
  "surveys",
  "rooms",
  "new",
  "create",
  "round",
  "presentation",
  "presentations",
  "quiz",
  "preview",
  "host",
  "setup",
  "sessions",
  "assignments",
  "results",
  "report",
  "discover",
  "templates",
  "groups",
  "account",
  "help",
  "activity",
  "recovery-packs",
  "assign",
  "research",
]);
/** Never collect query strings, fragments, or identifiers from a feedback page. */
export function feedbackPage(path: string): string {
  return (
    "/" +
    path
      .split(/[?#]/, 1)[0]!
      .split("/")
      .filter(Boolean)
      .slice(0, 8)
      .map((segment) => (publicSegments.has(segment) ? segment : ":id"))
      .join("/")
  );
}
export const FeedbackSubmissionSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    category: z.enum(["bug", "idea", "usability", "other"]),
    message: z
      .string()
      .trim()
      .min(10)
      .max(4000)
      .refine((value) => Array.from(value).length >= 10, "Enter at least 10 characters")
      .refine(
        (value) =>
          Array.from(value).every((character) => {
            const code = character.codePointAt(0)!;
            return (
              !(code <= 0x1f && ![9, 10, 13].includes(code)) &&
              !(code >= 0x7f && code <= 0x9f) &&
              !(code >= 0x202a && code <= 0x202e) &&
              !(code >= 0x2066 && code <= 0x2069)
            );
          }),
        "Remove unsupported control characters",
      ),
    page: z.string().max(160).transform(feedbackPage),
    allowContact: z.boolean().default(false),
  })
  .strict();
export type FeedbackSubmission = z.infer<typeof FeedbackSubmissionSchema>;

export const FeedbackPageCursorSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
  })
  .strict();
