import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

describe("business metrics configuration", () => {
  it.each([
    { deployment: "default-off hosted", extra: {}, enabled: false },
    {
      deployment: "Community with business configuration enabled",
      extra: { COMMUNITY_MODE: "true", BUSINESS_PLATFORM_ENABLED: "true" },
      enabled: false,
    },
    {
      deployment: "business-enabled hosted",
      extra: { BUSINESS_PLATFORM_ENABLED: "true" },
      enabled: true,
    },
  ])("publishes projection availability only for $deployment", async ({ extra, enabled }) => {
    const { app } = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        LOG_LEVEL: "silent",
        ...extra,
      }),
      { repository: new MemoryRepository(), cache: new MemorySessionCache() },
    );
    try {
      const response = await app.inject({ method: "GET", url: "/metrics" });
      expect(response.statusCode).toBe(200);
      if (enabled) expect(response.body).toContain("openround_business_projection_up 1");
      else expect(response.body).not.toContain("openround_business_projection_up");
    } finally {
      await app.close();
    }
  });
});
