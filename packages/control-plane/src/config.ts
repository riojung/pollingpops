import { z } from "zod";

const configuredList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
const optionalValue = z.preprocess(
  (value) => (typeof value === "string" && !value.trim() ? undefined : value),
  z.string().trim().min(1).optional(),
);
export function isLoopbackHttpOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    );
  } catch {
    return false;
  }
}
const bootstrapSchema = z
  .array(
    z
      .object({
        issuer: z.string().url(),
        subject: z.string().min(1).max(256),
        displayName: z.string().min(1).max(80),
        role: z.enum(["founder", "support", "billing", "operations"]),
      })
      .strict(),
  )
  .max(20);

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    CONTROL_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    CONTROL_AUTH_MODE: z.enum(["oidc", "local"]).default("oidc"),
    CONTROL_LOCAL_DEVELOPMENT: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    OPENROUND_DEPLOYMENT_ENVIRONMENT: z.preprocess(
      (value) => (typeof value === "string" && !value.trim() ? undefined : value),
      z.enum(["development", "staging", "production"]).optional(),
    ),
    CONTROL_PUBLIC_ORIGIN: optionalValue,
    CONTROL_PRODUCT_ORIGIN: optionalValue,
    CONTROL_DATABASE_URL: optionalValue,
    CONTROL_ALLOW_LOCAL_HTTP: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    OPERATOR_OIDC_ISSUER: optionalValue,
    OPERATOR_OIDC_CLIENT_ID: optionalValue,
    OPERATOR_OIDC_CLIENT_SECRET: optionalValue,
    OPERATOR_OIDC_MFA_POLICY_ENFORCED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    OPERATOR_OIDC_REQUIRED_AMR: configuredList,
    OPERATOR_OIDC_ALLOWED_ACR: configuredList,
    OPERATOR_BOOTSTRAP_IDENTITIES: z
      .string()
      .default("[]")
      .transform((value, context) => {
        try {
          return bootstrapSchema.parse(JSON.parse(value));
        } catch {
          context.addIssue({
            code: "custom",
            message: "Expected provisioned operator identities as JSON",
          });
          return z.NEVER;
        }
      }),
    INTEGRATION_SECRET_KEY: optionalValue,
  })
  .superRefine((config, context) => {
    if (config.CONTROL_AUTH_MODE === "local") {
      if (!config.CONTROL_LOCAL_DEVELOPMENT)
        context.addIssue({
          code: "custom",
          path: ["CONTROL_LOCAL_DEVELOPMENT"],
          message: "Local operator authentication requires explicit local-development opt-in",
        });
      if (config.OPENROUND_DEPLOYMENT_ENVIRONMENT !== "development")
        context.addIssue({
          code: "custom",
          path: ["OPENROUND_DEPLOYMENT_ENVIRONMENT"],
          message: "Local operator authentication is unavailable in hosted deployments",
        });
      for (const field of ["CONTROL_PUBLIC_ORIGIN", "CONTROL_PRODUCT_ORIGIN"] as const) {
        if (field === "CONTROL_PRODUCT_ORIGIN" && !config[field]) continue;
        if (!isLoopbackHttpOrigin(config[field]))
          context.addIssue({
            code: "custom",
            path: [field],
            message: "Local operator authentication requires an exact loopback HTTP origin",
          });
      }
      if (
        isLoopbackHttpOrigin(config.CONTROL_PUBLIC_ORIGIN) &&
        isLoopbackHttpOrigin(config.CONTROL_PRODUCT_ORIGIN)
      ) {
        const consoleUrl = new URL(config.CONTROL_PUBLIC_ORIGIN!);
        const productUrl = new URL(config.CONTROL_PRODUCT_ORIGIN!);
        if (consoleUrl.hostname !== productUrl.hostname || consoleUrl.origin === productUrl.origin)
          context.addIssue({
            code: "custom",
            path: ["CONTROL_PRODUCT_ORIGIN"],
            message: "Local product and console must share a loopback hostname on separate origins",
          });
      }
      if (config.CONTROL_ENABLED && !config.CONTROL_DATABASE_URL)
        context.addIssue({
          code: "custom",
          path: ["CONTROL_DATABASE_URL"],
          message: "Required when operator control is enabled",
        });
      return;
    }
    if (!config.CONTROL_ENABLED) return;
    if (config.CONTROL_PRODUCT_ORIGIN) {
      try {
        const url = new URL(config.CONTROL_PRODUCT_ORIGIN);
        const local =
          config.NODE_ENV !== "production" &&
          config.CONTROL_ALLOW_LOCAL_HTTP &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if (
          (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== "/"
        )
          throw new Error();
      } catch {
        context.addIssue({
          code: "custom",
          path: ["CONTROL_PRODUCT_ORIGIN"],
          message: "Expected an explicit HTTPS product origin without path or credentials",
        });
      }
    }
    for (const field of [
      "CONTROL_PUBLIC_ORIGIN",
      "CONTROL_DATABASE_URL",
      "OPERATOR_OIDC_ISSUER",
      "OPERATOR_OIDC_CLIENT_ID",
      "OPERATOR_OIDC_CLIENT_SECRET",
    ] as const) {
      if (!config[field])
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Required when operator control is enabled",
        });
    }
    for (const field of ["CONTROL_PUBLIC_ORIGIN", "OPERATOR_OIDC_ISSUER"] as const) {
      if (!config[field]) continue;
      try {
        const url = new URL(config[field]);
        const local =
          config.NODE_ENV !== "production" &&
          config.CONTROL_ALLOW_LOCAL_HTTP &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if (
          (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error();
        if (field === "CONTROL_PUBLIC_ORIGIN" && url.pathname !== "/") throw new Error();
      } catch {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Expected an explicit HTTPS URL without credentials, query, or fragment",
        });
      }
    }
    if (!config.OPERATOR_OIDC_MFA_POLICY_ENFORCED)
      context.addIssue({
        code: "custom",
        path: ["OPERATOR_OIDC_MFA_POLICY_ENFORCED"],
        message: "The dedicated provider application must enforce MFA",
      });
    if (
      config.OPERATOR_OIDC_REQUIRED_AMR.length === 0 &&
      config.OPERATOR_OIDC_ALLOWED_ACR.length === 0
    )
      context.addIssue({
        code: "custom",
        path: ["OPERATOR_OIDC_REQUIRED_AMR"],
        message: "Configure exact provider MFA assurance claims",
      });
    for (const identity of config.OPERATOR_BOOTSTRAP_IDENTITIES)
      if (identity.issuer !== config.OPERATOR_OIDC_ISSUER)
        context.addIssue({
          code: "custom",
          path: ["OPERATOR_BOOTSTRAP_IDENTITIES"],
          message: "Bootstrap issuer must match the dedicated operator issuer",
        });
  });

