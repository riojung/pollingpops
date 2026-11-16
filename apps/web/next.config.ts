import type { NextConfig } from "next";
import { nextOutputDirectory } from "../../scripts/build/next-config.mjs";

const buildId = process.env.OPENROUND_BUILD_ID?.trim() || "unversioned";
const nextConfig: NextConfig = {
  distDir: nextOutputDirectory("web"),
  typescript: { tsconfigPath: "tsconfig.build.json" },
  // Cap prerender workers independently of the machine's advertised CPU count.
  experimental: { cpus: 2 },
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
      {
        source: "/presentation-practice/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      {
        source: "/summary/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;
