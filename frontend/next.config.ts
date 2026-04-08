import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
const ragUrl = process.env.RAG_URL || "http://localhost:8080";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  experimental: {
    proxyTimeout: 300_000, // 5 minutes — LLM on CPU can be slow
  },
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
      // Direct to RAG service for streaming (bypasses Django buffering)
      {
        source: "/api/rag/:path*",
        destination: `${ragUrl}/api/:path*`,
      },
      {
        source: "/api/chat/:path*/",
        destination: `${backendUrl}/api/chat/:path*/`,
      },
      {
        source: "/api/chat/:path*",
        destination: `${backendUrl}/api/chat/:path*/`,
      },
    ];
  },
};

export default nextConfig;
