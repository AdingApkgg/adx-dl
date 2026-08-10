import {
  compareByReleaseDesc,
  resolveVersionIndex,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import { MAIMAI_VERSIONS } from "@/lib/version-image";

/**
 * How many chart cards one import batch shows before the rest is folded into a
 * link. The catalog's batches are wildly uneven (the seed import alone holds
 * ~1.6k charts, later ones a handful), so an uncapped page would ship the whole
 * catalog into a single statically exported HTML file.
 */
export const CHANGELOG_PREVIEW_SIZE = 12;

/** How many per-version links a batch offers before the tail is dropped. */
export const CHANGELOG_MAX_VERSIONS = 6;

export type ChangelogVersionSummary = {
  /** Canonical maimai version id, or null for the untagged bucket. */
  versionId: number | null;
  /** Canonical version name, or "Unknown" — localized by the view, as in VersionTileCard. */
  name: string;
  count: number;
};

export type ChangelogBatch = {
  /** UTC calendar day of the import — the granularity the importer works at. */
  date: string;
  /** Charts in the whole batch, including the ones the preview leaves out. */
  total: number;
  preview: CatalogEntry[];
  hiddenCount: number;
  /** Which maimai versions the batch touched, biggest share first. */
  versions: ChangelogVersionSummary[];
  /** Versions beyond the cap. The seed import spans all 27, so this is the norm. */
  hiddenVersionCount: number;
};

function versionName(versionId: number | null): string {
  if (versionId === null) {
    return "Unknown";
  }
  return (
    MAIMAI_VERSIONS.find((version) => version.index === versionId)?.name ?? "Unknown"
  );
}

/**
 * Group catalog entries into newest-first import batches, one per calendar day.
 *
 * Entries with no `imported_at` are skipped rather than pooled into an "unknown"
 * batch: the page is a dated timeline, and an undated pile at the bottom would
 * be indistinguishable from the oldest real batch while carrying no information.
 */
export function buildChangelogBatches(
  entries: CatalogEntry[],
  options: { previewSize?: number; maxVersions?: number } = {}
): ChangelogBatch[] {
  const previewSize = options.previewSize ?? CHANGELOG_PREVIEW_SIZE;
  const maxVersions = options.maxVersions ?? CHANGELOG_MAX_VERSIONS;

  const byDate = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const date = entry.imported_at?.slice(0, 10);
    if (!date || date.length !== 10) {
      continue;
    }
    const bucket = byDate.get(date);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDate.set(date, [entry]);
    }
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, bucket]) => {
      const ordered = [...bucket].sort(compareByReleaseDesc);

      const versionCounts = new Map<number | null, number>();
      for (const entry of ordered) {
        const versionId = resolveVersionIndex(entry);
        versionCounts.set(versionId, (versionCounts.get(versionId) ?? 0) + 1);
      }
      const rankedVersions = [...versionCounts.entries()]
        .map(([versionId, count]) => ({ versionId, name: versionName(versionId), count }))
        // Biggest share first; ties go to the newer version so the links stay
        // in a stable, chronologically meaningful order across rebuilds.
        .sort((a, b) => b.count - a.count || (b.versionId ?? -1) - (a.versionId ?? -1));

      return {
        date,
        total: ordered.length,
        preview: ordered.slice(0, previewSize),
        hiddenCount: Math.max(0, ordered.length - previewSize),
        versions: rankedVersions.slice(0, maxVersions),
        hiddenVersionCount: Math.max(0, rankedVersions.length - maxVersions),
      };
    });
}
