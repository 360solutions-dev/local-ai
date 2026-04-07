import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/api/auth/:path*/",
        destination: `${backendUrl}/api/auth/:path*/`,
      },
      {
        source: "/api/auth/:path*",
        destination: `${backendUrl}/api/auth/:path*/`,
      },
      {
        source: "/api/notifications/:path*/",
        destination: `${backendUrl}/api/notifications/:path*/`,
      },
      {
        source: "/api/notifications/:path*",
        destination: `${backendUrl}/api/notifications/:path*/`,
      },
      {
        source: "/api/system/:path*/",
        destination: `${backendUrl}/api/system/:path*/`,
      },
      {
        source: "/api/system/:path*",
        destination: `${backendUrl}/api/system/:path*/`,
      },
    ];
  },
};

export default nextConfig;
