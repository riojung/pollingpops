import { SupportedLocaleSchema } from "@openround/contracts";
import { z } from "zod";

/** Only explicit factory calls consume this preference; legacy API calls remain English. */
export const StarterLocaleRequestSchema = z
  .object({
    locale: SupportedLocaleSchema.default("en-CA"),
  })
  .strict();
