import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { z } from "zod";
import { LOCALE_COOKIE_NAME, PRODUCT_BRAND } from "@openround/contracts";
import { parseCatalog } from "@openround/control-plane";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const defaultTrueBooleanString = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

function isHttpOrHttpsUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const optionalHttpUrl = optionalUrl.refine(
  (value) => !value || isHttpOrHttpsUrl(value),
  "Must use HTTP or HTTPS",
);

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalIpAddress = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .trim()
    .refine((value) => isIP(value) !== 0, "Must be an IPv4 or IPv6 address")
    .optional(),
);

const uuidAllowlist = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().uuid()).max(1_000));

function isPrivateHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:") return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return true;
  }
  if (isIP(hostname) === 4) {
    const [first = 0, second = 0] = hostname.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (isIP(hostname) === 6) {
    return hostname === "::1" || /^(?:fc|fd|fe[89ab])/.test(hostname);
  }
  return false;
}

function isLoopbackHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:") return false;
  return isLoopbackHostname(url.hostname);
}

function mappedIpv4Octets(hostname: string) {
  const dotted = hostname.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const octets = dotted.slice(1).map(Number);
    return octets.every((octet) => octet <= 255) ? octets : undefined;
  }
  const match = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!match) return undefined;
  const high = Number.parseInt(match[1]!, 16);
  const low = Number.parseInt(match[2]!, 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isReservedHostedIpv4([first, second, third]: number[]) {
  return (
    first === 0 ||
    first === 127 ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

function isLoopbackHostname(value: string) {
  const hostname = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (isIP(hostname) === 4) return hostname.split(".").map(Number)[0] === 127;
  if (isIP(hostname) !== 6) return false;
  const mapped = mappedIpv4Octets(hostname);
  return hostname === "::1" || mapped?.[0] === 127;
}

function isUnusableHostedTracingHostname(value: string) {
  const hostname = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (isLoopbackHostname(hostname) || hostname === "::") return true;
  if (isIP(hostname) === 4) {
    return isReservedHostedIpv4(hostname.split(".").map(Number));
  }
  if (isIP(hostname) === 6) {
    const mapped = mappedIpv4Octets(hostname);
    return (
      (mapped !== undefined && isReservedHostedIpv4(mapped)) || hostname.startsWith("2001:db8:")
    );
  }
  if (
    ["example", "invalid", "localhost", "test", "example.com", "example.net", "example.org"].some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    )
  ) {
    return true;
  }
  return hostname
    .split(".")
    .some(
      (label) =>
        ["changeme", "example", "placeholder", "replace"].includes(label) ||
        label.startsWith("replace-") ||
        label.startsWith("placeholder-"),
    );
}

export const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    OPENROUND_DEPLOYMENT_ENVIRONMENT: z.enum(["development", "staging", "production"]).optional(),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    TRUSTED_PROXY_IP: optionalIpAddress,
    WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
    PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
    COOKIE_NAME: z.string().default("openround_creator"),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
    ALLOW_INSECURE_LOCAL_HTTP: booleanString,
    DATABASE_URL: z.string().min(1).optional(),
    DATABASE_MIGRATION_URL: z.string().min(1).optional(),
    REDIS_URL: z.string().min(1).optional(),
    SESSION_MUTATION_LEASE_TTL_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
    SESSION_MUTATION_LEASE_WAIT_MS: z.coerce.number().int().min(100).max(15_000).default(5_000),
    RUN_MIGRATIONS: booleanString,
    ALLOW_IN_MEMORY: booleanString,
    COMMUNITY_MODE: booleanString,
    MAX_SESSION_PARTICIPANTS: z.coerce.number().int().min(1).max(250).default(100),
    MAX_PRACTICE_PERSONAL_LINKS: z.coerce.number().int().min(0).max(100_000).default(100),
    RETENTION_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1_440).default(60),
    REPORT_WORKER_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
    REPORT_WORKER_LEASE_MS: z.coerce.number().int().min(10_000).max(600_000).default(120_000),
    PRESENTATION_CONCURRENT_RESPONSE_WRITES: booleanString,
    AUTHORING_AI_MODE: z.enum(["disabled", "openai_compatible"]).default("disabled"),
    AUTHORING_AI_ENDPOINT: optionalUrl,
    AUTHORING_AI_API_KEY: optionalSecret,
    AUTHORING_AI_MODEL: z.string().trim().min(1).max(200).default("operator-configured"),
    AUTHORING_AI_PROVIDER_NAME: z.string().trim().min(1).max(80).default("operator"),
    AUTHORING_WORKER_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(3_000),
    AUTHORING_WORKER_LEASE_MS: z.coerce.number().int().min(10_000).max(600_000).default(120_000),
    AUTHORING_EXTRACTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(20_000),
    OIDC_MODE: z.enum(["disabled", "generic"]).default("disabled"),
    OIDC_ISSUER: optionalUrl,
    OIDC_CLIENT_ID: optionalSecret,
    OIDC_CLIENT_SECRET: optionalSecret,
    OIDC_CLIENT_AUTH: z
      .enum(["client_secret_post", "client_secret_basic", "none"])
      .default("client_secret_post"),
    OIDC_PROVIDER_NAME: z.string().trim().min(1).max(80).default("Institution sign-in"),
    OIDC_TRANSACTION_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    LTI_MODE: z.enum(["disabled", "tool"]).default("disabled"),
    LTI_TOOL_PRIVATE_JWK: optionalSecret,
    LTI_TOOL_KEY_ID: z.string().trim().min(1).max(200).default("openround-lti-1"),
    LTI_TRANSACTION_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    LTI_LAUNCH_TTL_SECONDS: z.coerce.number().int().min(300).max(3_600).default(900),
    AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(3_650).default(365),
    COMMUNITY_REPORT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(365),
    MEDIA_QUARANTINE_RETENTION_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    FEATURE_SIGNUPS: defaultTrueBooleanString,
    FEATURE_SESSION_CREATION: defaultTrueBooleanString,
    FEATURE_MEDIA_UPLOADS: defaultTrueBooleanString,
    FEATURE_ROUND_EXPERIENCES: defaultTrueBooleanString,
    FEATURE_AUDIENCE_PULSE: defaultTrueBooleanString,
    FEATURE_ROOM_CHAT: defaultTrueBooleanString,
    FEATURE_UX_BETA: booleanString,
    FEATURE_RECOVERY_REHEARSAL: booleanString,
    FEATURE_PRACTICE_ASSIGNMENTS: booleanString,
    FEATURE_WORKSPACE_SHELL: booleanString,
    FEATURE_BUILDER_V2: booleanString,
    FEATURE_PRESENTATIONS: booleanString,
    FEATURE_GROUPS: booleanString,
    FEATURE_DISCOVER: booleanString,
    FEATURE_PRESENTATION_REALTIME: booleanString,
    FEATURE_PRESENTATION_COMPANION: booleanString,
    FEATURE_LIVE_FLEX_MODE: booleanString,
    FEATURE_RECOVERY_PACKS: booleanString,
    FEATURE_RECOVERY_PACK_LIVE_CARDS: booleanString,
    FEATURE_QUESTION_HEALTH: booleanString,
    FEATURE_DECISION_REPLAY: booleanString,
    FEATURE_RECOVERY_TRAILS: booleanString,
    FEATURE_CONCEPT_HEALTH: booleanString,
    FEATURE_EXTENDED_QUESTION_TYPES: booleanString,
    FEATURE_VERIFIED_INSTITUTION: booleanString,
    FEATURE_AUDIENCE_SCOPES: booleanString,
    FEATURE_ROUND_CLIENT_PROTOCOL: booleanString,
    FEATURE_FEEDBACK_ROOMS: booleanString,
    FEATURE_SURVEYS: booleanString,
    FEATURE_FEEDBACK_EXPORTS: booleanString,
    CORE_PARITY_WORKSPACE_ALLOWLIST: uuidAllowlist,
    THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST: uuidAllowlist,
    UX_BETA_WORKSPACE_ALLOWLIST: uuidAllowlist,
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: uuidAllowlist,
    TEST_INITIAL_WORKSPACE_ID: z.string().uuid().optional(),
    TEST_INITIAL_PLAN: z.enum(["free", "pro", "team"]).optional(),
    METRICS_ENABLED: defaultTrueBooleanString,
    METRICS_TOKEN: z.string().min(24).optional(),
    OPENROUND_LOG_SHIPPING_MODE: z.enum(["disabled", "external-host-agent"]).default("disabled"),
    TRACING_ENABLED: booleanString,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: optionalHttpUrl,
    OTEL_SERVICE_NAME: z.string().trim().min(1).max(120).default("openround-server"),
    OTEL_SERVICE_VERSION: z.string().trim().min(1).max(80).default("0.1.0"),
    OPENROUND_BUILD_ID: z.string().trim().min(1).max(200).default("unversioned"),
    SMTP_URL: z.string().min(1).optional(),
    EMAIL_FROM: z.string().default(`${PRODUCT_BRAND.name} <noreply@localhost>`),
    DEVELOPMENT_EMAIL_INBOX_URL: optionalHttpUrl,
    AUTH_DEBUG_MAGIC_LINKS: booleanString,
    POLICY_VERSION: z.string().trim().min(1).max(80).default("2026-09-14-draft"),
    BILLING_MODE: z.enum(["disabled", "stripe"]).default("disabled"),
    BUSINESS_PLATFORM_ENABLED: booleanString,
    CONTROL_PUBLIC_ORIGIN: optionalHttpUrl,
    BUSINESS_EVENT_CREDITS_ENABLED: booleanString,
    BUSINESS_STRIPE_AUTOMATIC_TAX_ENABLED: booleanString,
    BACKGROUND_JOBS_MODE: z.enum(["in_process", "separate"]).default("in_process"),
    BUSINESS_CATALOG_JSON: z
      .string()
      .default("[]")
      .superRefine((value, context) => {
        try {
          parseCatalog(value);
        } catch {
          context.addIssue({
            code: "custom",
            message: "Invalid business catalog; validate offers, versions, and published prices",
          });
        }
      }),
    BUSINESS_BILLING_WORKER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(60_000)
      .default(3_000),
    BUSINESS_BILLING_WORKER_LEASE_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(600_000)
      .default(120_000),
    BUSINESS_BILLING_RECONCILE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(900_000),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRO_PRICE_ID: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_PUBLIC_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("ca-central-1"),
    S3_BUCKET: z.string().default("openround-media"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanString,
    MEDIA_SCAN_MODE: z.enum(["disabled", "clamav"]).default("disabled"),
    CLAMAV_HOST: z.string().min(1).optional(),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    ADMIN_TOKEN: z.string().min(24).optional(),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .superRefine((config, ctx) => {
    if (config.CONTROL_PUBLIC_ORIGIN) {
      let origin: URL | undefined;
      try {
        origin = new URL(config.CONTROL_PUBLIC_ORIGIN);
      } catch {
        // The URL schema already reports malformed input without throwing from safeParse.
      }
      const localHttp =
        origin &&
        (config.NODE_ENV !== "production" || config.ALLOW_INSECURE_LOCAL_HTTP) &&
        isLoopbackHttpUrl(config.CONTROL_PUBLIC_ORIGIN);
      if (
        !origin ||
        origin.username ||
        origin.password ||
        origin.search ||
        origin.hash ||
        origin.pathname !== "/" ||
        (origin.protocol !== "https:" && !localHttp)
      )
        ctx.addIssue({
          code: "custom",
          path: ["CONTROL_PUBLIC_ORIGIN"],
          message: "Expected an operator HTTPS origin; explicit local HTTP may use loopback only",
        });
      let productOrigin: string | undefined;
      try {
        productOrigin = new URL(config.WEB_ORIGIN).origin;
      } catch {
        // WEB_ORIGIN has its own URL validation.
      }
      if (origin && origin.origin === productOrigin)
        ctx.addIssue({
          code: "custom",
          path: ["CONTROL_PUBLIC_ORIGIN"],
          message: "The operator console must use a separate origin",
        });
    }
    if (config.COOKIE_NAME === LOCALE_COOKIE_NAME) {
      ctx.addIssue({
        code: "custom",
        path: ["COOKIE_NAME"],
        message: `Must differ from the ${LOCALE_COOKIE_NAME} preference cookie`,
      });
    }
    if (config.TEST_INITIAL_WORKSPACE_ID && config.NODE_ENV !== "test") {
      ctx.addIssue({
        code: "custom",
        path: ["TEST_INITIAL_WORKSPACE_ID"],
        message: "Test workspace seeding is allowed only when NODE_ENV=test",
      });
    }
    if (config.TEST_INITIAL_PLAN && config.NODE_ENV !== "test") {
      ctx.addIssue({
        code: "custom",
        path: ["TEST_INITIAL_PLAN"],
        message: "Test plan seeding is allowed only when NODE_ENV=test",
      });
    }
    if (config.TEST_INITIAL_PLAN && !config.TEST_INITIAL_WORKSPACE_ID) {
      ctx.addIssue({
        code: "custom",
        path: ["TEST_INITIAL_PLAN"],
        message: "TEST_INITIAL_WORKSPACE_ID is required when seeding a test plan",
      });
    }
    if (config.TEST_INITIAL_PLAN && config.DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["TEST_INITIAL_PLAN"],
        message: "Test plan seeding is available only with the in-memory repository",
      });
    }
    const requireHttps = (key: "WEB_ORIGIN" | "PUBLIC_API_URL" | "S3_PUBLIC_ENDPOINT") => {
      const value = config[key];
      if (value && new URL(value).protocol !== "https:") {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Must use HTTPS in production",
        });
      }
    };

    if (config.NODE_ENV === "production" && !config.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "Required in production" });
    }
    if (config.NODE_ENV === "production" && !config.REDIS_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message: "Required in production for distributed session mutation coordination",
      });
    }
    if (config.SESSION_MUTATION_LEASE_WAIT_MS >= config.SESSION_MUTATION_LEASE_TTL_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_MUTATION_LEASE_WAIT_MS"],
        message: "Must be shorter than SESSION_MUTATION_LEASE_TTL_MS",
      });
    }
    if (config.RUN_MIGRATIONS && !config.DATABASE_MIGRATION_URL && !config.DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_MIGRATION_URL"],
        message: "A database connection is required to run migrations",
      });
    }
    if (config.AUTHORING_AI_MODE === "openai_compatible" && !config.AUTHORING_AI_ENDPOINT) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTHORING_AI_ENDPOINT"],
        message: "Required when the authoring assistant is enabled",
      });
    }
    if (
      config.AUTHORING_AI_MODE !== "disabled" &&
      config.AUTHORING_WORKER_LEASE_MS <= config.AUTHORING_EXTRACTION_TIMEOUT_MS + 60_000
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTHORING_WORKER_LEASE_MS"],
        message:
          "Must exceed AUTHORING_EXTRACTION_TIMEOUT_MS plus the 60-second generation timeout",
      });
    }
    if (
      config.NODE_ENV === "production" &&
      config.AUTHORING_AI_ENDPOINT &&
      new URL(config.AUTHORING_AI_ENDPOINT).protocol !== "https:" &&
      !(config.ALLOW_INSECURE_LOCAL_HTTP && isPrivateHttpUrl(config.AUTHORING_AI_ENDPOINT))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTHORING_AI_ENDPOINT"],
        message: "Must use HTTPS in production unless private local HTTP is explicitly allowed",
      });
    }
    if (config.LTI_MODE === "tool" && !config.LTI_TOOL_PRIVATE_JWK) {
      ctx.addIssue({
        code: "custom",
        path: ["LTI_TOOL_PRIVATE_JWK"],
        message: "Required when the LTI tool is enabled",
      });
    }
    if (config.OIDC_MODE === "generic") {
      if (!config.OIDC_ISSUER) {
        ctx.addIssue({ code: "custom", path: ["OIDC_ISSUER"], message: "Required for OIDC" });
      }
      if (!config.OIDC_CLIENT_ID) {
        ctx.addIssue({ code: "custom", path: ["OIDC_CLIENT_ID"], message: "Required for OIDC" });
      }
      if (config.OIDC_CLIENT_AUTH !== "none" && !config.OIDC_CLIENT_SECRET) {
        ctx.addIssue({
          code: "custom",
          path: ["OIDC_CLIENT_SECRET"],
          message: "Required for the selected OIDC client authentication method",
        });
      }
    }
    if (
      config.NODE_ENV === "production" &&
      config.OIDC_ISSUER &&
      new URL(config.OIDC_ISSUER).protocol !== "https:" &&
      !(config.ALLOW_INSECURE_LOCAL_HTTP && isPrivateHttpUrl(config.OIDC_ISSUER))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["OIDC_ISSUER"],
        message: "Must use HTTPS in production unless private local HTTP is explicitly allowed",
      });
    }
    if (config.NODE_ENV === "production" && config.ALLOW_IN_MEMORY) {
      ctx.addIssue({
        code: "custom",
        path: ["ALLOW_IN_MEMORY"],
        message: "Forbidden in production",
      });
    }
    if (config.NODE_ENV === "production") {
      const usesLocalWebHttp = [config.WEB_ORIGIN, config.PUBLIC_API_URL].some(
        (value) => new URL(value).protocol === "http:",
      );
      if (config.ALLOW_INSECURE_LOCAL_HTTP) {
        if (!config.COMMUNITY_MODE || config.BILLING_MODE !== "disabled") {
          ctx.addIssue({
            code: "custom",
            path: ["ALLOW_INSECURE_LOCAL_HTTP"],
            message: "Only allowed for non-billing community deployments",
          });
        }
        for (const key of ["WEB_ORIGIN", "PUBLIC_API_URL", "S3_PUBLIC_ENDPOINT"] as const) {
          const value = config[key];
          if (value && new URL(value).protocol !== "https:" && !isPrivateHttpUrl(value)) {
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: "Insecure local HTTP is limited to loopback or private-network URLs",
            });
          }
        }
        const usesAnyLocalHttp = [
          config.WEB_ORIGIN,
          config.PUBLIC_API_URL,
          config.S3_PUBLIC_ENDPOINT,
        ].some((value) => value && new URL(value).protocol === "http:");
        if (!usesAnyLocalHttp) {
          ctx.addIssue({
            code: "custom",
            path: ["ALLOW_INSECURE_LOCAL_HTTP"],
            message: "Must remain disabled when every public URL uses HTTPS",
          });
        }
        if (usesLocalWebHttp && config.COOKIE_SECURE !== "false") {
          ctx.addIssue({
            code: "custom",
            path: ["COOKIE_SECURE"],
            message: "Must be false for an insecure local HTTP profile",
          });
        }
      } else {
        requireHttps("WEB_ORIGIN");
        requireHttps("PUBLIC_API_URL");
        requireHttps("S3_PUBLIC_ENDPOINT");
      }
      if (!config.ALLOW_INSECURE_LOCAL_HTTP && config.COOKIE_SECURE === "false") {
        ctx.addIssue({
          code: "custom",
          path: ["COOKIE_SECURE"],
          message: "Cannot be false in production",
        });
      }
      if (config.FEATURE_SIGNUPS && !config.SMTP_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_URL"],
          message: "Required when production sign-ups are enabled",
        });
      }
      if (
        config.METRICS_ENABLED &&
        !config.METRICS_TOKEN &&
        !(config.ALLOW_INSECURE_LOCAL_HTTP && usesLocalWebHttp)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["METRICS_TOKEN"],
          message: "Required when production metrics are enabled",
        });
      }
    }
    if (
      config.AUTH_DEBUG_MAGIC_LINKS &&
      config.NODE_ENV === "production" &&
      (!config.COMMUNITY_MODE ||
        config.BILLING_MODE !== "disabled" ||
        !config.ALLOW_INSECURE_LOCAL_HTTP ||
        !isLoopbackHttpUrl(config.WEB_ORIGIN) ||
        !isLoopbackHttpUrl(config.PUBLIC_API_URL))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_DEBUG_MAGIC_LINKS"],
        message:
          "Production debug links are limited to non-billing community deployments on loopback HTTP origins",
      });
    }
    if (config.BILLING_MODE === "stripe") {
      for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const) {
        if (!config[key])
          ctx.addIssue({ code: "custom", path: [key], message: "Required for Stripe billing" });
      }
      if (!config.BUSINESS_PLATFORM_ENABLED && !config.STRIPE_PRO_PRICE_ID) {
        ctx.addIssue({
          code: "custom",
          path: ["STRIPE_PRO_PRICE_ID"],
          message: "Required for legacy Stripe billing",
        });
      }
    }
    if (config.MEDIA_SCAN_MODE === "clamav" && (!config.CLAMAV_HOST || !config.S3_ENDPOINT)) {
      ctx.addIssue({
        code: "custom",
        path: ["MEDIA_SCAN_MODE"],
        message: "ClamAV media scanning requires CLAMAV_HOST and S3_ENDPOINT",
      });
    }
    if (config.TRACING_ENABLED && !config.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
      ctx.addIssue({
        code: "custom",
        path: ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"],
        message: "Required when distributed tracing is enabled",
      });
    }
    if (
      config.TRACING_ENABLED &&
      config.OPENROUND_DEPLOYMENT_ENVIRONMENT !== "development" &&
      config.OPENROUND_DEPLOYMENT_ENVIRONMENT &&
      config.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    ) {
      const endpoint = new URL(config.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
      if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        ctx.addIssue({
          code: "custom",
          path: ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"],
          message:
            "Hosted distributed tracing endpoint must not contain credentials, a query, or a fragment",
        });
      }
      if (isUnusableHostedTracingHostname(endpoint.hostname)) {
        ctx.addIssue({
          code: "custom",
          path: ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"],
          message:
            "Hosted distributed tracing endpoint must not use a reserved, placeholder, loopback, or unspecified address",
        });
      }
    }
  });

export type AppConfig = z.infer<typeof ConfigSchema>;

function embeddedBuildId() {
  try {
    const value = readFileSync(new URL("../BUILD_ID", import.meta.url), "utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const buildId = embeddedBuildId();
  return ConfigSchema.parse(
    buildId ? { ...environment, OPENROUND_BUILD_ID: buildId } : environment,
  );
}
