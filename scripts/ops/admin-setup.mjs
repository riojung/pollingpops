#!/usr/bin/env node
import process from "node:process";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { localAdminCredentialKey } from "./admin-key.mjs";
import { assertDockerReady, composeArgv, dockerContextArgv, parseCliArguments } from "./lib.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCliArguments(argv, {
    valueOptions: ["username", "name", "role", "docker-context", "profile"],
    booleanOptions: ["help", "reset"],
  });
  if (parsed.flags.has("help")) {
    process.stdout.write(
      "Usage: pnpm admin:setup --username NAME --name DISPLAY_NAME --role founder|operations|support|billing|readonly [--reset] [--docker-context NAME] [--profile core|media|observability]\n" +
        "Run after starting local services. Password prompts are hidden; add the displayed secret to an authenticator app. --reset replaces credentials and revokes existing admin sessions.\n",
    );
    return;
  }
  if (parsed.positionals.length) throw new Error("Use named options; see --help");
  const username = parsed.values.get("username");
  const name = parsed.values.get("name");
  const role = parsed.values.get("role");
  if (
    !username ||
    !name ||
    !["founder", "operations", "support", "billing", "readonly"].includes(role)
  )
    throw new Error("Supply --username, --name and an explicit --role; see --help");
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Administrator setup requires an interactive terminal");
  const dockerContext = parsed.values.get("docker-context");
  const profile = parsed.values.get("profile") ?? "core";
  const prefix = composeArgv("status", { profile }).slice(0, -1);
  await assertDockerReady({ cwd: root, dockerContext });
  const key = await localAdminCredentialKey(root);
  const args = [
    ...dockerContextArgv(dockerContext),
    ...prefix,
    "exec",
    "--env",
    "OPERATOR_CREDENTIAL_KEY",
    "control",
    "node",
    "/app/admin-cli.mjs",
    parsed.flags.has("reset") ? "reset" : "setup",
    "--username",
    username,
    "--name",
    name,
    "--role",
    role,
  ];
  await new Promise((resolveExit, reject) => {
    const child = spawn("docker", args, {
      cwd: root,
      env: { ...process.env, OPERATOR_CREDENTIAL_KEY: key },
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveExit();
      else reject(new Error("Administrator setup did not complete"));
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    process.stderr.write(
      "Administrator setup failed. Check local service readiness and setup options; credentials were not logged.\n",
    );
    process.exitCode = 1;
  });
