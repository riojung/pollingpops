import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AWS_PRODUCTION_TEMPLATE,
  awsProductionArguments,
  awsProductionEnvironment,
  provisionAwsProduction,
  validateAwsProductionConfig,
  validateAwsProductionStack,
  validateAwsRuntimeTarget,
  verifyAwsDeploymentTarget,
  verifyAwsProduction,
} from "../../scripts/ops/aws-production.mjs";
import {
  AWS_MEDIA_HEALTH_CHECK,
  REMOTE_AWS_MEDIA_HEALTH_SCRIPT,
  REMOTE_DEPLOY_SCRIPT,
  readSingleVmRuntimeEnvironment,
  validateSingleVmRuntimeValues,
  waitForMediaHealth,
} from "../../scripts/ops/deploy.mjs";
import { ensureIgnoredEnvFile, validateEnvFileKeys } from "../../scripts/ops/lib.mjs";

const template = JSON.parse(await readFile(resolve(AWS_PRODUCTION_TEMPLATE), "utf8"));
const baseConfig = JSON.parse(await readFile(resolve("infra/aws/production.example.json"), "utf8"));
const checkedProduction = JSON.parse(
  await readFile(resolve("config/deploy/production.json"), "utf8"),
);

function config() {
  const value = structuredClone(baseConfig);
  value.parameters.AppDomain = "app.pollingpops.ca";
  return value;
}

function stack(value = config()) {
  const outputs = {
    AccountId: value.accountId,
    Region: value.region,
    PublicIp: "35.182.100.10",
    InstanceId: "i-0123456789abcdef0",
    MediaBucket: value.parameters.MediaBucketName,
    S3Endpoint: `https://s3.${value.region}.amazonaws.com`,
    ApplicationUrl: `https://${value.parameters.AppDomain}`,
    DeploymentUser: "openround",
    DeploymentPath: "/opt/pollingpops/production",
    ApplicationProfileArn: `arn:aws:iam::${value.accountId}:instance-profile/production-profile`,
    SecurityGroupId: "sg-0123456789abcdef0",
  };
  return {
    StackId: `arn:aws:cloudformation:${value.region}:${value.accountId}:stack/${value.stackName}/1234`,
    StackStatus: "CREATE_COMPLETE",
    Parameters: Object.entries(value.parameters).map(([ParameterKey, ParameterValue]) => ({
      ParameterKey,
      ParameterValue: String(ParameterValue),
    })),
    Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({
      OutputKey,
      OutputValue,
    })),
  };
}

function deployment(value = config()) {
  const target = structuredClone(checkedProduction);
  target.publicWebUrl = `https://${value.parameters.AppDomain}`;
  target.publicApiUrl = target.publicWebUrl;
  target.publicMediaUrl = `https://s3.${value.region}.amazonaws.com`;
  target.singleVm.host = "35.182.100.10";
  target.singleVm.composeFiles.push("compose.aws-production.yaml");
  target.singleVm.deploymentFiles.push("infra/aws/Caddyfile");
  return target;
}

