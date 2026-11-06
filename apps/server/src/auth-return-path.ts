import { z } from "zod";
import { LocalReturnPathSchema } from "@openround/contracts";

const reviewId = z.string().uuid();
const reviewPath =
  /^\/presentation-review\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Identity-only reviewers can return to a clean review URL without workspace authorization. */
export function identityOnlyAuthReturnPath(returnTo: string | null | undefined): string {
  const local = LocalReturnPathSchema.safeParse(returnTo);
  if (!local.success) return "/organization";
  const match = reviewPath.exec(local.data);
  return match && reviewId.safeParse(match[1]).success ? local.data : "/organization";
}
