import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Parsed at runtime in Node, not bundled.
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
