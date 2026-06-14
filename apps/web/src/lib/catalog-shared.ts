export type CatalogDifficulty = {
  slot: number;
  level: string;
  designer: string;
};

export type CatalogEntryMedia = {
  entry_base_url: string;
  cover_url: string;
  audio_url: string;
  pv_url: string;
};

export type CatalogEntry = {
  id: string;
  /** Readable, URL-safe route slug derived from remote_dir_name by the builder. */
  slug?: string;
  remote_dir_name: string;
  title: string;
  title_en?: string;
  artist: string;
  artist_en?: string;
  category: string;
  subcategory: string;
  source_archive: string;
  source_folder: string;
  version: string;
  genre: string;
  cabinet: string;
  short_id: string;
  bpm: number | null;
  offset: number | null;
  download_mode: "onsite" | "external" | "mixed";
  download_url: string;
  source_url: string;
  license_note: string;
  files: {
    maidata: string;
    maidata_dx: string;
    audio: string;
    background: string;
    pv: string;
  };
  assets: {
    has_audio: boolean;
    has_background: boolean;
    has_pv: boolean;
    has_dx_chart: boolean;
  };
  media: CatalogEntryMedia;
  difficulties: CatalogDifficulty[];
  imported_at?: string;
};

export type CatalogCategories = Record<string, string[]>;

export type Catalog = {
  generated_at: string;
  total_entries: number;
  categories: CatalogCategories;
  entries: CatalogEntry[];
};

export function formatEntryTitle(entry: CatalogEntry, locale: "zh" | "en" | "ja"): string {
  if (locale === "en" && entry.title_en) {
    return entry.title_en;
  }
  return entry.title;
}

export function formatEntryArtist(entry: CatalogEntry, locale: "zh" | "en" | "ja"): string {
  if (locale === "en" && entry.artist_en) {
    return entry.artist_en;
  }
  return entry.artist;
}

export function formatEntrySubcategory(entry: CatalogEntry): string {
  if (entry.category === "Remote") {
    const remoteBranch = [entry.version, entry.cabinet].filter(Boolean).join(" / ");
    if (remoteBranch) {
      return remoteBranch;
    }
  }

  return entry.subcategory;
}

export function collectSubcategories(entries: CatalogEntry[], category: string): string[] {
  return [
    ...new Set(
      entries
        .filter((entry) => entry.category === category)
        .map((entry) => entry.subcategory)
    ),
  ].sort();
}

export type VersionGroup = {
  /** ASCII URL slug for the version route (e.g. "maimai-dx-prism"); "unknown" for untagged. */
  slug: string;
  /** Canonical version name (e.g. "maimai DX PRiSM"), or "Unknown". */
  name: string;
  /** genrepics icon index, or null when there is no icon (Unknown). */
  imageIndex: number | null;
  count: number;
};

