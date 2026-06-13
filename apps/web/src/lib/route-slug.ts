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
