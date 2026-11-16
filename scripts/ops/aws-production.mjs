#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import {
  assertConfiguredHostedTarget,
  isPlaceholderHostedHostname,
  parseCliArguments,
  validateDeployConfig,
} from "./lib.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const AWS_PRODUCTION_TEMPLATE = "infra/aws/production.template.json";
export const AWS_PRODUCTION_OVERLAY = "compose.aws-production.yaml";
const execute = promisify(execFile);
const parameterNames = [
  "VpcId",
  "SubnetId",
  "KeyPairName",
  "SshIngressCidr",
  "AppDomain",
  "MediaBucketName",
  "InstanceType",
  "DataVolumeGiB",
];

function exactKeys(value, required, optional = [], label = "AWS production config") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error(`${label} contains missing or unexpected fields`);
  }
}

export function validateAwsProductionConfig(value) {
  exactKeys(
    value,
    ["schemaVersion", "environment", "accountId", "region", "stackName", "parameters"],
    ["profile"],
  );
  if (value.schemaVersion !== 1 || value.environment !== "production") {
    throw new Error("AWS foundation requires schemaVersion 1 and environment production");
  }
  if (!/^[0-9]{12}$/.test(value.accountId)) throw new Error("accountId must contain 12 digits");
  if (
    !/^(?:us|ca|eu|ap|sa|me|af|il|mx)-(?:central|east|north|northeast|northwest|south|southeast|southwest|west)-[1-9]$/.test(
      value.region,
    )
  ) {
    throw new Error("region must be a commercial AWS region");
  }
  if (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(value.stackName)) {
    throw new Error("stackName must be a valid CloudFormation stack name");
  }
  if (value.profile !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value.profile)) {
    throw new Error("profile must be a plain AWS profile name");
  }
  exactKeys(value.parameters, parameterNames, [], "AWS production parameters");
  const p = value.parameters;
  if (!/^vpc-(?:[a-f0-9]{8}|[a-f0-9]{17})$/.test(p.VpcId)) throw new Error("Invalid VpcId");
  if (!/^subnet-(?:[a-f0-9]{8}|[a-f0-9]{17})$/.test(p.SubnetId))
    throw new Error("Invalid SubnetId");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/.test(p.KeyPairName))
    throw new Error("Invalid KeyPairName");
  const sshAddress = typeof p.SshIngressCidr === "string" ? p.SshIngressCidr.split("/") : [];
  if (
    sshAddress.length !== 2 ||
    sshAddress[1] !== "32" ||
    isIP(sshAddress[0]) !== 4 ||
    sshAddress[0] === "0.0.0.0"
  ) {
    throw new Error("SshIngressCidr must restrict SSH to one operator/VPN IPv4 address (/32)");
  }
  if (
    typeof p.AppDomain !== "string" ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(p.AppDomain) ||
    isPlaceholderHostedHostname(p.AppDomain)
  ) {
    throw new Error("AppDomain must be a configured public DNS hostname");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(p.MediaBucketName))
    throw new Error("Invalid MediaBucketName");
  if (
    !["t3.xlarge", "m5.xlarge", "m6i.xlarge", "m7i.xlarge", "c6i.xlarge"].includes(p.InstanceType)
  ) {
    throw new Error("InstanceType must be a supported x86_64 instance with at least 4 vCPUs");
  }
  if (
    !/^[0-9]+$/.test(String(p.DataVolumeGiB)) ||
    Number(p.DataVolumeGiB) < 100 ||
    Number(p.DataVolumeGiB) > 2000
  ) {
    throw new Error("DataVolumeGiB must be an integer from 100 through 2000");
  }
  return value;
}

export function awsProductionEnvironment(environment = process.env) {
  for (const [key, value] of Object.entries(environment)) {
    if (
      value &&
      (/^AWS_ENDPOINT_URL(?:_|$)/.test(key) || key === "AWS_EC2_METADATA_SERVICE_ENDPOINT")
    ) {
      throw new Error(`Production AWS commands reject endpoint override ${key}`);
    }
  }
  return { ...environment, AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_PAGER: "" };
}

export function validateAwsRuntimeTarget(content, config) {
  validateAwsProductionConfig(config);
  const values = new Map();
  for (const source of String(content)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)) {
    const match = source.trim().match(/^(S3_BUCKET|S3_REGION)\s*=(.*)$/);
    if (!match) continue;
    if (values.has(match[1])) throw new Error(`Duplicate AWS runtime setting ${match[1]}`);
    values.set(match[1], match[2].trim());
  }
  if (values.get("S3_BUCKET") !== config.parameters.MediaBucketName) {
    throw new Error("Runtime S3_BUCKET must match the reviewed AWS production media bucket");
  }
  if (values.get("S3_REGION") !== config.region) {
    throw new Error("Runtime S3_REGION must match the reviewed AWS production region");
  }
  return true;
}