export type ControlConfig = z.infer<typeof configSchema>;
export function isLocalControlDevelopment(config: ControlConfig): boolean {
  if (
    !config.CONTROL_ENABLED ||
    config.CONTROL_AUTH_MODE !== "local" ||
    !config.CONTROL_LOCAL_DEVELOPMENT ||
    config.OPENROUND_DEPLOYMENT_ENVIRONMENT !== "development" ||
    !isLoopbackHttpOrigin(config.CONTROL_PUBLIC_ORIGIN) ||
    (config.CONTROL_PRODUCT_ORIGIN && !isLoopbackHttpOrigin(config.CONTROL_PRODUCT_ORIGIN))
  )
    return false;
  if (!config.CONTROL_PRODUCT_ORIGIN) return true;
  const consoleUrl = new URL(config.CONTROL_PUBLIC_ORIGIN!);
  const productUrl = new URL(config.CONTROL_PRODUCT_ORIGIN);
  return consoleUrl.hostname === productUrl.hostname && consoleUrl.origin !== productUrl.origin;
}
export function loadControlConfig(
  environment: Record<string, string | undefined> = process.env,
): ControlConfig {
  const parsed = configSchema.parse(environment);
  return {
    ...parsed,
    ...(parsed.CONTROL_ENABLED && parsed.CONTROL_PUBLIC_ORIGIN
      ? { CONTROL_PUBLIC_ORIGIN: new URL(parsed.CONTROL_PUBLIC_ORIGIN).origin }
      : {}),
    ...(parsed.CONTROL_ENABLED && parsed.CONTROL_PRODUCT_ORIGIN
      ? { CONTROL_PRODUCT_ORIGIN: new URL(parsed.CONTROL_PRODUCT_ORIGIN).origin }
      : {}),
  };
}
