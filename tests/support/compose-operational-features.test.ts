import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { composeOperationalFeatures } from "./compose-operational-features.js";

const runFile = promisify(execFile);
const token = "private-compose-test-operator-token";
type RunCommand = NonNullable<Parameters<typeof composeOperationalFeatures>[1]>;

async function withPrivateApi(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  exercise: (run: RunCommand) => Promise<void>,
  configuredToken: string | undefined = token,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  const run: RunCommand = async (file, args, options) => {
    expect(file).toBe("docker");
    const nodeIndex = args.indexOf("node");
    expect(args.slice(0, nodeIndex)).toEqual([
      "compose",
      "-f",
      "compose.yaml",
      "-f",
      "compose.media.yaml",
      "exec",
      "-T",
      "server",
    ]);
    expect(args.join(" ")).not.toContain(token);
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(address.port) };
    if (configuredToken) env.ADMIN_TOKEN = configuredToken;
    else delete env.ADMIN_TOKEN;
    // Execute the actual in-container payload against an isolated HTTP fixture, never Docker.
    return runFile(process.execPath, args.slice(nodeIndex + 1), { ...options, env });
  };
  try {
    await exercise(run);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("private Compose operational controls", () => {
  it("authenticates reads and pause/resume requests using the server's configured token", async () => {
    const requests: Array<{ method?: string; url?: string; authorization?: string; body: string }> =
      [];
    const flags = { signups: true, sessionCreation: true, mediaUploads: true };
    await withPrivateApi(
      (request, response) => {
        let body = "";
        request.on("data", (chunk) => (body += String(chunk)));
        request.on("end", () => {
          requests.push({
            method: request.method,
            url: request.url,
            authorization: request.headers.authorization,
            body,
          });
          if (body) Object.assign(flags, JSON.parse(body));
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ configured: flags, runtime: flags, effective: flags }));
        });
      },
      async (run) => {
        expect((await composeOperationalFeatures(undefined, run)).effective.signups).toBe(true);
        expect(
          (
            await composeOperationalFeatures(
              { signups: false, sessionCreation: false, mediaUploads: false },
              run,
            )
          ).effective,
        ).toEqual({ signups: false, sessionCreation: false, mediaUploads: false });
        expect(
          (
            await composeOperationalFeatures(
              { signups: true, sessionCreation: true, mediaUploads: true },
              run,
            )
          ).effective,
        ).toEqual({ signups: true, sessionCreation: true, mediaUploads: true });
      },
    );
    expect(
      requests.map(({ method, url, authorization }) => ({ method, url, authorization })),
    ).toEqual(
      ["GET", "PATCH", "PATCH"].map((method) => ({
        method,
        url: "/v1/admin/features",
        authorization: `Bearer ${token}`,
      })),
    );
    expect(requests[0]?.body).toBe("");
  });

  it("fails on rejected private authorization without exposing the operator token", async () => {
    await withPrivateApi(
      (_request, response) => {
        response.writeHead(401).end("Administrator token required");
      },
      async (run) => {
        const error = await composeOperationalFeatures(undefined, run).catch(
          (caught: Error) => caught,
        );
        expect(error).toBeInstanceOf(Error);
        expect(String(error)).toContain("GET private /v1/admin/features returned 401");
        expect(String(error)).not.toContain(token);
      },
    );
  });

  it("rejects missing server credentials before making an administrative request", async () => {
    let requests = 0;
    await withPrivateApi(
      (_request, response) => {
        requests += 1;
        response.end("{}");
      },
      async (run) => {
        await expect(composeOperationalFeatures(undefined, run)).rejects.toThrow(
          "The server container must configure ADMIN_TOKEN",
        );
      },
      "",
    );
    expect(requests).toBe(0);
  });
});