export function awsProductionArguments(config, arguments_) {
  return [
    ...arguments_,
    "--region",
    config.region,
    ...(config.profile ? ["--profile", config.profile] : []),
    "--output",
    "json",
    "--no-cli-pager",
  ];
}

async function defaultRunner(arguments_, options) {
  return execute("aws", arguments_, { env: options.env, maxBuffer: 2 * 1024 * 1024 });
}

export async function runAwsProductionCommand(
  config,
  arguments_,
  { runner = defaultRunner, environment = process.env } = {},
) {
  const result = await runner(awsProductionArguments(config, arguments_), {
    env: awsProductionEnvironment(environment),
  });
  const output = result.stdout?.trim();
  return output ? JSON.parse(output) : undefined;
}

export async function verifyAwsProductionAccount(config, options) {
  const identity = await runAwsProductionCommand(config, ["sts", "get-caller-identity"], options);
  if (
    identity?.Account !== config.accountId ||
    !String(identity.Arn ?? "").startsWith(`arn:aws:`)
  ) {
    throw new Error("Real AWS STS identity does not match the reviewed production account");
  }
  return identity;
}

export function validateAwsProductionStack(stack, config) {
  const prefix = `arn:aws:cloudformation:${config.region}:${config.accountId}:stack/${config.stackName}/`;
  if (
    !stack?.StackId?.startsWith(prefix) ||
    !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.StackStatus)
  ) {
    throw new Error("Production stack identity or completed status does not match");
  }
  const parameters = Object.fromEntries(
    (stack.Parameters ?? []).map((p) => [p.ParameterKey, p.ParameterValue]),
  );
  for (const name of parameterNames) {
    if (parameters[name] !== String(config.parameters[name])) {
      throw new Error(`Production stack parameter ${name} differs from reviewed configuration`);
    }
  }
  const outputs = Object.fromEntries(
    (stack.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]),
  );
  const expected = {
    AccountId: config.accountId,
    Region: config.region,
    MediaBucket: config.parameters.MediaBucketName,
    S3Endpoint: `https://s3.${config.region}.amazonaws.com`,
    ApplicationUrl: `https://${config.parameters.AppDomain}`,
    DeploymentUser: "openround",
    DeploymentPath: "/opt/pollingpops/production",
  };
  for (const [name, value] of Object.entries(expected)) {
    if (outputs[name] !== value)
      throw new Error(`Production stack output ${name} differs from reviewed configuration`);
  }
  if (
    isIP(outputs.PublicIp) !== 4 ||
    !/^i-(?:[a-f0-9]{8}|[a-f0-9]{17})$/.test(outputs.InstanceId ?? "")
  ) {
    throw new Error("Production stack is missing an EC2 instance or public IPv4 output");
  }
  if (
    !String(outputs.ApplicationProfileArn ?? "").startsWith(
      `arn:aws:iam::${config.accountId}:instance-profile/`,
    ) ||
    !/^sg-(?:[a-f0-9]{8}|[a-f0-9]{17})$/.test(outputs.SecurityGroupId ?? "")
  ) {
    throw new Error("Production stack is missing its application profile or security group");
  }
  return outputs;
}

export async function verifyAwsDeploymentTarget(
  config,
  outputs,
  deployment,
  { resolveHost = lookup } = {},
) {
  validateDeployConfig(deployment, "production");
  assertConfiguredHostedTarget(deployment);
  if (
    deployment.deploymentMode !== "single-vm" ||
    !deployment.singleVm.composeFiles.includes(AWS_PRODUCTION_OVERLAY) ||
    !deployment.singleVm.deploymentFiles.includes("infra/aws/Caddyfile") ||
    deployment.publicWebUrl !== outputs.ApplicationUrl ||
    deployment.publicMediaUrl !== outputs.S3Endpoint ||
    deployment.singleVm.user !== outputs.DeploymentUser ||
    deployment.singleVm.deployPath !== outputs.DeploymentPath
  ) {
    throw new Error("Signed deployment target does not match the verified AWS foundation");
  }
  const host = deployment.singleVm.host;
  const addresses = isIP(host) ? [{ address: host }] : await resolveHost(host, { all: true });
  if (!addresses.length || addresses.some((entry) => entry.address !== outputs.PublicIp)) {
    throw new Error("Reviewed SSH target does not resolve exclusively to the stack's Elastic IP");
  }
  return true;
}

