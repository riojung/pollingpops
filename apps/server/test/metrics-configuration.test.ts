import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { ClamAvScanner } from "../src/malware-scanner.js";

describe("scanner metrics privacy", () => {
  it("checks scanner freshness only after metrics authentication succeeds", async () => {
    const token = "synthetic-metrics-token-at-least-24-characters";
    const scanner = new ClamAvScanner("unused.internal", 3310, 30_000);
    const check = vi.spyOn(scanner, "checkHealth").mockResolvedValue({
      available: true,
      fresh: false,
      databaseVersion: 28_000,
      databaseTimestampSeconds: 1,
      checkedAtSeconds: 2,
    });
    const { app } = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        LOG_LEVEL: "silent",
        METRICS_TOKEN: token,
      }),
      { repository: new MemoryRepository(), cache: new MemorySessionCache(), scanner },
    );
    try {
      const denied = await app.inject({ method: "GET", url: "/metrics" });
      expect(denied.statusCode).toBe(401);
      expect(denied.body).not.toContain("openround_malware_");
      expect(check).not.toHaveBeenCalled();
      const allowed = await app.inject({
        method: "GET",
        url: "/metrics",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.body).toContain("openround_malware_scanner_fresh 0");
      expect(allowed.body).toContain("openround_malware_signature_database_version 28000");
      expect(allowed.body).not.toContain("unused.internal");
      expect(check).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("keeps stub scanner modes independent of active-daemon probes", async () => {
    const { app } = await buildApp(
      ConfigSchema.parse({ NODE_ENV: "test", ALLOW_IN_MEMORY: "true", LOG_LEVEL: "silent" }),
      {
        repository: new MemoryRepository(),
        cache: new MemorySessionCache(),
        scanner: { scan: async () => ({ clean: true, signature: null }) },
      },
    );
    try {
      const response = await app.inject({ method: "GET", url: "/metrics" });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain("openround_malware_");
    } finally {
      await app.close();
    }
  });
});

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
