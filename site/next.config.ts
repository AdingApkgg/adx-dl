import path from "node:path";
import type { NextConfig } from "next";

const rootDir = path.resolve(process.cwd(), "..");

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
