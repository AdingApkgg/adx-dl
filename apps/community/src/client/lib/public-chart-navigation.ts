import { publicChartFiltersFromParams, publicChartSearchParams } from "@/shared/public-chart-search";
import { isPublicUserId } from "@/shared/user-public-id";

/** Only catalog/profile pages and the authenticated favorites page may become return links. */
export function publicListHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2500 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://community.invalid");
    if (url.origin !== "https://community.invalid" || url.hash) return null;
    const path = url.pathname.replace(/^\/(en|ja)(?=\/)/, "");
    if (path !== "/charts" && path !== "/me/favorites" && !(path.startsWith("/u/") && isPublicUserId(path.slice(3)))) return null;
    if ([...url.searchParams.keys()].some(key => !["q", "difficulty", "sort", "author", "cursor"].includes(key))) return null;
    publicChartFiltersFromParams(url.searchParams);
    const cursor = url.searchParams.get("cursor");
    if (cursor && (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))) return null;
    return url.pathname + url.search;
  } catch { return null; }
}
export function samePublicListScope(href: unknown, current: string): href is string {
  const candidate = publicListHref(href);
  if (!candidate) return false;
  try {
    const a = new URL(candidate, "https://community.invalid"), b = new URL(current, "https://community.invalid");
    return a.pathname === b.pathname && publicChartSearchParams(publicChartFiltersFromParams(a.searchParams)).toString() ===
      publicChartSearchParams(publicChartFiltersFromParams(b.searchParams)).toString();
  } catch { return false; }
}

export type PublicListReturnState = { publicListHref: string; publicListCursors: string[] };
export function publicListCursors(value: unknown, href: string): string[] {
  return Array.isArray(value) ? value.slice(-100).filter((item): item is string => samePublicListScope(item, href)) : [];
}
export function publicListReturnState(value: unknown): PublicListReturnState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>, href = publicListHref(record.publicListHref);
  return href ? { publicListHref: href, publicListCursors: publicListCursors(record.publicListCursors, href) } : null;
}

export function publicListBackState(state: PublicListReturnState) {
  return /\/me\/favorites$/.test(state.publicListHref.split("?")[0]!)
    ? { socialPageScope: "/me/favorites:", socialCursors: state.publicListCursors.map(href => new URL(href, "https://community.invalid").searchParams.get("cursor") ?? "") }
    : { publicChartCursors: state.publicListCursors };
}
