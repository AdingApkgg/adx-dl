/** A lost advisory session cannot be reused. Drain the old process before Docker restarts it. */
export function superviseStorageRole(
  failure: AbortSignal,
  shutdown: () => Promise<void>,
  timeoutMs: number,
) {
  const lost = () => {
    // Query errors can contain connection details; emit only a fixed diagnostic.
    console.error("STORAGE_ROLE_LOST");
    process.exitCode = 1;
    setTimeout(() => process.exit(1), timeoutMs);
    void Promise.resolve().then(shutdown).then(
      () => process.exit(1),
      () => process.exit(1),
    );
  };
  if (failure.aborted) lost();
  else failure.addEventListener("abort", lost, { once: true });
}
