#!/usr/bin/env node
import console from "node:console";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main as deploy } from "./deploy.mjs";

// The existing release deployer performs all validation, signature verification,
// real-account checks, migration isolation, backup/readiness gates and rollback.
export function promotionArguments(argv) {
  const result = ["production"];
  const required = new Set(["aws-config", "receipt", "manifest"]);
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const match = argv[index].match(/^--(aws-config|receipt|manifest)(?:=(.*))?$/);
    if (!match) {
      if (
        [
          "production",
          "staging",
          "development",
          "--environment",
          "--local-staging-receipt",
          "--rollback",
        ].includes(argv[index]) ||
        argv[index].startsWith("--environment=")
      )
        throw new Error("Promotion accepts a forward production deployment only");
      result.push(argv[index]);
      continue;
    }
    const [, name, inline] = match;
    if (seen.has(name)) throw new Error(`Duplicate --${name}`);
    seen.add(name);
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${name} requires a path`);
    result.push(`--${name === "receipt" ? "local-staging-receipt" : name}`, value);
  }
  for (const name of required)
    if (!seen.has(name)) throw new Error(`Promotion requires --${name} PATH`);
  return result;
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    console.log(
      "Usage: pnpm aws:promote --aws-config PATH --receipt PATH --manifest PATH --runtime-env PATH --migration-env PATH --backup-reference ID --confirm production:BUILD_ID [--dry-run]\nUses the signed production deployer; never rebuilds images or copies staging data.",
    );
    return;
  }
  await deploy(promotionArguments(argv));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`AWS promotion failed: ${error.message}`);
    process.exitCode = 1;
  });
