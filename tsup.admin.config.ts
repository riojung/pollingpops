import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "admin-cli": "packages/control-plane/src/admin-cli.ts" },
  outDir: "apps/control/admin-dist",
  format: ["esm"],
  target: "node22",
  platform: "node",
  noExternal: [/^@openround\//, "pg"],
  external: ["pg-native"],
  shims: true,
  banner: {
    js: "import { createRequire as createAdminRequire } from 'node:module'; const require = createAdminRequire(import.meta.url);",
  },
  splitting: false,
  clean: true,
});
