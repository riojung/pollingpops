import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import {
  composeArgv,
  composeBuildArgv,
  DEV_COMPOSE_PROFILES,
  validateDeployConfig,
} from "../../scripts/ops/lib.mjs";

const root = resolve(import.meta.dirname, "../..");

async function composeFile(name: string) {
  return parseDocument(await readFile(join(root, name), "utf8")).toJS();
}

describe("default local management console", () => {
  it.each(["core", "media", "observability"])(
    "starts and rebuilds the control service with the %s profile",
    async (profile) => {
      const files = DEV_COMPOSE_PROFILES[profile];
      expect(files.slice(0, 3)).toEqual([
        "compose.yaml",
        "compose.business.yaml",
        "compose.local-control.yaml",
      ]);
      expect(composeBuildArgv(profile).slice(-4)).toEqual(["build", "server", "web", "control"]);
      for (const action of ["start", "restart"]) {
        expect(composeArgv(action, { profile })).toEqual(
          expect.arrayContaining(["compose.local-control.yaml", "--build", "--wait"]),
        );
      }
      const business = await composeFile("compose.business.yaml");
      expect(business.services.control.build).toEqual({
        context: ".",
        dockerfile: "apps/control/Dockerfile",
        args: { OPENROUND_BUILD_ID: "${OPENROUND_BUILD_ID:-unversioned}" },
      });
      expect(business.services.control.depends_on.server.condition).toBe("service_healthy");
      expect(business.services.control.healthcheck.test.join(" ")).toContain("/api/health/ready");
    },
  );

  it("uses standalone password authentication and restricted database access without a product identity", async () => {
    const local = await composeFile("compose.local-control.yaml");
    const env = local.services.control.environment;
    expect(env).toMatchObject({
      CONTROL_ENABLED: "true",
      CONTROL_AUTH_MODE: "password",
      CONTROL_LOCAL_DEVELOPMENT: "true",
      OPENROUND_DEPLOYMENT_ENVIRONMENT: "development",
      CONTROL_PUBLIC_ORIGIN: "${CONTROL_PUBLIC_ORIGIN:-http://localhost:3002}",
      CONTROL_PRODUCT_ORIGIN: "",
      OPERATOR_CREDENTIAL_KEY: "${OPERATOR_CREDENTIAL_KEY:-}",
      CONTROL_DATABASE_URL:
        "postgresql://openround_app:openround-app-local@postgres:5432/openround",
      OPERATOR_OIDC_MFA_POLICY_ENFORCED: "false",
      OPERATOR_BOOTSTRAP_IDENTITIES: "[]",
    });
    for (const key of [
      "OPERATOR_OIDC_ISSUER",
      "OPERATOR_OIDC_CLIENT_ID",
      "OPERATOR_OIDC_CLIENT_SECRET",
      "OPERATOR_OIDC_REQUIRED_AMR",
      "OPERATOR_OIDC_ALLOWED_ACR",
    ]) {
      expect(env[key], key).toBe("");
    }
    // The shared overlay already restricts ingress. Avoid newer YAML tags in default profiles.
    expect(local.services.control).not.toHaveProperty("ports");
    expect((await composeFile("compose.business.yaml")).services.control.ports).toEqual([
      "127.0.0.1:3002:3002",
    ]);
    const document = parseDocument(
      await readFile(join(root, "compose.local-control.yaml"), "utf8"),
    );
    expect(document.errors).toEqual([]);
    expect(document.warnings).toEqual([]);
    expect(local.services.server.environment).toMatchObject({
      CONTROL_ENABLED: "false",
      CONTROL_AUTH_MODE: "oidc",
      CONTROL_LOCAL_DEVELOPMENT: "false",
      OPENROUND_DEPLOYMENT_ENVIRONMENT: "development",
      CONTROL_PUBLIC_ORIGIN: "",
      CONTROL_PRODUCT_ORIGIN: "",
      LOCAL_ADMIN_EMAIL: "",
    });
    expect(env).not.toHaveProperty("LOCAL_ADMIN_EMAIL");
  });

  it("supplies the authenticator encryption key only to the standalone control process", async () => {
    const files = [
      "compose.yaml",
      "compose.business.yaml",
      "compose.local-control.yaml",
      "compose.single-vm.yaml",
      "compose.single-vm.business.yaml",
    ];
    for (const file of files) {
      const configuration = await composeFile(file);
      for (const [name, service] of Object.entries(configuration.services)) {
        const environment =
          (service as { environment?: Record<string, unknown> }).environment ?? {};
        if (name === "control") {
          expect(environment.OPERATOR_CREDENTIAL_KEY, file).toBe("${OPERATOR_CREDENTIAL_KEY:-}");
        } else {
          expect(environment, `${file}: ${name}`).not.toHaveProperty("OPERATOR_CREDENTIAL_KEY");
        }
      }
    }
  });

  it("preserves Community limits and disabled business billing defaults", async () => {
    const [base, business, local] = await Promise.all([
      composeFile("compose.yaml"),
      composeFile("compose.business.yaml"),
      composeFile("compose.local-control.yaml"),
    ]);
    const env = {
      ...base.services.server.environment,
      ...business.services.server.environment,
      ...local.services.server.environment,
    };
    expect(env).toMatchObject({
      COMMUNITY_MODE: "${COMMUNITY_MODE:-true}",
      MAX_SESSION_PARTICIPANTS: 100,
      MAX_PRACTICE_PERSONAL_LINKS: 100,
      BUSINESS_PLATFORM_ENABLED: "${BUSINESS_PLATFORM_ENABLED:-false}",
      BUSINESS_EVENT_CREDITS_ENABLED: "${BUSINESS_EVENT_CREDITS_ENABLED:-false}",
      BILLING_MODE: "${BILLING_MODE:-disabled}",
      BACKGROUND_JOBS_MODE: "separate",
    });
    expect(business.services.jobs.command).toEqual(["node", "dist/jobs.js"]);
    expect(local.services.jobs.depends_on.server.condition).toBe("service_healthy");
  });

  it("defaults hosted control to OIDC while allowing standalone password mode without product coupling", async () => {
    const hosted = await composeFile("compose.single-vm.business.yaml");
    expect(hosted.services.control.environment).toMatchObject({
      CONTROL_AUTH_MODE: "${CONTROL_AUTH_MODE:-oidc}",
      CONTROL_LOCAL_DEVELOPMENT: "false",
      OPENROUND_DEPLOYMENT_ENVIRONMENT:
        "${OPENROUND_DEPLOYMENT_ENVIRONMENT:?Set OPENROUND_DEPLOYMENT_ENVIRONMENT}",
      OPERATOR_OIDC_MFA_POLICY_ENFORCED: "true",
      CONTROL_PRODUCT_ORIGIN: "",
      OPERATOR_CREDENTIAL_KEY: "${OPERATOR_CREDENTIAL_KEY:-}",
      OPERATOR_OIDC_ISSUER: "${OPERATOR_OIDC_ISSUER:-}",
      OPERATOR_OIDC_CLIENT_ID: "${OPERATOR_OIDC_CLIENT_ID:-}",
      OPERATOR_OIDC_CLIENT_SECRET: "${OPERATOR_OIDC_CLIENT_SECRET:-}",
      OPERATOR_BOOTSTRAP_IDENTITIES: "${OPERATOR_BOOTSTRAP_IDENTITIES:-[]}",
    });
    expect(hosted.services.control).not.toHaveProperty("ports");
    expect(hosted.services.server.environment).toMatchObject({
      CONTROL_AUTH_MODE: "oidc",
      CONTROL_LOCAL_DEVELOPMENT: "false",
      LOCAL_ADMIN_EMAIL: "",
      CONTROL_PUBLIC_ORIGIN: "",
    });
  });

  it.each(["staging", "production"])(
    "rejects the local control overlay in a reviewed %s deployment",
    async (environment) => {
      const config = JSON.parse(
        await readFile(join(root, "config/deploy", `${environment}.json`), "utf8"),
      );
      config.singleVm.composeFiles.push("compose.local-control.yaml");
      expect(() => validateDeployConfig(config, environment)).toThrow(
        "hosted deployment must not use the local development control overlay",
      );
    },
  );
});
