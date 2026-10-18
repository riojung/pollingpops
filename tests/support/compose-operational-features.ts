import { execFile } from "node:child_process";
import { promisify } from "node:util";

type OperationalFeatureFlags = {
  signups: boolean;
  sessionCreation: boolean;
  mediaUploads: boolean;
  roundExperiences: boolean;
  audiencePulse: boolean;
  roomChat: boolean;
};

type OperationalFeatureView = {
  configured: OperationalFeatureFlags;
  runtime: OperationalFeatureFlags;
  effective: OperationalFeatureFlags;
};

type RunCommand = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

const runFile = promisify(execFile);
const requestScript = `
const token = process.env.ADMIN_TOKEN;
if (!token) throw new Error("The server container must configure ADMIN_TOKEN for operational smoke checks");
const method = process.argv[1];
const body = process.argv[2];
const response = await fetch(
  "http://127.0.0.1:" + (process.env.PORT ?? "4000") + "/v1/admin/features",
  {
    method,
    headers: {
      authorization: "Bearer " + token,
      ...(method === "PATCH" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "PATCH" ? { body } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  },
);
if (!response.ok) {
  throw new Error(method + " private /v1/admin/features returned " + response.status + ": " + await response.text());
}
process.stdout.write(await response.text());
`;

export async function composeOperationalFeatures(
  features?: Partial<OperationalFeatureFlags>,
  run: RunCommand = runFile,
): Promise<OperationalFeatureView> {
  // Operator routes are intentionally blocked by Caddy. Keep their token and requests inside
  // the server container rather than publishing an administrative port for the smoke test.
  const { stdout } = await run(
    "docker",
    [
      "compose",
      "-f",
      "compose.yaml",
      "-f",
      "compose.media.yaml",
      "exec",
      "-T",
      "server",
      "node",
      "--input-type=module",
      "--eval",
      requestScript,
      features ? "PATCH" : "GET",
      JSON.stringify(features ?? null),
    ],
    { timeout: 15_000, maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout) as OperationalFeatureView;
}
