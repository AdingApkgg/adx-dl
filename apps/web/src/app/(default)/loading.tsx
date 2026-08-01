import { RouteLoadingSkeleton } from "@/app/route-loading";
import { getDictionary } from "@/lib/i18n";

// Catch-all for the group: home plus the narrow text pages (about, donate,
// links…). /charts and /versions declare their own grid-shaped boundaries.
export default function Loading() {
  return (
    <RouteLoadingSkeleton label={getDictionary("zh").statusPage.loading} variant="prose" />
  );
}
