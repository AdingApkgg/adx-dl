/**
 * Canonical route slug for a chart: the catalog `slug` (the unique maimai
 * shortid). Falls back to the entry id only as a defensive guard for fixtures
 * or malformed entries that lack a slug.
 */
export function entrySlug(entry: { slug?: string | null; id: string }): string {
  const slug = entry.slug?.trim();
  return slug ? slug : entry.id;
}
