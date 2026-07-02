import { RouteLoadingSkeleton } from "@/app/route-loading";
import { getDictionary } from "@/lib/i18n";

// loading.tsx receives no params, so the sr-only label can't match /ja exactly;
// English is the least-wrong shared fallback for the prefixed trees.
export default function Loading() {
  return <RouteLoadingSkeleton label={getDictionary("en").statusPage.loading} />;
}
