import { describe, expect, it } from "vitest";
import { loadControlConfig } from "../src/config.js";

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
