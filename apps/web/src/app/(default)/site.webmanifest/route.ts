import { buildWebManifest } from "@/lib/web-manifest";

// The zh (default) tree's install manifest. It used to be a hand-written file in
// public/, but once en and ja needed their own the copy had to come from one
// place — see lib/web-manifest.ts. Rendered to /site.webmanifest at build time.
export const dynamic = "force-static";

export function GET() {
  return Response.json(buildWebManifest("zh"), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
  });
}
