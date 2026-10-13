import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createPlatformRepository, MemoryRepository } from "@openround/db";
import { buildApp } from "../../src/app.js";
import { ConfigSchema } from "../../src/config.js";
import { attachRealtime } from "../../src/realtime.js";

// This executable is a loopback-only browser fixture, never a production server entrypoint.
if (process.env.NODE_ENV !== "test")
  throw new Error("Business browser fixture requires NODE_ENV=test");
const config = ConfigSchema.parse({
  NODE_ENV: "test",
  PORT: process.env.PORT ?? "4300",
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3300",
  PUBLIC_API_URL: process.env.PUBLIC_API_URL ?? "http://127.0.0.1:4300",
  HOST: "127.0.0.1",
  ALLOW_IN_MEMORY: "true",
  COMMUNITY_MODE: "false",
  BUSINESS_PLATFORM_ENABLED: "true",
  BUSINESS_EVENT_CREDITS_ENABLED: "true",
  BILLING_MODE: "disabled",
  LOG_LEVEL: "silent",
});
const repository = new MemoryRepository();
const built = await buildApp(config, { repository });
const platform = createPlatformRepository(repository);
const realtime = await attachRealtime(
  built.app.server,
  built.sessions,
  config,
  built.metrics,
  built.interactions,
  {
    service: built.presentationService,
    consumeAdmission: built.cache.consumeRateLimit.bind(built.cache),
  },
  built.audienceScopeService,
);
built.app.post("/__test/business/seed", async (request) => {
  const input = z
    .object({
      organizationId: z.string().uuid(),
      actorId: z.string().uuid(),
      credits: z.number().int().min(0).max(10).optional(),
      billingOnlyUserId: z.string().uuid().optional(),
    })
    .strict()
    .parse(request.body);
  await platform.requireOrganizationRole(input.organizationId, input.actorId, ["owner"]);
  if (input.credits)
    await platform.grantCredits({
      organizationId: input.organizationId,
      quantity: input.credits,
      actorId: input.actorId,
      reason: "Synthetic browser fixture",
      sourceKey: `browser-fixture:${input.organizationId}`,
    });
  if (input.billingOnlyUserId) {
    await platform.requireOrganizationRole(input.organizationId, input.billingOnlyUserId, [
      "billing",
    ]);
    for (const [id, member] of repository.workspaceMembers)
      if (member.userId === input.billingOnlyUserId) repository.workspaceMembers.delete(id);
  }
  return { seeded: true, receipt: randomUUID() };
});
const close = async () => {
  await realtime.close();
  await built.app.close();
  process.exit(0);
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
await built.app.listen({ host: "127.0.0.1", port: config.PORT });
