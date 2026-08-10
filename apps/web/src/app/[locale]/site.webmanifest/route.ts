import { buildWebManifest } from "@/lib/web-manifest";

import { generatePrefixedLocaleParams, getPrefixedRouteLocale } from "../route-locale";

// Per-locale install manifests. Without them a visitor installing from /ja got
// the zh manifest: a Chinese name and description in the install prompt, and a
// launcher icon that opened the Chinese home page on every launch.
export const dynamic = "force-static";

export function generateStaticParams() {
  return generatePrefixedLocaleParams();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params;

  return Response.json(buildWebManifest(getPrefixedRouteLocale(locale)), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
  });
}
