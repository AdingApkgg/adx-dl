export type VersionFilterMode = "include" | "exclude";

export function parseVersionFilterMode(value: string | null): VersionFilterMode {
  return value === "exclude" ? "exclude" : "include";
}

/** An empty choice means all versions in either mode. Exclusion also admits new versions. */
export function matchesVersionFilter(
  versionId: string,
  selected: ReadonlySet<string>,
  mode: VersionFilterMode
): boolean {
  if (selected.size === 0) return true;
  return mode === "exclude" ? !selected.has(versionId) : selected.has(versionId);
}