function runtime(value = config()) {
  return (
    Object.entries({
      OPENROUND_DEPLOYMENT_ENVIRONMENT: "production",
      OPENROUND_APP_DOMAIN: value.parameters.AppDomain,
      OPENROUND_MEDIA_DOMAIN: `s3.${value.region}.amazonaws.com`,
      OPENROUND_ACME_EMAIL: "ops@pollingpops.ca",
      POSTGRES_OWNER_PASSWORD: "owner-secret",
      POSTGRES_APP_PASSWORD: "application-secret",
      DATABASE_URL: "postgresql://openround_app:secret@postgres:5432/openround",
      VALKEY_PASSWORD: "coordination-secret",
      REDIS_URL: "redis://:secret@valkey:6379",
      S3_ENDPOINT: `https://s3.${value.region}.amazonaws.com`,
      S3_PUBLIC_ENDPOINT: `https://s3.${value.region}.amazonaws.com`,
      S3_BUCKET: value.parameters.MediaBucketName,
      S3_REGION: value.region,
      S3_FORCE_PATH_STYLE: "false",
      SMTP_URL: "smtps://secret@smtp.pollingpops.ca:465",
      EMAIL_FROM: "Polling Pops <noreply@pollingpops.ca>",
      METRICS_ENABLED: "true",
      METRICS_TOKEN: "synthetic-test-token",
      OPENROUND_LOG_SHIPPING_MODE: "external-host-agent",
      TRACING_ENABLED: "true",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://otel-collector:4318/v1/traces",
      OPENROUND_OTLP_BACKEND_ENDPOINT: "https://telemetry.pollingpops.ca",
      OPENROUND_OTLP_BACKEND_TOKEN: "synthetic-backend-token",
      OPENROUND_PAGING_WEBHOOK_URL: "https://alerts.pollingpops.ca/page",
      OPENROUND_WARNING_WEBHOOK_URL: "https://alerts.pollingpops.ca/warning",
      OPENROUND_TICKET_WEBHOOK_URL: "https://alerts.pollingpops.ca/ticket",
      ADMIN_TOKEN: "synthetic-administration-token",
      BILLING_MODE: "stripe",
      COMMUNITY_MODE: "false",
    })
      .map(([key, entry]) => `${key}=${entry}`)
      .join("\n") + "\n"
  );
}

function verificationRunner(value = config()) {
  const outputs = validateAwsProductionStack(stack(value), value);
  const responses: Record<string, unknown> = {
    "sts get-caller-identity": {
      Account: value.accountId,
      Arn: `arn:aws:iam::${value.accountId}:user/operator`,
    },
    "cloudformation describe-stacks": { Stacks: [stack(value)] },
    "cloudformation get-template": { TemplateBody: template },
    "ec2 describe-instances": {
      Reservations: [
        {
          Instances: [
            {
              State: { Name: "running" },
              PublicIpAddress: outputs.PublicIp,
              VpcId: value.parameters.VpcId,
              SubnetId: value.parameters.SubnetId,
              KeyName: value.parameters.KeyPairName,
              InstanceType: value.parameters.InstanceType,
              MetadataOptions: { HttpTokens: "required", HttpPutResponseHopLimit: 2 },
              IamInstanceProfile: { Arn: outputs.ApplicationProfileArn },
              SecurityGroups: [{ GroupId: outputs.SecurityGroupId }],
              RootDeviceName: "/dev/xvda",
              BlockDeviceMappings: [
                {
                  DeviceName: "/dev/xvda",
                  Ebs: { VolumeId: "vol-0123456789abcdef0", DeleteOnTermination: false },
                },
              ],
            },
          ],
        },
      ],
    },
    "ec2 describe-security-groups": {
      SecurityGroups: [
        {
          OwnerId: value.accountId,
          VpcId: value.parameters.VpcId,
          IpPermissions: [
            {
              IpProtocol: "tcp",
              FromPort: 22,
              ToPort: 22,
              IpRanges: [{ CidrIp: value.parameters.SshIngressCidr }],
            },
            ...["tcp:80", "tcp:443", "udp:443"].map((entry) => {
              const [IpProtocol, port] = entry.split(":");
              return {
                IpProtocol,
                FromPort: Number(port),
                ToPort: Number(port),
                IpRanges: [{ CidrIp: "0.0.0.0/0" }],
              };
            }),
          ],
        },
      ],
    },
    "ec2 describe-volumes": { Volumes: [{ Encrypted: true, Size: 100 }] },
    "s3api get-bucket-versioning": { Status: "Enabled" },
    "s3api get-public-access-block": {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    },
    "s3api get-bucket-encryption": {
      ServerSideEncryptionConfiguration: {
        Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
      },
    },
    "s3api get-bucket-location": { LocationConstraint: value.region },
    "ec2 describe-subnets": { Subnets: [{ VpcId: value.parameters.VpcId }] },
  };
  const runner = vi.fn(async (args: string[]) => ({
    stdout: JSON.stringify(responses[args.slice(0, 2).join(" ")] ?? {}),
  }));
  return { runner, responses };
}

