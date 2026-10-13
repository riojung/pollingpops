import { describe, expect, it } from "vitest";
import { isLocalControlDevelopment, loadControlConfig } from "../src/config.js";

const enabled = {
  CONTROL_ENABLED: "true",
  CONTROL_PUBLIC_ORIGIN: "https://control.example.org",
  CONTROL_DATABASE_URL: "postgresql://runtime@db/control",
  OPERATOR_OIDC_ISSUER: "https://identity.example.org",
  OPERATOR_OIDC_CLIENT_ID: "operator",
  OPERATOR_OIDC_CLIENT_SECRET: "secret",
  OPERATOR_OIDC_MFA_POLICY_ENFORCED: "true",
  OPERATOR_OIDC_REQUIRED_AMR: "mfa",
};

describe("trusted product navigation origin", () => {
  it("is optional and treats blank configuration as absent", () => {
    expect(loadControlConfig({}).CONTROL_PRODUCT_ORIGIN).toBeUndefined();
    expect(
      loadControlConfig({ CONTROL_PRODUCT_ORIGIN: "  " }).CONTROL_PRODUCT_ORIGIN,
    ).toBeUndefined();
    expect(
      loadControlConfig({ ...enabled, CONTROL_PRODUCT_ORIGIN: "https://pollingpops.example/" })
        .CONTROL_PRODUCT_ORIGIN,
    ).toBe("https://pollingpops.example");
  });
  it("allows enabled production control without optional discovery for an HTTP local product", () => {
    const environment = {
      ...enabled,
      NODE_ENV: "production",
      OPENROUND_PUBLIC_URL: "http://localhost:8080",
      CONTROL_PRODUCT_ORIGIN: "",
    };
    const config = loadControlConfig(environment);
    expect(config.CONTROL_ENABLED).toBe(true);
    expect(config.CONTROL_PUBLIC_ORIGIN).toBe(enabled.CONTROL_PUBLIC_ORIGIN);
    expect(config.CONTROL_PRODUCT_ORIGIN).toBeUndefined();
    expect(() =>
      loadControlConfig({
        ...environment,
        CONTROL_PRODUCT_ORIGIN: environment.OPENROUND_PUBLIC_URL,
      }),
    ).toThrow();
    expect(
      loadControlConfig({
        ...environment,
        CONTROL_PRODUCT_ORIGIN: "https://product.example.test",
      }).CONTROL_PRODUCT_ORIGIN,
    ).toBe("https://product.example.test");
  });
  it.each([
    "https://pollingpops.example/account",
    "https://user:secret@pollingpops.example",
    "https://pollingpops.example?key=secret",
    "https://pollingpops.example#fragment",
    "http://pollingpops.example",
    "*.pollingpops.example",
    "null",
  ])("rejects non-origin or insecure configuration %s when enabled", (origin) => {
    expect(() => loadControlConfig({ ...enabled, CONTROL_PRODUCT_ORIGIN: origin })).toThrow();
  });
  it("permits only explicitly enabled nonproduction loopback HTTP", () => {
    const environment = {
      ...enabled,
      CONTROL_PRODUCT_ORIGIN: "http://127.0.0.1:3000",
      CONTROL_ALLOW_LOCAL_HTTP: "true",
    };
    expect(loadControlConfig(environment).CONTROL_PRODUCT_ORIGIN).toBe(
      environment.CONTROL_PRODUCT_ORIGIN,
    );
    expect(() =>
      loadControlConfig({ ...environment, CONTROL_ALLOW_LOCAL_HTTP: "false" }),
    ).toThrow();
    expect(() => loadControlConfig({ ...environment, NODE_ENV: "production" })).toThrow();
    expect(() =>
      loadControlConfig({ ...environment, CONTROL_PRODUCT_ORIGIN: "http://192.168.1.2:3000" }),
    ).toThrow();
  });
  it("preserves disabled production startup with an unused local or invalid product origin", () => {
    for (const origin of ["http://localhost:8080", "not-an-origin"]) {
      const config = loadControlConfig({
        NODE_ENV: "production",
        CONTROL_ENABLED: "false",
        CONTROL_PRODUCT_ORIGIN: origin,
      });
      expect(config.CONTROL_ENABLED).toBe(false);
      expect(config.CONTROL_PRODUCT_ORIGIN).toBe(origin);
    }
  });
});

