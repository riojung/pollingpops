import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { PostgresRepository, createPlatformRepository, type OperatorRole } from "@openround/db";
import { loadControlConfig } from "./config.js";
import { OperatorError } from "./auth.js";
import { normalizeOperatorUsername, provisionPasswordOperator } from "./password-auth.js";

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command === "--help" && arguments_.length === 0) {
    process.stdout.write(
      "Usage: setup|reset --username USER --name NAME --role founder|operations|support|billing|readonly\n",
    );
    return;
  }
  const options = new Map<string, string>();
  if (!["setup", "reset"].includes(command ?? "") || arguments_.length % 2 !== 0)
    throw new OperatorError(
      400,
      "USAGE",
      "Usage: setup|reset --username USER --name NAME --role founder|operations|support|billing|readonly",
    );
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index]!;
    if (!["--username", "--name", "--role"].includes(flag) || options.has(flag))
      throw new OperatorError(
        400,
        "USAGE",
        "Only --username, --name and an explicit --role are accepted",
      );
    options.set(flag, arguments_[index + 1]!);
  }
  if (!options.get("--username") || !options.get("--name") || !options.get("--role"))
    throw new OperatorError(400, "USAGE", "Supply --username, --name and an explicit --role");
  normalizeOperatorUsername(options.get("--username")!);
  const role = options.get("--role")!;
  if (!["founder", "operations", "support", "billing", "readonly"].includes(role))
    throw new OperatorError(400, "USAGE", "Choose an explicit supported operator role");
  const config = loadControlConfig();
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new OperatorError(
      400,
      "TERMINAL_REQUIRED",
      "Run administrator provisioning in an interactive terminal to enter the hidden password",
    );
  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const prompt = createInterface({ input: process.stdin, output: mutedOutput, terminal: true });
  let password: string;
  try {
    process.stdout.write("Password (hidden): ");
    password = await prompt.question("");
    process.stdout.write("\nConfirm password (hidden): ");
    const confirmation = await prompt.question("");
    process.stdout.write("\n");
    if (password !== confirmation)
      throw new OperatorError(400, "PASSWORD_MISMATCH", "The passwords did not match");
  } finally {
    prompt.close();
  }
  const repository = new PostgresRepository(config.CONTROL_DATABASE_URL!);
  try {
    // Runtime administration uses the already migrated database and never performs schema maintenance.
    await repository.initialize();
    const result = await provisionPasswordOperator(createPlatformRepository(repository), config, {
      username: options.get("--username")!,
      password,
      name: options.get("--name")!,
      role: role as OperatorRole,
      reset: command === "reset",
    });
    process.stdout.write(
      `Administrator ${command === "reset" ? "credentials reset" : "provisioned"}. Active: ${result.operator.active ? "yes" : "no"}.\n`,
    );
    process.stdout.write(
      `Add this account to your authenticator. Save this setup material securely:\nSecret: ${result.totpSecret}\nAuthenticator URI: ${result.otpauthUri}\n`,
    );
  } finally {
    await repository.close();
  }
}
try {
  await main();
} catch (error) {
  // Never render raw configuration, database errors or argument values, which may contain secrets.
  process.stderr.write(
    `${error instanceof OperatorError ? error.message : "Administrator provisioning failed. Verify configuration, database readiness and connectivity."}\n`,
  );
  process.exitCode = 1;
}
