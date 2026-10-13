import type { NextConfig } from "next";

const buildId = process.env.OPENROUND_BUILD_ID?.trim() || "unversioned";

const nextConfig: NextConfig = {
  distDir: process.env.PLAYWRIGHT_BUSINESS === "true" ? ".next-business" : ".next",
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@openround/contracts"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-OpenRound-Build-Id", value: buildId },
        ],
      },
    ];
  },
};

export default nextConfig;
