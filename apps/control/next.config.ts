import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.PLAYWRIGHT_CONTROL === "true" ? ".next-control-test" : ".next",
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@openround/control-plane",
    "@openround/db",
    "@openround/contracts",
    "@openround/game-engine",
  ],
  webpack(config) {
    // Shared Node packages use ESM .js specifiers for their TypeScript source files.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};
export default nextConfig;
