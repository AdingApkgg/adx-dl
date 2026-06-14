/**
 * Canonical route slug for a chart. Prefers the readable, directory-derived
 * `slug` from the catalog; falls back to the legacy FNV hash when absent
 * (e.g. older catalogs or test fixtures), so old links keep resolving.
 */
export function entrySlug(entry: { slug?: string | null; id: string }): string {
  const slug = entry.slug?.trim();
  return slug ? slug : toRouteSlug(entry.id);
}

export function toRouteSlug(id: string): string {
  let hash = 2166136261;

  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const safeHash = (hash >>> 0).toString(36);
  const length = id.length.toString(36);

  return `e-${length}-${safeHash}`;
}

export function toLegacyRouteSlug(id: string): string | null {
  const slug = encodeURIComponent(id);

  if (slug.length > 160) {
    return null;
  }

  return slug;
}
