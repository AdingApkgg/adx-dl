import { versionRouteId } from "@/lib/catalog-shared";
import { buildLocalePath, type Locale } from "@/lib/i18n";

/**
 * Deep-link the shared catalog with one stable maimai version id selected.
 * A null index maps to the shared "unknown" bucket.
 */
export function buildVersionFilterHref(versionIndex: number | null, locale: Locale): string {
  const params = new URLSearchParams({ version: versionRouteId(versionIndex) });
  return `${buildLocalePath("/charts", locale)}?${params.toString()}`;
}