export async function verifyAwsProduction(config, options = {}) {
  validateAwsProductionConfig(config);
  await verifyAwsProductionAccount(config, options);
  const result = await runAwsProductionCommand(
    config,
    ["cloudformation", "describe-stacks", "--stack-name", config.stackName],
    options,
  );
  if (result?.Stacks?.length !== 1)
    throw new Error("Expected exactly one production CloudFormation stack");
  const outputs = validateAwsProductionStack(result.Stacks[0], config);
  const source = JSON.parse(await readFile(resolve(root, AWS_PRODUCTION_TEMPLATE), "utf8"));
  const deployed = await runAwsProductionCommand(
    config,
    [
      "cloudformation",
      "get-template",
      "--stack-name",
      config.stackName,
      "--template-stage",
      "Original",
    ],
    options,
  );
  const deployedTemplate =
    typeof deployed?.TemplateBody === "string"
      ? JSON.parse(deployed.TemplateBody)
      : deployed?.TemplateBody;
  if (!isDeepStrictEqual(source, deployedTemplate))
    throw new Error("Deployed AWS template differs from this reviewed foundation template");
  const instances = await runAwsProductionCommand(
    config,
    ["ec2", "describe-instances", "--instance-ids", outputs.InstanceId],
    options,
  );
  const host = instances?.Reservations?.flatMap((reservation) => reservation.Instances ?? []);
  if (
    host?.length !== 1 ||
    host[0].State?.Name !== "running" ||
    host[0].PublicIpAddress !== outputs.PublicIp ||
    host[0].VpcId !== config.parameters.VpcId ||
    host[0].SubnetId !== config.parameters.SubnetId ||
    host[0].KeyName !== config.parameters.KeyPairName ||
    host[0].InstanceType !== config.parameters.InstanceType ||
    host[0].MetadataOptions?.HttpTokens !== "required" ||
    host[0].MetadataOptions?.HttpPutResponseHopLimit !== 2 ||
    host[0].IamInstanceProfile?.Arn !== outputs.ApplicationProfileArn ||
    host[0].SecurityGroups?.length !== 1 ||
    host[0].SecurityGroups[0].GroupId !== outputs.SecurityGroupId
  )
    throw new Error("Live EC2 instance identity, networking, profile, or IMDSv2 settings differ");
  const groups = await runAwsProductionCommand(
    config,
    ["ec2", "describe-security-groups", "--group-ids", outputs.SecurityGroupId],
    options,
  );
  const group = groups?.SecurityGroups?.[0];
  const rules = group?.IpPermissions?.flatMap((rule) => {
    if (rule.Ipv6Ranges?.length || rule.UserIdGroupPairs?.length || rule.PrefixListIds?.length)
      return ["unexpected-source"];
    return (rule.IpRanges ?? []).map(
      (source) => `${rule.IpProtocol}:${rule.FromPort}:${rule.ToPort}:${source.CidrIp}`,
    );
  }).sort();
  const expectedRules = [
    `tcp:22:22:${config.parameters.SshIngressCidr}`,
    "tcp:80:80:0.0.0.0/0",
    "tcp:443:443:0.0.0.0/0",
    "udp:443:443:0.0.0.0/0",
  ].sort();
  if (
    groups?.SecurityGroups?.length !== 1 ||
    group?.OwnerId !== config.accountId ||
    group?.VpcId !== config.parameters.VpcId ||
    !isDeepStrictEqual(rules, expectedRules)
  ) {
    throw new Error("Live production security group differs from HTTPS and restricted SSH rules");
  }
  const rootMapping = host[0].BlockDeviceMappings?.find(
    (mapping) => mapping.DeviceName === host[0].RootDeviceName,
  );
  if (!rootMapping?.Ebs?.VolumeId || rootMapping.Ebs.DeleteOnTermination !== false)
    throw new Error("Production root EBS volume must be retained");
  const volumes = await runAwsProductionCommand(
    config,
    ["ec2", "describe-volumes", "--volume-ids", rootMapping.Ebs.VolumeId],
    options,
  );
  if (
    volumes?.Volumes?.length !== 1 ||
    !volumes.Volumes[0].Encrypted ||
    volumes.Volumes[0].Size < Number(config.parameters.DataVolumeGiB)
  ) {
    throw new Error("Production EBS encryption or capacity differs");
  }
  const bucketArguments = [
    "--bucket",
    outputs.MediaBucket,
    "--expected-bucket-owner",
    config.accountId,
  ];
  const versioning = await runAwsProductionCommand(
    config,
    ["s3api", "get-bucket-versioning", ...bucketArguments],
    options,
  );
  const access = await runAwsProductionCommand(
    config,
    ["s3api", "get-public-access-block", ...bucketArguments],
    options,
  );
  if (
    versioning?.Status !== "Enabled" ||
    ["BlockPublicAcls", "BlockPublicPolicy", "IgnorePublicAcls", "RestrictPublicBuckets"].some(
      (key) => access?.PublicAccessBlockConfiguration?.[key] !== true,
    )
  ) {
    throw new Error("Production media bucket must be versioned and block all public access");
  }
  const encryption = await runAwsProductionCommand(
    config,
    ["s3api", "get-bucket-encryption", ...bucketArguments],
    options,
  );
  if (
    encryption?.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault
      ?.SSEAlgorithm !== "AES256"
  ) {
    throw new Error("Production media bucket encryption differs from the reviewed SSE-S3 setting");
  }
  const location = await runAwsProductionCommand(
    config,
    ["s3api", "get-bucket-location", ...bucketArguments],
    options,
  );
  if ((location?.LocationConstraint || "us-east-1") !== config.region)
    throw new Error("Production media bucket is in a different region");
  if (options.deployment)
    await verifyAwsDeploymentTarget(config, outputs, options.deployment, options);
  return outputs;
}