describe("AWS production foundation", () => {
  it("requires explicit production identity and restricts network and parameter inputs", () => {
    expect(validateAwsProductionConfig(config())).toEqual(config());
    for (const change of [
      { environment: "staging" },
      { endpoint: "http://localhost:4566" },
      { parameters: { ...config().parameters, SshIngressCidr: "0.0.0.0/0" } },
      { parameters: { ...config().parameters, AppDomain: "app.example.com" } },
      { parameters: { ...config().parameters, ImageId: "ami-unreviewed" } },
      { parameters: { ...config().parameters, DataVolumeGiB: "20" } },
    ])
      expect(() => validateAwsProductionConfig({ ...config(), ...change })).toThrow();
  });

  it("rejects emulator endpoint overrides and ignores configured AWS endpoint URLs", () => {
    for (const key of [
      "AWS_ENDPOINT_URL",
      "AWS_ENDPOINT_URL_STS",
      "AWS_ENDPOINT_URL_S3",
      "AWS_EC2_METADATA_SERVICE_ENDPOINT",
    ]) {
      expect(() => awsProductionEnvironment({ [key]: "http://localhost:4566" })).toThrow(
        /endpoint override/,
      );
    }
    expect(awsProductionEnvironment({ AWS_PROFILE: "real-production" })).toMatchObject({
      AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
      AWS_PROFILE: "real-production",
    });
    const args = awsProductionArguments(config(), ["sts", "get-caller-identity"]);
    expect(args).toContain("--no-cli-pager");
    expect(args).toContain("ca-central-1");
    expect(args).not.toContain("--endpoint-url");
  });

  it("does not provision without an exact confirmation and real account match", async () => {
    const { runner, responses } = verificationRunner();
    await expect(
      provisionAwsProduction(config(), "yes", { runner, environment: {} }),
    ).rejects.toThrow(/confirm/);
    expect(runner).not.toHaveBeenCalled();
    responses["sts get-caller-identity"] = {
      Account: "999999999999",
      Arn: "arn:aws:iam::999999999999:user/wrong",
    };
    await expect(
      provisionAwsProduction(config(), `${config().accountId}:${config().stackName}`, {
        runner,
        environment: {},
      }),
    ).rejects.toThrow(/account/);
    expect(runner.mock.calls).toHaveLength(1);
  });

  it("creates a new stack only and verifies the live foundation without deploying the app", async () => {
    const { runner } = verificationRunner();
    const outputs = await provisionAwsProduction(
      config(),
      `${config().accountId}:${config().stackName}`,
      { runner, environment: {}, deployment: deployment() },
    );
    expect(outputs.MediaBucket).toBe(config().parameters.MediaBucketName);
    const operations = runner.mock.calls.map(([args]) => args.slice(0, 2).join(" "));
    expect(operations.indexOf("sts get-caller-identity")).toBeLessThan(
      operations.indexOf("cloudformation create-stack"),
    );
    expect(operations.filter((operation) => operation.includes("create-stack"))).toHaveLength(1);
    expect(
      operations.some((operation) =>
        /update-stack|delete-stack|execute-change-set|deploy/.test(operation),
      ),
    ).toBe(false);
    expect(
      runner.mock.calls.every(
        ([, options]) => options.env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS === "true",
      ),
    ).toBe(true);
  });

  it("rejects stack identity, resource security, and production target drift", async () => {
    const wrongStack = stack();
    wrongStack.StackId = wrongStack.StackId.replace("123456789012", "999999999999");
    expect(() => validateAwsProductionStack(wrongStack, config())).toThrow(/identity/);
    const { runner, responses } = verificationRunner();
    responses["ec2 describe-volumes"] = { Volumes: [{ Encrypted: false, Size: 100 }] };
    await expect(verifyAwsProduction(config(), { runner, environment: {} })).rejects.toThrow(
      /encryption/,
    );
    const outputs = validateAwsProductionStack(stack(), config());
    const wrongTarget = deployment();
    wrongTarget.singleVm.host = "35.182.100.11";
    await expect(verifyAwsDeploymentTarget(config(), outputs, wrongTarget)).rejects.toThrow(
      /Elastic IP/,
    );
    const unreviewedOverlay = deployment();
    unreviewedOverlay.singleVm.composeFiles.pop();
    await expect(verifyAwsDeploymentTarget(config(), outputs, unreviewedOverlay)).rejects.toThrow(
      /target/,
    );
  });

  it("keeps private versioned media and least-privilege instance credentials in the template", () => {
    const bucket = template.Resources.MediaBucket;
    expect(bucket.DeletionPolicy).toBe("Retain");
    expect(bucket.Properties.VersioningConfiguration.Status).toBe("Enabled");
    expect(Object.values(bucket.Properties.PublicAccessBlockConfiguration).every(Boolean)).toBe(
      true,
    );
    expect(bucket.Properties.CorsConfiguration.CorsRules[0].AllowedOrigins).toEqual([
      { "Fn::Sub": "https://${AppDomain}" },
    ]);
    const instance = template.Resources.AppInstance.Properties;
    expect(instance.MetadataOptions).toMatchObject({
      HttpTokens: "required",
      HttpPutResponseHopLimit: 2,
    });
    expect(instance.BlockDeviceMappings[0].Ebs).toMatchObject({
      Encrypted: true,
      DeleteOnTermination: false,
    });
    const statements =
      template.Resources.ApplicationRole.Properties.Policies[0].PolicyDocument.Statement;
    expect(statements.flatMap((entry: { Action: string[] }) => entry.Action)).not.toContain("s3:*");
    expect(JSON.stringify(statements)).not.toContain('"Resource":"*"');
  });
});

