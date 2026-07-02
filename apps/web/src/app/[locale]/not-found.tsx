import { NotFoundView } from "@/app/not-found-view";

// Boundary for notFound() thrown inside the /en and /ja trees: renders inside
// this group's localized layout shell. NotFoundView derives the display locale
// from the URL client-side (not-found components receive no params).
export default function NotFound() {
  return <NotFoundView />;
}
