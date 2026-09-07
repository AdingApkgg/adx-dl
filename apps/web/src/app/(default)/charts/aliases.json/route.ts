import { readPackableAliasIndex } from "@/lib/catalog";

// Build-time manifest of the community aliases worth appending to a packed
// maidata's `&title`, keyed by shortid. The download store fetches it lazily,
// and only when the "append aliases" setting is on, so the ~100 KB never rides
// along with a page. Rendered to a static file under output: export.
export const dynamic = "force-static";

export async function GET() {
  return Response.json(await readPackableAliasIndex());
}