// Version/subcategory strings are Latin (maimai version names), so an ASCII slug
// is safe and avoids the non-ASCII static-export routing pitfalls of chart slugs.
export function versionSlug(subcategory: string): string {
  return (
    subcategory
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

type EntryLocale = "zh" | "en" | "ja";

// Standard maimai DX difficulty ordering. Verified against the catalog level
// distribution (slot medians 2 / 4 / 7.5 / 10.5 / 13, slots 6-7 = 宴 charts).
// The labels are official romanized proper nouns, identical across locales.
const MAIMAI_SLOT_LABELS: Record<number, string> = {
  1: "Basic",
  2: "Advanced",
  3: "Expert",
  4: "Master",
  5: "Re:Master",
  6: "U·TAGE",
  7: "U·TAGE",
};

export function difficultySlotLabel(slot: number): string {
  return MAIMAI_SLOT_LABELS[slot] ?? `Lv.${slot}`;
}

function levelSortValue(level: string): number {
  const match = level.match(/^(\d+)(\+)?/);
  if (!match) {
    return -1;
  }
  return Number(match[1]) + (match[2] ? 0.5 : 0);
}

export function difficultyLevelRange(
  entry: CatalogEntry
): { low: string; high: string } | null {
  const levels = entry.difficulties.map((difficulty) => difficulty.level).filter(Boolean);
  if (levels.length === 0) {
    return null;
  }
  const sorted = [...levels].sort((a, b) => levelSortValue(a) - levelSortValue(b));
  return { low: sorted[0], high: sorted[sorted.length - 1] };
}

const CATEGORY_LABELS: Record<string, { zh: string; ja: string }> = {
  Remote: { zh: "远端", ja: "リモート" },
  Official: { zh: "官方", ja: "公式" },
  Unknown: { zh: "未知", ja: "不明" },
};

export function formatCategoryLabel(category: string, locale: EntryLocale): string {
  if (locale === "en" || !category) {
    return category;
  }
  const mapped = CATEGORY_LABELS[category];
  return mapped ? mapped[locale] : category;
}

function buildAssetClause(entry: CatalogEntry, locale: EntryLocale): string {
  const parts: string[] = [];
  if (locale === "zh") {
    if (entry.assets.has_audio) parts.push("音频");
    if (entry.assets.has_background) parts.push("封面图");
    if (entry.assets.has_pv) parts.push("PV");
    return parts.length ? `，并包含${parts.join("、")}` : "";
  }
  if (locale === "ja") {
    if (entry.assets.has_audio) parts.push("音源");
    if (entry.assets.has_background) parts.push("ジャケット画像");
    if (entry.assets.has_pv) parts.push("PV");
    return parts.length ? `（${parts.join("・")}付き）` : "";
  }
  if (entry.assets.has_audio) parts.push("audio");
  if (entry.assets.has_background) parts.push("a jacket image");
  if (entry.assets.has_pv) parts.push("a music video");
  return parts.length ? `, including ${parts.join(", ")}` : "";
}

// A self-contained, factual prose description synthesized strictly from catalog
// data. Used for the chart-detail page body AND the page's meta/OG description so
// the visible copy and the indexed description stay identical (good for GEO).
export function buildChartDescription(entry: CatalogEntry, locale: EntryLocale): string {
  const title = formatEntryTitle(entry, locale);
  const artist = formatEntryArtist(entry, locale);
  const branch = formatEntrySubcategory(entry);
  const range = difficultyLevelRange(entry);
  const count = entry.difficulties.length;
  const bpm = entry.bpm;
  const genre = entry.genre;
  const assetClause = buildAssetClause(entry, locale);

  if (locale === "zh") {
    const head = `《${title}》是 ${artist} 的 AstroDX 谱面，收录于「${branch}」分支${genre ? `，曲风 ${genre}` : ""}${bpm ? `，BPM ${bpm}` : ""}。`;
    const body = `本站提供 ${count} 个难度${range ? `（等级 ${range.low}–${range.high}）` : ""}${assetClause}，可在线浏览与下载。`;
    return head + body;
  }
  if (locale === "ja") {
    const head = `「${title}」は ${artist} の AstroDX 譜面で、「${branch}」分類に収録されています${genre ? `（ジャンル: ${genre}）` : ""}${bpm ? `。BPM ${bpm}` : ""}。`;
    const body = `本アーカイブでは ${count} 個の難易度${range ? `（レベル ${range.low}〜${range.high}）` : ""}${assetClause}を掲載し、オンラインで閲覧・ダウンロードできます。`;
    return head + body;
  }
  const head = `"${title}" is an AstroDX chart by ${artist}, archived under the "${branch}" branch${genre ? `, genre ${genre}` : ""}${bpm ? `, BPM ${bpm}` : ""}.`;
  const body = ` The AstroDX Archive lists ${count} difficult${count === 1 ? "y" : "ies"}${range ? ` (levels ${range.low}–${range.high})` : ""}${assetClause}, available to browse and download.`;
  return head + body;
}
