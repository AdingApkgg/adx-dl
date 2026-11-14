type CommentEvents = {
  on: (event: string, handler: () => void) => void;
  off: (event: string, handler: () => void) => void;
};

// Artalk.init() returns before remote configuration, plugins, and the comment
// request complete. Observe only the initial request: later pagination errors
// belong to Artalk's own UI and must not tear down an editor holding a draft.
export function watchCommentLoading(
  instance: CommentEvents,
  onSettled: (status: "ready" | "error") => void,
  timeoutMs = 20_000,
): () => void {
  let active = true;
  const cleanup = () => {
    active = false;
    clearTimeout(timer);
    instance.off("list-loaded", ready);
    instance.off("list-failed", failed);
  };
  const settle = (status: "ready" | "error") => {
    if (!active) return;
    cleanup();
    onSettled(status);
  };
  const ready = () => settle("ready");
  const failed = () => settle("error");
  const timer = setTimeout(failed, timeoutMs);
  instance.on("list-loaded", ready);
  instance.on("list-failed", failed);
  return cleanup;
}

// Check the public endpoint through the browser's normal CORS rules before
// Artalk starts its internal (unhandled on rejection) configuration promise.
export async function probeCommentServer(
  server: string,
  signal: AbortSignal,
  timeoutMs = 10_000,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(`${server}/api/v2/conf`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Comment configuration returned ${response.status}`);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
