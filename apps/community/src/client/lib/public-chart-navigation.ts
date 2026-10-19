import { publicChartFiltersFromParams, publicChartSearchParams } from "@/shared/public-chart-search";
import {parseDiscoveryInput} from "@/shared/discovery-search";
import { isPublicUserId } from "@/shared/user-public-id";

/** Only catalog/profile pages and the authenticated favorites page may become return links. */
export function publicListHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16384 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://community.invalid");
    if (url.origin !== "https://community.invalid" || url.hash) return null;
    const path = url.pathname.replace(/^\/(en|ja)(?=\/)/, "");
    if (path !== "/charts" && path !== "/search" && !/^\/tags\/[^/]+$/.test(path) && path !== "/me/favorites" && !(path.startsWith("/u/") && isPublicUserId(path.slice(3)))) return null;
    if ([...url.searchParams.keys()].some(key => !["q", "difficulty", "sort", "author", "tag", "tags", "tag[]", "tagLines", "levels", "level[]", "levelLines", "designer", "minSeconds", "maxSeconds", "preview", "type", "view", "cursor"].includes(key))) return null;
    if(path==="/search") parseDiscoveryInput(url.searchParams);
    else {if(url.searchParams.has("type"))return null;publicChartFiltersFromParams(url.searchParams);}
    if (url.searchParams.has("view") && !["grid","list"].includes(url.searchParams.get("view")!)) return null;
    const cursor = url.searchParams.get("cursor");
    if (cursor && (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor))) return null;
    return url.pathname + url.search;
  } catch { return null; }
}
export function samePublicListScope(href: unknown, current: string): href is string {
  const candidate = publicListHref(href);
  if (!candidate) return false;
  try {
    const a = new URL(candidate, "https://community.invalid"), b = new URL(current, "https://community.invalid");
    return a.pathname === b.pathname && (a.searchParams.get("type")??"all") === (b.searchParams.get("type")??"all") && (a.searchParams.get("view")??"grid") === (b.searchParams.get("view")??"grid") && publicChartSearchParams(publicChartFiltersFromParams(a.searchParams)).toString() ===
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
