import path from "node:path";
import type { NextConfig } from "next";

// Monorepo root is two levels up from apps/web (used as the Turbopack root).
const rootDir = path.resolve(process.cwd(), "..", "..");

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: rootDir,
  },
};

export default nextConfig;
