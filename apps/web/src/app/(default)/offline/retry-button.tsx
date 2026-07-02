"use client";

// The offline page's JS chunks are precached with the app shell (see
// serwist.config.mjs), so this hydrates and works without a network.
export function RetryButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {label}
    </button>
  );
}
