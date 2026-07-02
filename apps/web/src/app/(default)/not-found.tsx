import { NotFoundView } from "@/app/not-found-view";

// Boundary for notFound() thrown inside the zh tree (e.g. chart/version detail
// guards): renders inside this group's layout, so the site shell is preserved.
export default function NotFound() {
  return <NotFoundView />;
}
