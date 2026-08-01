import { RouteLoadingSkeleton } from "@/app/route-loading";
import { getDictionary } from "@/lib/i18n";

// Covers /versions and /versions/[version] — both are card grids.
export default function Loading() {
  return (
    <RouteLoadingSkeleton label={getDictionary("zh").statusPage.loading} variant="catalog" />
  );
}
