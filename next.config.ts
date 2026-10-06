import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pin the tracing root so a lockfile in a parent directory is ignored
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
