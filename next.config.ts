import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Parsed at runtime in Node, not bundled.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "mammoth"],
};

export default nextConfig;
