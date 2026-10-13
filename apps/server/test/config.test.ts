import { describe, expect, it } from "vitest";
import { createConfigCheckSummary } from "../src/config-check-summary.js";
import { ConfigSchema } from "../src/config.js";

const productionConfig = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:secret@database.internal/openround",
  REDIS_URL: "rediss://cache.internal:6380",
  WEB_ORIGIN: "https://quiz.example.ca",
  PUBLIC_API_URL: "https://api.example.ca",
  COOKIE_SECURE: "true",
  FEATURE_SIGNUPS: "false",
  METRICS_TOKEN: "metrics-token-at-least-24-characters",
} as const;

describe("production configuration", () => {
  it("accepts the explicit local development environment and loopback console origin", () => {
    const config = ConfigSchema.parse({
      NODE_ENV: "development",
      OPENROUND_DEPLOYMENT_ENVIRONMENT: "development",
      COMMUNITY_MODE: "true",
      CONTROL_PUBLIC_ORIGIN: "http://localhost:3002",
      TRACING_ENABLED: "true",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:4318/v1/traces",
    });
    expect(config.OPENROUND_DEPLOYMENT_ENVIRONMENT).toBe("development");
    expect(config.CONTROL_PUBLIC_ORIGIN).toBe("http://localhost:3002");
    expect(config.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBe("http://localhost:4318/v1/traces");
  });
  it.each([
    "https://control.example.ca/path",
    "https://control.example.ca/?token=anything",
    "https://control.example.ca/#view",
    "https://user:password@control.example.ca",
    "http://control.example.ca",
    "https://quiz.example.ca",
  ])("rejects unsafe or shared operator origins: %s", (origin) => {
    expect(() =>
      ConfigSchema.parse({ ...productionConfig, CONTROL_PUBLIC_ORIGIN: origin }),
    ).toThrow();
  });
  it("accepts a dedicated HTTPS console origin and explicit loopback development origin", () => {
    expect(
      ConfigSchema.parse({
        ...productionConfig,
        CONTROL_PUBLIC_ORIGIN: "https://control.example.ca",
      }).CONTROL_PUBLIC_ORIGIN,
    ).toBe("https://control.example.ca");
    expect(
      ConfigSchema.parse({ NODE_ENV: "test", CONTROL_PUBLIC_ORIGIN: "http://127.0.0.1:3002" })
        .CONTROL_PUBLIC_ORIGIN,
    ).toBe("http://127.0.0.1:3002");
  });
  it.each(["production", "development", "test"] as const)(
    "returns validation errors for malformed console origins without throwing from safeParse in %s",
    (nodeEnv) => {
      expect(
        ConfigSchema.safeParse({
          ...productionConfig,
          NODE_ENV: nodeEnv,
          CONTROL_PUBLIC_ORIGIN: "invalid",
        }).success,
      ).toBe(false);
    },
  );
  it("accepts a secure profile with sign-ups paused", () => {
    const config = ConfigSchema.parse(productionConfig);

    expect(config.TRUSTED_PROXY_IP).toBeUndefined();
    expect(config.FEATURE_SIGNUPS).toBe(false);
    expect(config.COOKIE_SECURE).toBe("true");
    expect(config.AUDIT_RETENTION_DAYS).toBe(365);
    expect(config.MAX_PRACTICE_PERSONAL_LINKS).toBe(100);
    expect(config.PRESENTATION_CONCURRENT_RESPONSE_WRITES).toBe(false);
    expect(config.FEATURE_ROUND_EXPERIENCES).toBe(true);
    expect(config.FEATURE_AUDIENCE_PULSE).toBe(true);
    expect(config.FEATURE_ROOM_CHAT).toBe(true);
    expect(config.FEATURE_WORKSPACE_SHELL).toBe(false);
    expect(config.FEATURE_BUILDER_V2).toBe(false);
    expect(config.FEATURE_PRESENTATIONS).toBe(false);
    expect(config.FEATURE_GROUPS).toBe(false);
    expect(config.FEATURE_DISCOVER).toBe(false);
    expect(config.FEATURE_PRESENTATION_REALTIME).toBe(false);
    expect(config.FEATURE_PRESENTATION_COMPANION).toBe(false);
    expect(config.FEATURE_LIVE_FLEX_MODE).toBe(false);
    expect(config.FEATURE_RECOVERY_PACKS).toBe(false);
    expect(config.FEATURE_RECOVERY_PACK_LIVE_CARDS).toBe(false);
    expect(config.FEATURE_QUESTION_HEALTH).toBe(false);
    expect(config.FEATURE_DECISION_REPLAY).toBe(false);
    expect(config.FEATURE_RECOVERY_TRAILS).toBe(false);
    expect(config.FEATURE_CONCEPT_HEALTH).toBe(false);
    expect(config.FEATURE_EXTENDED_QUESTION_TYPES).toBe(false);
    expect(config.FEATURE_VERIFIED_INSTITUTION).toBe(false);
    expect(config.FEATURE_AUDIENCE_SCOPES).toBe(false);
    expect(config.FEATURE_FEEDBACK_ROOMS).toBe(false);
    expect(config.FEATURE_SURVEYS).toBe(false);
    expect(config.FEATURE_FEEDBACK_EXPORTS).toBe(false);
    expect(config.CORE_PARITY_WORKSPACE_ALLOWLIST).toEqual([]);
    expect(config.THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST).toEqual([]);
    expect(config.EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST).toEqual([]);
  });

  it("accepts only one literal trusted proxy address", () => {
    expect(
      ConfigSchema.parse({ ...productionConfig, TRUSTED_PROXY_IP: "172.30.255.2" })
        .TRUSTED_PROXY_IP,
    ).toBe("172.30.255.2");
    expect(() =>
      ConfigSchema.parse({ ...productionConfig, TRUSTED_PROXY_IP: "0.0.0.0/0" }),
    ).toThrow(/Must be an IPv4 or IPv6 address/);
    expect(() =>
      ConfigSchema.parse({ ...productionConfig, TRUSTED_PROXY_IP: "server-ingress" }),
    ).toThrow(/Must be an IPv4 or IPv6 address/);
  });

  it("keeps the authenticated session cookie distinct from the locale preference cookie", () => {
    expect(() =>
      ConfigSchema.parse({ ...productionConfig, COOKIE_NAME: "openround-locale" }),
    ).toThrow(/Must differ from the openround-locale preference cookie/);
  });

  it("parses a bounded workspace rollout allowlist", () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    expect(
      ConfigSchema.parse({
        ...productionConfig,
        THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST: `${first}, ${second}`,
      }).THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST,
    ).toEqual([first, second]);
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST: "not-a-workspace-id",
      }),
    ).toThrow();
  });

  it("reports beta rollout state without retaining allowlist identifiers", () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    const buildId = "a".repeat(40);
    const summary = createConfigCheckSummary(
      ConfigSchema.parse({
        ...productionConfig,
        OPENROUND_BUILD_ID: buildId,
        FEATURE_UX_BETA: "true",
        FEATURE_RECOVERY_REHEARSAL: "true",
        FEATURE_PRACTICE_ASSIGNMENTS: "false",
        FEATURE_WORKSPACE_SHELL: "true",
        FEATURE_BUILDER_V2: "true",
        FEATURE_PRESENTATIONS: "true",
        FEATURE_GROUPS: "false",
        FEATURE_DISCOVER: "true",
        FEATURE_PRESENTATION_REALTIME: "true",
        FEATURE_PRESENTATION_COMPANION: "true",
        FEATURE_LIVE_FLEX_MODE: "true",
        FEATURE_RECOVERY_PACKS: "true",
        FEATURE_RECOVERY_PACK_LIVE_CARDS: "true",
        FEATURE_QUESTION_HEALTH: "true",
        FEATURE_DECISION_REPLAY: "true",
        FEATURE_RECOVERY_TRAILS: "true",
        FEATURE_CONCEPT_HEALTH: "true",
        FEATURE_EXTENDED_QUESTION_TYPES: "true",
        FEATURE_VERIFIED_INSTITUTION: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: `${first},${second}`,
        EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: `${first},${second}`,
      }),
    );

    expect(summary.featureFlags).toMatchObject({
      uxBeta: true,
      recoveryRehearsal: true,
      practiceAssignments: false,
      workspaceShell: true,
      builderV2: true,
      presentations: true,
      groups: false,
      discover: true,
      presentationRealtime: true,
      presentationCompanion: true,
      liveFlexMode: true,
      recoveryPacks: true,
      recoveryPackLiveCards: true,
      questionHealth: true,
      decisionReplay: true,
      recoveryTrails: true,
      conceptHealth: true,
      extendedQuestionTypes: true,
      verifiedInstitution: true,
    });
    expect(summary.uxBetaWorkspaceAllowlistSize).toBe(2);
    expect(summary.evidenceFeaturesWorkspaceAllowlistSize).toBe(2);
    expect(summary.practicePersonalLinkLimit).toBe(100);
    expect(summary.buildId).toBe(buildId);
    expect(JSON.stringify(summary)).not.toContain(first);
    expect(JSON.stringify(summary)).not.toContain(second);
  });

  it("keeps deterministic workspace seeding limited to the test environment", () => {
    const workspaceId = "00000000-0000-4000-8000-00000000b001";
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        TEST_INITIAL_WORKSPACE_ID: workspaceId,
      }),
    ).toThrow(/allowed only when NODE_ENV=test/);

    expect(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        TEST_INITIAL_WORKSPACE_ID: workspaceId,
        TEST_INITIAL_PLAN: "pro",
      }).TEST_INITIAL_WORKSPACE_ID,
    ).toBe(workspaceId);
    expect(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        TEST_INITIAL_WORKSPACE_ID: workspaceId,
        TEST_INITIAL_PLAN: "pro",
      }).TEST_INITIAL_PLAN,
    ).toBe("pro");
    expect(() =>
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        TEST_INITIAL_PLAN: "pro",
      }),
    ).toThrow(/TEST_INITIAL_WORKSPACE_ID is required/);
    expect(() =>
      ConfigSchema.parse({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://app:secret@database.internal/openround",
        TEST_INITIAL_WORKSPACE_ID: workspaceId,
        TEST_INITIAL_PLAN: "pro",
      }),
    ).toThrow(/only with the in-memory repository/);
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        TEST_INITIAL_WORKSPACE_ID: workspaceId,
        TEST_INITIAL_PLAN: "pro",
      }),
    ).toThrow(/allowed only when NODE_ENV=test/);
  });

  it("bounds operator-configured audit retention", () => {
    expect(ConfigSchema.parse({ ...productionConfig, AUDIT_RETENTION_DAYS: "730" })).toMatchObject({
      AUDIT_RETENTION_DAYS: 730,
    });
    expect(() => ConfigSchema.parse({ ...productionConfig, AUDIT_RETENTION_DAYS: "29" })).toThrow();
    expect(() =>
      ConfigSchema.parse({ ...productionConfig, AUDIT_RETENTION_DAYS: "3651" }),
    ).toThrow();
  });

  it("requires SMTP before production sign-ups can be enabled", () => {
    expect(() => ConfigSchema.parse({ ...productionConfig, FEATURE_SIGNUPS: "true" })).toThrow(
      /Required when production sign-ups are enabled/,
    );

    expect(
      ConfigSchema.parse({
        ...productionConfig,
        FEATURE_SIGNUPS: "true",
        SMTP_URL: "smtps://mailer.example.ca:465",
      }).FEATURE_SIGNUPS,
    ).toBe(true);
  });

  it("requires authentication before production metrics can be enabled", () => {
    expect(() => ConfigSchema.parse({ ...productionConfig, METRICS_TOKEN: undefined })).toThrow(
      /Required when production metrics are enabled/,
    );

    expect(
      ConfigSchema.parse({
        ...productionConfig,
        METRICS_ENABLED: "false",
        METRICS_TOKEN: undefined,
      }).METRICS_ENABLED,
    ).toBe(false);
  });

  it("requires an explicit HTTP(S) endpoint when tracing is enabled", () => {
    expect(
      ConfigSchema.parse({
        ...productionConfig,
        TRACING_ENABLED: "false",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
      }).OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    ).toBeUndefined();
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        TRACING_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
      }),
    ).toThrow(/Required when distributed tracing is enabled/);
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        TRACING_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "ftp://collector.example.ca/v1/traces",
      }),
    ).toThrow(/Must use HTTP or HTTPS/);

    expect(
      ConfigSchema.parse({
        ...productionConfig,
        OPENROUND_DEPLOYMENT_ENVIRONMENT: "staging",
        TRACING_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://otel-collector:4318/v1/traces",
      }).OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    ).toBe("http://otel-collector:4318/v1/traces");
    expect(
      ConfigSchema.parse({
        ...productionConfig,
        OPENROUND_DEPLOYMENT_ENVIRONMENT: "staging",
        TRACING_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://[::ffff:8.8.8.8]/v1/traces",
      }).OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    ).toBe("https://[::ffff:8.8.8.8]/v1/traces");
  });

  it.each([
    "http://localhost:4318/v1/traces",
    "http://collector.localhost:4318/v1/traces",
    "http://collector.localhost.:4318/v1/traces",
    "http://127.0.0.2:4318/v1/traces",
    "http://0.0.0.0:4318/v1/traces",
    "https://[::1]:4318/v1/traces",
    "https://[::]:4318/v1/traces",
    "http://[::ffff:127.0.0.1]:4318/v1/traces",
    "http://[::ffff:0.0.0.0]:4318/v1/traces",
    "http://[::ffff:192.0.2.10]:4318/v1/traces",
    "https://collector.example/v1/traces",
    "https://replace-collector.openround.ca/v1/traces",
    "https://192.0.2.10/v1/traces",
  ])("rejects unusable hosted tracing endpoint %s", (endpoint) => {
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        OPENROUND_DEPLOYMENT_ENVIRONMENT: "staging",
        TRACING_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
      }),
    ).toThrow(/must not use a reserved, placeholder, loopback, or unspecified address/);
  });

  it.each([
    "https://user:secret@collector.openround.ca/v1/traces",
    "https://collector.openround.ca/v1/traces?token=secret",
    "https://collector.openround.ca/v1/traces#secret",
  ])("rejects hosted tracing endpoint metadata in %s", (endpoint) => {
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        OPENROUND_DEPLOYMENT_ENVIRONMENT: "staging",
        TRACING_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
      }),
    ).toThrow(/must not contain credentials, a query, or a fragment/);
  });

  it("keeps loopback tracing available outside a hosted deployment", () => {
    const endpoint = "http://127.0.0.1:4318/v1/traces";
    expect(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        TRACING_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
      }).OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    ).toBe(endpoint);
  });

  it.each(["WEB_ORIGIN", "PUBLIC_API_URL", "S3_PUBLIC_ENDPOINT"] as const)(
    "requires HTTPS for %s",
    (key) => {
      expect(() =>
        ConfigSchema.parse({ ...productionConfig, [key]: "http://public.example.ca" }),
      ).toThrow(/Must use HTTPS in production/);
    },
  );

  it("rejects an explicitly insecure production cookie", () => {
    expect(() => ConfigSchema.parse({ ...productionConfig, COOKIE_SECURE: "false" })).toThrow(
      /Cannot be false in production/,
    );
  });

  it("requires an explicit secure provider endpoint before enabling authoring AI", () => {
    expect(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        AUTHORING_AI_ENDPOINT: "",
        AUTHORING_AI_API_KEY: "",
      }),
    ).toMatchObject({ AUTHORING_AI_MODE: "disabled" });

    expect(() =>
      ConfigSchema.parse({ ...productionConfig, AUTHORING_AI_MODE: "openai_compatible" }),
    ).toThrow(/Required when the authoring assistant is enabled/);

    expect(
      ConfigSchema.parse({
        ...productionConfig,
        AUTHORING_AI_MODE: "openai_compatible",
        AUTHORING_AI_ENDPOINT: "https://approved-provider.example.ca/v1/chat/completions",
        AUTHORING_AI_MODEL: "approved-model",
      }).AUTHORING_AI_MODE,
    ).toBe("openai_compatible");

    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        AUTHORING_AI_MODE: "openai_compatible",
        AUTHORING_AI_ENDPOINT: "http://public-provider.example.ca/v1/chat/completions",
      }),
    ).toThrow(/Must use HTTPS in production/);

    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        AUTHORING_AI_MODE: "openai_compatible",
        AUTHORING_AI_ENDPOINT: "https://approved-provider.example.ca/v1/chat/completions",
        AUTHORING_WORKER_LEASE_MS: "80000",
        AUTHORING_EXTRACTION_TIMEOUT_MS: "20000",
      }),
    ).toThrow(/Must exceed AUTHORING_EXTRACTION_TIMEOUT_MS/);
  });

  it("requires complete, secure OIDC configuration when generic federation is enabled", () => {
    expect(() => ConfigSchema.parse({ ...productionConfig, OIDC_MODE: "generic" })).toThrow(
      /Required for OIDC/,
    );
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        OIDC_MODE: "generic",
        OIDC_ISSUER: "https://identity.example.edu",
        OIDC_CLIENT_ID: "openround",
      }),
    ).toThrow(/selected OIDC client authentication method/);
    expect(
      ConfigSchema.parse({
        ...productionConfig,
        OIDC_MODE: "generic",
        OIDC_ISSUER: "https://identity.example.edu",
        OIDC_CLIENT_ID: "openround",
        OIDC_CLIENT_SECRET: "secret",
      }).OIDC_MODE,
    ).toBe("generic");
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        OIDC_MODE: "generic",
        OIDC_ISSUER: "http://identity.example.edu",
        OIDC_CLIENT_ID: "openround",
        OIDC_CLIENT_AUTH: "none",
      }),
    ).toThrow(/Must use HTTPS in production/);
  });

  it("requires an operator-managed signing key before enabling LTI", () => {
    expect(() => ConfigSchema.parse({ ...productionConfig, LTI_MODE: "tool" })).toThrow(
      /Required when the LTI tool is enabled/,
    );
    expect(
      ConfigSchema.parse({
        ...productionConfig,
        LTI_MODE: "tool",
        LTI_TOOL_PRIVATE_JWK: '{"kty":"RSA"}',
      }).LTI_MODE,
    ).toBe("tool");
  });

  it("allows an explicit private-network HTTP community profile", () => {
    const config = ConfigSchema.parse({
      ...productionConfig,
      WEB_ORIGIN: "http://192.168.1.20:8080",
      PUBLIC_API_URL: "http://192.168.1.20:8080",
      S3_PUBLIC_ENDPOINT: "http://192.168.1.20:9000",
      COOKIE_SECURE: "false",
      COMMUNITY_MODE: "true",
      ALLOW_INSECURE_LOCAL_HTTP: "true",
      SMTP_URL: "smtp://mailpit:1025",
      DEVELOPMENT_EMAIL_INBOX_URL: "http://localhost:8025",
      FEATURE_SIGNUPS: "true",
    });

    expect(config.ALLOW_INSECURE_LOCAL_HTTP).toBe(true);
    expect(config.AUTH_DEBUG_MAGIC_LINKS).toBe(false);
    expect(config.DEVELOPMENT_EMAIL_INBOX_URL).toBe("http://localhost:8025");
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        DEVELOPMENT_EMAIL_INBOX_URL: "ftp://localhost/inbox",
      }),
    ).toThrow(/Must use HTTP or HTTPS/);
    expect(
      ConfigSchema.safeParse({
        ...productionConfig,
        DEVELOPMENT_EMAIL_INBOX_URL: "not a URL",
      }).success,
    ).toBe(false);
  });

  it("allows debug magic links for an explicit loopback-only community profile", () => {
    const config = ConfigSchema.parse({
      ...productionConfig,
      WEB_ORIGIN: "http://localhost:8080",
      PUBLIC_API_URL: "http://127.0.0.1:8080",
      COOKIE_SECURE: "false",
      COMMUNITY_MODE: "true",
      ALLOW_INSECURE_LOCAL_HTTP: "true",
      AUTH_DEBUG_MAGIC_LINKS: "true",
    });

    expect(config.AUTH_DEBUG_MAGIC_LINKS).toBe(true);
  });

  it.each(["http://192.168.1.20:8080", "http://quiz.local:8080"])(
    "keeps debug magic links off non-loopback origin %s",
    (origin) => {
      expect(() =>
        ConfigSchema.parse({
          ...productionConfig,
          WEB_ORIGIN: origin,
          PUBLIC_API_URL: origin,
          COOKIE_SECURE: "false",
          COMMUNITY_MODE: "true",
          ALLOW_INSECURE_LOCAL_HTTP: "true",
          AUTH_DEBUG_MAGIC_LINKS: "true",
        }),
      ).toThrow(/loopback HTTP origins/);
    },
  );

  it("keeps debug magic links out of hosted production", () => {
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        AUTH_DEBUG_MAGIC_LINKS: "true",
      }),
    ).toThrow(/loopback HTTP origins/);

    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        WEB_ORIGIN: "http://localhost:8080",
        PUBLIC_API_URL: "http://localhost:8080",
        COOKIE_SECURE: "false",
        COMMUNITY_MODE: "true",
        ALLOW_INSECURE_LOCAL_HTTP: "true",
        BILLING_MODE: "stripe",
        STRIPE_SECRET_KEY: "secret",
        STRIPE_WEBHOOK_SECRET: "webhook-secret",
        STRIPE_PRO_PRICE_ID: "price-pro",
        AUTH_DEBUG_MAGIC_LINKS: "true",
      }),
    ).toThrow(/loopback HTTP origins/);
  });

  it("does not let the local HTTP escape hatch weaken a hosted or public deployment", () => {
    const localOverride = {
      ...productionConfig,
      COOKIE_SECURE: "false",
      COMMUNITY_MODE: "true",
      ALLOW_INSECURE_LOCAL_HTTP: "true",
    } as const;

    expect(() =>
      ConfigSchema.parse({
        ...localOverride,
        WEB_ORIGIN: "http://quiz.example.ca",
        PUBLIC_API_URL: "http://api.example.ca",
      }),
    ).toThrow(/limited to loopback or private-network URLs/);
    expect(() =>
      ConfigSchema.parse({
        ...localOverride,
        WEB_ORIGIN: "http://localhost:8080",
        PUBLIC_API_URL: "http://localhost:8080",
        BILLING_MODE: "stripe",
        STRIPE_SECRET_KEY: "secret",
        STRIPE_WEBHOOK_SECRET: "webhook-secret",
        STRIPE_PRO_PRICE_ID: "price-pro",
      }),
    ).toThrow(/Only allowed for non-billing community deployments/);
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        COMMUNITY_MODE: "true",
        ALLOW_INSECURE_LOCAL_HTTP: "true",
      }),
    ).toThrow(/Must remain disabled when every public URL uses HTTPS/);
  });

  it("keeps local non-production profiles available", () => {
    expect(
      ConfigSchema.parse({
        ...productionConfig,
        NODE_ENV: "development",
        WEB_ORIGIN: "http://localhost:8080",
        PUBLIC_API_URL: "http://localhost:8080",
        COOKIE_SECURE: "false",
        FEATURE_SIGNUPS: "true",
      }).NODE_ENV,
    ).toBe("development");
  });
});
