import { RouteLoadingSkeleton } from "@/app/route-loading";
import { getDictionary } from "@/lib/i18n";

// Covers /charts; the detail segment below declares its own boundary.
export default function Loading() {
  return (
    <RouteLoadingSkeleton label={getDictionary("zh").statusPage.loading} variant="catalog" />
  );
}
