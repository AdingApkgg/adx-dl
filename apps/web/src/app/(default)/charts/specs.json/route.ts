import { readChartSpecsById } from "@/lib/catalog";

// Build-time manifest of per-chart download specs (archive dir + asset file
// URLs), keyed by entry id. The browse pages ship only card-level entries; the
// catalog browser fetches this lazily when the user enters select mode.
// Rendered to a static file under output: export.
export const dynamic = "force-static";

export async function GET() {
  const specs = await readChartSpecsById();
  return Response.json(specs);
}
