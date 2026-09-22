import path from "node:path";
import type { NextConfig } from "next";

// Monorepo root is two levels up from apps/web (used as the Turbopack root).
const rootDir = path.resolve(process.cwd(), "..", "..");

const nextConfig: NextConfig = {
  output: "export",
  // Client-side navigations (the normal case — RSC payloads ship in the static
  // export) animate via React's <ViewTransition>; see PageTransition in
  // src/app/page-transition.tsx. Hard loads use @view-transition in globals.css.
  experimental: {
    viewTransition: true,
    // `radix-ui` is a namespace barrel over ~35 primitives; the app renders 9 of
    // them, but the whole barrel landed in the shared first-load chunk. Same
    // story for lucide-react's icon index. Rewriting these to per-primitive
    // deep imports at build time is compatible with `output: "export"`.
    optimizePackageImports: ["radix-ui", "lucide-react"],
  },
  images: {
    unoptimized: true,
  },
  // Both packages ship raw TypeScript with no build step (`main` points
  // straight at a .ts file), so Next must transpile them like first-party
  // source. @astrodx/content-schema is only imported from test files today
  // (apps/web/src/lib/content-json.test.ts) — harmless while that stays true,
  // but the moment any component imports it, the first place it breaks is the
  // ~7-minute gh-pages deploy build, not a local dev run. Listed preemptively.
  transpilePackages: ["@lxns-network/maimai-chart-engine", "@astrodx/content-schema"],
  turbopack: {
    root: rootDir,
  },
};

export default nextConfig;
