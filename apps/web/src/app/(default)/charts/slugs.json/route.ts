import { readCanonicalSlugs } from "@/lib/catalog";

// Slim slug list powering the "random chart" button: fetched lazily on first
// click, so the ~30KB list never rides along with a page payload. Rendered to
// a static file under output: export.
export const dynamic = "force-static";

export async function GET() {
  const slugs = await readCanonicalSlugs();
  return Response.json(slugs);
}
