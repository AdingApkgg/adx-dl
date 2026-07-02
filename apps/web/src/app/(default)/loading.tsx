import { RouteLoadingSkeleton } from "@/app/route-loading";
import { getDictionary } from "@/lib/i18n";

export default function Loading() {
  return <RouteLoadingSkeleton label={getDictionary("zh").statusPage.loading} />;
}
