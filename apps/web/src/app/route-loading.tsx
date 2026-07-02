/**
 * Shared route-level loading skeleton (see the group `loading.tsx` files): a
 * pulsing heading + card grid roughly matching the browse layouts, shown during
 * client-side navigations while the next page's payload streams in.
 */
export function RouteLoadingSkeleton({ label }: { label: string }) {
  return (
    <main
      id="main-content"
      aria-busy="true"
      className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <span role="status" className="sr-only">
        {label}
      </span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="h-8 w-56 max-w-full animate-pulse rounded-lg bg-muted/70" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted/60" />
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/60 p-3"
          >
            <div className="aspect-square w-full animate-pulse rounded-xl bg-muted/70" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted/50" />
          </div>
        ))}
      </div>
    </main>
  );
}
