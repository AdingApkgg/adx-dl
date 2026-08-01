import { RouteLoadingSkeleton } from "@/app/route-loading";
import { getDictionary } from "@/lib/i18n";

// Mirrors (default)/charts/loading.tsx; English label, as loading.tsx gets no
// params and can't tell /en from /ja.
export default function Loading() {
  return (
    <RouteLoadingSkeleton label={getDictionary("en").statusPage.loading} variant="catalog" />
  );
}
