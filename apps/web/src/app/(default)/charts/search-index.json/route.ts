import { readSearchIndex } from "@/lib/catalog";

// Slim build-time search index (id/slug/titles/artists/aliases) powering the
// home hero's instant suggestions; fetched lazily on first focus. Rendered to
// a static file under output: export.
export const dynamic = "force-static";

export async function GET() {
  const index = await readSearchIndex();
  return Response.json(index);
}
