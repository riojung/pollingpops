import type { NextConfig } from "next";

const buildId = process.env.OPENROUND_BUILD_ID?.trim() || "unversioned";
const canvasCapacityDist = process.env.CANVAS_COLLAB_DIST_DIR;
if (
  canvasCapacityDist !== undefined &&
  !/^\.next-canvas-capacity(?:-[a-z0-9-]{1,48})?$/.test(canvasCapacityDist)
)
  throw new Error("CANVAS_COLLAB_DIST_DIR must name a dedicated .next-canvas-capacity directory");

const nextConfig: NextConfig = {
  distDir:
    canvasCapacityDist ?? (process.env.PLAYWRIGHT_BUSINESS === "true" ? ".next-business" : ".next"),
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
