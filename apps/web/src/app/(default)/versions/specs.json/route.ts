import { readVersionChartSpecs } from "@/lib/catalog";

// Build-time manifest of per-version chart download specs keyed by version
// slug. The versions index ships only the tile data; the batch grid fetches
// this lazily when select mode is first enabled. Rendered to a static file
// under output: export.
export const dynamic = "force-static";

export async function GET() {
  const specs = await readVersionChartSpecs();
  return Response.json(specs);
}