describe("AWS storage in signed single-VM deployments", () => {
  async function withRuntimeFile(content: string, check: (path: string) => Promise<void>) {
    await mkdir(resolve("artifacts"), { recursive: true });
    const directory = await mkdtemp(resolve("artifacts", "aws-runtime-preflight-"));
    const path = resolve(directory, "production.runtime.env");
    try {
      await writeFile(path, content, { mode: 0o600 });
      await check(path);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it("accepts an S3-only private runtime through the deployment's file preflight", async () => {
    await withRuntimeFile(runtime(), async (path) => {
      const file = await readSingleVmRuntimeEnvironment(path, deployment());
      await ensureIgnoredEnvFile(file, resolve("."), "runtime");
      expect(file.keys).toContain("S3_BUCKET");
      expect(file.keys.some((key: string) => key.startsWith("MINIO_"))).toBe(false);
      expect(validateSingleVmRuntimeValues(file.content, deployment())).toBe(true);
      expect(validateAwsRuntimeTarget(file.content, config())).toBe(true);
      // The same file cannot select AWS validation for an ordinary MinIO target.
      const minioTarget = deployment();
      minioTarget.singleVm.composeFiles.pop();
      await expect(readSingleVmRuntimeEnvironment(path, minioTarget)).rejects.toThrow(
        "requires MINIO_ROOT_USER",
      );
      await chmod(path, 0o644);
      await expect(readSingleVmRuntimeEnvironment(path, deployment())).rejects.toThrow(
        "must have mode 0600",
      );
    });
  });

  it.each([
    "S3_ENDPOINT",
    "S3_PUBLIC_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "DATABASE_URL",
    "SMTP_URL",
  ])("requires %s in AWS runtime files before value validation", async (key) => {
    await withRuntimeFile(runtime().replace(new RegExp(`^${key}=.*\\n`, "m"), ""), async (path) => {
      await expect(readSingleVmRuntimeEnvironment(path, deployment())).rejects.toThrow(
        `requires ${key}`,
      );
    });
  });

  it.each([
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "MINIO_APP_ACCESS_KEY",
    "MINIO_APP_SECRET_KEY",
  ])("retains the legacy %s key requirement", (key) => {
    const minio = `${runtime()}MINIO_ROOT_USER=synthetic\nMINIO_ROOT_PASSWORD=synthetic\nMINIO_APP_ACCESS_KEY=synthetic\nMINIO_APP_SECRET_KEY=synthetic\n`;
    expect(validateEnvFileKeys(minio, "single-vm-runtime")).toContain(key);
    expect(() =>
      validateEnvFileKeys(minio.replace(new RegExp(`^${key}=.*\\n`, "m"), ""), "single-vm-runtime"),
    ).toThrow(`requires ${key}`);
  });

  it.each([
    "NODE_OPTIONS=--require=/tmp/unreviewed.js",
    "DATABASE_MIGRATION_URL=postgresql://synthetic-owner",
    "S3_BUCKET=duplicate",
  ])("retains forbidden and duplicate key checks for AWS files: %s", async (line) => {
    await withRuntimeFile(`${runtime()}${line}\n`, async (path) => {
      await expect(readSingleVmRuntimeEnvironment(path, deployment())).rejects.toThrow(
        /must not contain|duplicate/,
      );
    });
  });

  it("rejects an unknown storage provider instead of skipping storage requirements", () => {
    expect(() => validateEnvFileKeys(runtime(), "single-vm-runtime", { storage: "other" })).toThrow(
      /storage must be/,
    );
  });

  it("binds runtime storage to the reviewed AWS bucket and region before activation", () => {
    expect(validateAwsRuntimeTarget(runtime(), config())).toBe(true);
    expect(
      validateAwsRuntimeTarget(runtime().replace("S3_BUCKET=", "S3_BUCKET = "), config()),
    ).toBe(true);
    expect(() =>
      validateAwsRuntimeTarget(
        runtime().replace(config().parameters.MediaBucketName, "another-private-bucket"),
        config(),
      ),
    ).toThrow(/S3_BUCKET.*reviewed/);
    expect(() =>
      validateAwsRuntimeTarget(
        runtime().replace("S3_REGION=ca-central-1", "S3_REGION=us-east-1"),
        config(),
      ),
    ).toThrow(/S3_REGION.*reviewed/);
    expect(() => validateAwsRuntimeTarget(`${runtime()}S3_BUCKET=other\n`, config())).toThrow(
      /Duplicate/,
    );
    expect(() =>
      validateAwsRuntimeTarget(runtime().replace(/^S3_BUCKET=.*\n/m, ""), config()),
    ).toThrow(/S3_BUCKET/);
  });

  it("accepts regional role credentials while retaining all hosted operational requirements", () => {
    expect(validateSingleVmRuntimeValues(runtime(), deployment())).toBe(true);
    expect(() =>
      validateSingleVmRuntimeValues(`${runtime()}S3_ACCESS_KEY_ID=static\n`, deployment()),
    ).toThrow(/instance-profile/);
    expect(() =>
      validateSingleVmRuntimeValues(
        runtime().replaceAll("https://s3.ca-central-1.amazonaws.com", "http://localhost:4566"),
        deployment(),
      ),
    ).toThrow(/regional HTTPS/);
    expect(() =>
      validateSingleVmRuntimeValues(
        runtime().replace("COMMUNITY_MODE=false", "COMMUNITY_MODE=true"),
        deployment(),
      ),
    ).toThrow(/COMMUNITY_MODE/);
    expect(() =>
      validateSingleVmRuntimeValues(
        runtime().replace("S3_FORCE_PATH_STYLE=false", "S3_FORCE_PATH_STYLE=true"),
        deployment(),
      ),
    ).toThrow(/S3_FORCE_PATH_STYLE/);
  });

  it("uses the active release's server role to probe S3 rather than an unauthenticated public URL", async () => {
    await expect(waitForMediaHealth(deployment())).rejects.toThrow(/pinned SSH target/);
    expect(REMOTE_AWS_MEDIA_HEALTH_SCRIPT).toContain('"releases/$build"');
    expect(REMOTE_AWS_MEDIA_HEALTH_SCRIPT).toContain("exec -T server node");
    expect(AWS_MEDIA_HEALTH_CHECK).toContain("HeadBucketCommand");
    expect(AWS_MEDIA_HEALTH_CHECK).toContain("AbortSignal.timeout");
    expect(REMOTE_DEPLOY_SCRIPT).toContain("up --detach --wait postgres valkey clamav");
    expect(REMOTE_DEPLOY_SCRIPT).toContain("up --detach --wait postgres valkey minio clamav");
  });
});