export async function provisionAwsProduction(config, confirmation, options = {}) {
  validateAwsProductionConfig(config);
  if (confirmation !== `${config.accountId}:${config.stackName}`) {
    throw new Error("Provisioning requires --confirm ACCOUNT_ID:STACK_NAME");
  }
  await verifyAwsProductionAccount(config, options);
  const template = `file://${resolve(root, AWS_PRODUCTION_TEMPLATE)}`;
  await runAwsProductionCommand(
    config,
    ["cloudformation", "validate-template", "--template-body", template],
    options,
  );
  const subnet = await runAwsProductionCommand(
    config,
    ["ec2", "describe-subnets", "--subnet-ids", config.parameters.SubnetId],
    options,
  );
  if (subnet?.Subnets?.length !== 1 || subnet.Subnets[0].VpcId !== config.parameters.VpcId) {
    throw new Error("Subnet does not belong to the reviewed production VPC");
  }
  // Creation only: existing stacks are never updated or replaced by this helper.
  await runAwsProductionCommand(
    config,
    [
      "cloudformation",
      "create-stack",
      "--stack-name",
      config.stackName,
      "--template-body",
      template,
      "--capabilities",
      "CAPABILITY_IAM",
      "--parameters",
      JSON.stringify(
        parameterNames.map((name) => ({
          ParameterKey: name,
          ParameterValue: String(config.parameters[name]),
        })),
      ),
      "--on-failure",
      "ROLLBACK",
      "--tags",
      "Key=Application,Value=pollingpops",
      "Key=Environment,Value=production",
    ],
    options,
  );
  await runAwsProductionCommand(
    config,
    ["cloudformation", "wait", "stack-create-complete", "--stack-name", config.stackName],
    options,
  );
  return verifyAwsProduction(config, options);
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCliArguments(argv, {
    valueOptions: ["config", "confirm", "deploy-config"],
    booleanOptions: ["help"],
  });
  if (parsed.flags.has("help")) {
    process.stdout.write(
      "Usage: node scripts/ops/aws-production.mjs <plan|provision|verify> --config PATH [--confirm ACCOUNT_ID:STACK_NAME] [--deploy-config config/deploy/production.json]\n",
    );
    return;
  }
  const [action] = parsed.positionals;
  if (
    parsed.positionals.length !== 1 ||
    !["plan", "provision", "verify"].includes(action) ||
    !parsed.values.has("config")
  )
    throw new Error("Expected plan, provision, or verify with --config PATH");
  const config = validateAwsProductionConfig(
    JSON.parse(await readFile(resolve(root, parsed.values.get("config")), "utf8")),
  );
  awsProductionEnvironment();
  if (action !== "provision" && parsed.values.has("confirm"))
    throw new Error("--confirm is valid only for provision");
  if (action === "plan") {
    const bytes = await readFile(resolve(root, AWS_PRODUCTION_TEMPLATE));
    process.stdout.write(
      `${JSON.stringify({ action: "plan", accountId: config.accountId, region: config.region, stackName: config.stackName, template: AWS_PRODUCTION_TEMPLATE, templateSha256: createHash("sha256").update(bytes).digest("hex"), parameters: config.parameters, confirmation: `${config.accountId}:${config.stackName}`, applicationDeployment: "existing signed single-VM deployment gates remain required", mutations: false }, null, 2)}\n`,
    );
    return;
  }
  const deploymentPath = parsed.values.get("deploy-config");
  if (
    deploymentPath &&
    resolve(root, deploymentPath) !== resolve(root, "config/deploy/production.json")
  )
    throw new Error("--deploy-config must be config/deploy/production.json");
  const options = deploymentPath
    ? { deployment: JSON.parse(await readFile(resolve(root, deploymentPath), "utf8")) }
    : {};
  const outputs =
    action === "provision"
      ? await provisionAwsProduction(config, parsed.values.get("confirm"), options)
      : await verifyAwsProduction(config, options);
  process.stdout.write(
    `${JSON.stringify({ action, accountId: config.accountId, region: config.region, stackName: config.stackName, outputs, applicationDeployed: false }, null, 2)}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`AWS production foundation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