describe("explicit local operator development profile", () => {
  const local = {
    NODE_ENV: "production",
    CONTROL_ENABLED: "true",
    CONTROL_AUTH_MODE: "local",
    CONTROL_LOCAL_DEVELOPMENT: "true",
    OPENROUND_DEPLOYMENT_ENVIRONMENT: "development",
    CONTROL_PUBLIC_ORIGIN: "http://localhost:3002",
    CONTROL_PRODUCT_ORIGIN: "http://localhost:8080",
    CONTROL_DATABASE_URL: "postgresql://openround_app@postgres/openround",
  };
  it("defaults to managed authentication and accepts explicit local production-built applications without OIDC", () => {
    expect(loadControlConfig({}).CONTROL_AUTH_MODE).toBe("oidc");
    expect(loadControlConfig({}).CONTROL_LOCAL_DEVELOPMENT).toBe(false);
    const config = loadControlConfig({
      ...local,
      OPERATOR_OIDC_ISSUER: "",
      OPERATOR_OIDC_CLIENT_ID: "",
      OPERATOR_OIDC_CLIENT_SECRET: "",
      INTEGRATION_SECRET_KEY: "",
    });
    expect(isLocalControlDevelopment(config)).toBe(true);
    expect(config.OPERATOR_OIDC_MFA_POLICY_ENFORCED).toBe(false);
    expect(config.OPERATOR_OIDC_ISSUER).toBeUndefined();
    expect(
      isLocalControlDevelopment(loadControlConfig({ ...local, CONTROL_PRODUCT_ORIGIN: "" })),
    ).toBe(true);
  });
  it.each(["staging", "production"])(
    "rejects the local profile in a %s deployment",
    (deployment) => {
      expect(() =>
        loadControlConfig({ ...local, OPENROUND_DEPLOYMENT_ENVIRONMENT: deployment }),
      ).toThrow();
      const config = loadControlConfig(local);
      expect(
        isLocalControlDevelopment({
          ...config,
          OPENROUND_DEPLOYMENT_ENVIRONMENT: deployment as "staging",
        }),
      ).toBe(false);
    },
  );
  it("requires opt-in, console origin and runtime database independently of NODE_ENV", () => {
    expect(() => loadControlConfig({ ...local, CONTROL_LOCAL_DEVELOPMENT: "false" })).toThrow();
    expect(() => loadControlConfig({ ...local, CONTROL_LOCAL_DEVELOPMENT: undefined })).toThrow();
    expect(() => loadControlConfig({ ...local, CONTROL_PUBLIC_ORIGIN: "" })).toThrow();
    expect(() => loadControlConfig({ ...local, CONTROL_DATABASE_URL: "" })).toThrow();
    expect(isLocalControlDevelopment({ ...loadControlConfig(local), CONTROL_ENABLED: false })).toBe(
      false,
    );
  });
  it.each([
    "https://localhost:3002",
    "https://control.example.test",
    "http://192.168.1.2:3002",
    "http://control.example.test",
    "http://user:secret@localhost:3002",
    "http://localhost:3002/account",
    "http://localhost:3002?token=value",
    "http://localhost:3002#fragment",
  ])("rejects nonlocal or non-origin URL %s for console and discovery", (origin) => {
    expect(() => loadControlConfig({ ...local, CONTROL_PUBLIC_ORIGIN: origin })).toThrow();
    expect(() => loadControlConfig({ ...local, CONTROL_PRODUCT_ORIGIN: origin })).toThrow();
  });
  it("accepts exact IPv4/IPv6 loopback origins only with an explicit development marker", () => {
    const config = loadControlConfig({
      ...local,
      CONTROL_PUBLIC_ORIGIN: "http://127.0.0.1:3002/",
      CONTROL_PRODUCT_ORIGIN: "http://[::1]:8080/",
    });
    expect(config.CONTROL_PUBLIC_ORIGIN).toBe("http://127.0.0.1:3002");
    expect(config.CONTROL_PRODUCT_ORIGIN).toBe("http://[::1]:8080");
    expect(isLocalControlDevelopment(config)).toBe(true);
    expect(() => loadControlConfig({ ...local, OPENROUND_DEPLOYMENT_ENVIRONMENT: "" })).toThrow();
    expect(() =>
      loadControlConfig({ ...local, OPENROUND_DEPLOYMENT_ENVIRONMENT: undefined }),
    ).toThrow();
  });
  it("never lets the local flag waive managed production MFA or HTTPS", () => {
    expect(() =>
      loadControlConfig({
        ...enabled,
        NODE_ENV: "production",
        CONTROL_LOCAL_DEVELOPMENT: "true",
        OPERATOR_OIDC_MFA_POLICY_ENFORCED: "false",
      }),
    ).toThrow();
    expect(() =>
      loadControlConfig({
        ...enabled,
        NODE_ENV: "production",
        CONTROL_LOCAL_DEVELOPMENT: "true",
        CONTROL_PUBLIC_ORIGIN: local.CONTROL_PUBLIC_ORIGIN,
        CONTROL_ALLOW_LOCAL_HTTP: "true",
      }),
    ).toThrow();
    expect(
      isLocalControlDevelopment(
        loadControlConfig({
          ...enabled,
          NODE_ENV: "production",
          OPENROUND_DEPLOYMENT_ENVIRONMENT: "production",
        }),
      ),
    ).toBe(false);
  });
});
