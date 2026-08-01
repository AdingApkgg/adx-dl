import { RouteLoadingSkeleton } from "@/app/route-loading";
import { getDictionary } from "@/lib/i18n";

// Covers /[locale]/versions and /[locale]/versions/[version] — both card grids.
export default function Loading() {
  return (
    <RouteLoadingSkeleton label={getDictionary("en").statusPage.loading} variant="catalog" />
  );
}
