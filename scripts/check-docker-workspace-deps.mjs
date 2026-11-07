import console from "node:console";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";

const root = process.cwd();
const packageDirectories = ["apps", "packages"].flatMap((parent) => {
  const absoluteParent = join(root, parent);
  if (!existsSync(absoluteParent)) return [];
  return readdirSync(absoluteParent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(absoluteParent, entry.name))
    .filter((directory) => existsSync(join(directory, "package.json")));
});

const packagesByName = new Map(
  packageDirectories.map((directory) => {
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    return [manifest.name, { directory, manifest }];
  }),
);

function workspaceClosure(entry) {
  const closure = new Map([[entry.manifest.name, entry]]);
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const [name, version] of Object.entries(current.manifest.dependencies ?? {})) {
      if (typeof version !== "string" || !version.startsWith("workspace:") || closure.has(name)) {
        continue;
      }
      const dependency = packagesByName.get(name);
      if (!dependency) throw new Error(`Workspace dependency ${name} has no package manifest`);
      closure.set(name, dependency);
      pending.push(dependency);
    }
  }
  return [...closure.values()];
}

function portablePath(path) {
  return relative(root, path).split(sep).join("/");
}

function sourceCopyCovers(line, packagePath) {
  const match = line.match(/^COPY\s+(\S+)\s+(\S+)\s*$/);
  if (!match) return false;
  const source = match[1].replace(/\/$/, "");
  const destination = match[2].replace(/\/$/, "");
  return (
    (packagePath === source || packagePath.startsWith(`${source}/`)) &&
    (packagePath === destination || packagePath.startsWith(`${destination}/`))
  );
}

const errors = [];
for (const entry of packagesByName.values()) {
  const dockerfilePath = join(entry.directory, "Dockerfile");
  if (!existsSync(dockerfilePath)) continue;
  const dockerfile = readFileSync(dockerfilePath, "utf8");
  // A BuildKit store mount changes the RUN prefix, not the workspace input contract.
  const installAt = dockerfile.search(
    /^RUN[ \t]+(?:--mount=type=cache,[^\s]+[ \t]+)?pnpm install --frozen-lockfile(?:[ \t]|$)/m,
  );
  const packageName = entry.manifest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const buildAt = dockerfile.search(
    new RegExp(
      `^RUN[ \\t]+(?:--mount=type=cache,[^\\s]+[ \\t]+)?pnpm --filter ${packageName} build(?:[ \\t]|$)`,
      "m",
    ),
  );
  if (installAt < 0 || buildAt < installAt) {
    errors.push(`${portablePath(dockerfilePath)} must install dependencies before its build step`);
    continue;
  }
  const beforeInstall = dockerfile.slice(0, installAt);
  const beforeBuildLines = dockerfile.slice(0, buildAt).split(/\r?\n/);
  for (const dependency of workspaceClosure(entry)) {
    const dependencyPath = portablePath(dependency.directory);
    const manifestCopy = `COPY ${dependencyPath}/package.json ${dependencyPath}/package.json`;
    if (!beforeInstall.includes(manifestCopy)) {
      errors.push(
        `${portablePath(dockerfilePath)} must copy ${dependencyPath}/package.json before pnpm install`,
      );
    }
    if (!beforeBuildLines.some((line) => sourceCopyCovers(line.trim(), dependencyPath))) {
      errors.push(
        `${portablePath(dockerfilePath)} must copy ${dependencyPath} source before the build`,
      );
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Docker build contexts include every transitive workspace dependency.");
}
