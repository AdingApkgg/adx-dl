export type CatalogDifficulty = {
  slot: number;
  /** Official difficulty name from the source (Basic/Advanced/Expert/Master/Re:Master/Utage). */
  name?: string;
  level: string;
  designer: string;
};

export type CatalogEntryMedia = {
  entry_base_url: string;
  /** Remote original cover (used by the .adx download and OG/social images). */
  cover_url: string;
  /** Local lossless-AVIF copy for on-page display; empty when unconverted. */
  cover_avif?: string;
  audio_url: string;
  pv_url: string;
};

export type CatalogEntry = {
  id: string;
  /** Canonical route slug: the unique maimai song id (shortid). */
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
  /** maimai version index (0 = maimai … 25 = CiRCLE); used for release ordering. */
  versionid?: number;
  genre: string;
  /** maimai genre id (101–107); stable key for genre color + localized label. */
  genreid?: number;
  cabinet: string;
  short_id: string;
  /** Community nicknames (别名) for the song; used to find a chart by an alternate name. */
  aliases?: string[];
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

export type ChartAssetFile = { name: string; url: string };

/**
 * The files packed into a chart's .adx download, named as the AstroDX app expects.
 * Shared by the single-chart download and the batch (multi-chart) download.
 */
export function getChartAssetFiles(
  entry: CatalogEntry,
  options: { includeVideo?: boolean } = {}
): ChartAssetFile[] {
  const includeVideo = options.includeVideo ?? true;
  const candidates: (ChartAssetFile | null)[] = [
    { name: "maidata.txt", url: entry.files.maidata },
    { name: "track.mp3", url: entry.media.audio_url },
    { name: "bg.png", url: entry.media.cover_url },
    includeVideo ? { name: "pv.mp4", url: entry.media.pv_url } : null,
  ];
  return candidates.filter((file): file is ChartAssetFile => Boolean(file && file.url));
}

/** Background-animation (BGA) movie extensions; offered as an optional batch exclusion. */
export const CHART_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"];

export function isChartVideoFile(name: string): boolean {
  const lower = name.toLowerCase();
  return CHART_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** A chart's in-archive folder name plus its packable asset files (full set, incl. video). */
export type ChartDownloadSpec = { dir: string; files: ChartAssetFile[] };

export function getChartDownloadSpec(entry: CatalogEntry): ChartDownloadSpec {
  return { dir: entry.remote_dir_name, files: getChartAssetFiles(entry) };
}

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

function isUtageEntry(entry: CatalogEntry): boolean {
  const cabinet = entry.cabinet?.trim();
  return Boolean(cabinet) && cabinet !== "DX" && cabinet !== "ST";
}

// Newest-first comparator. There is no per-song release date, so order by the
// maimai version era (versionid, newest first). Within a version, show standard
// (DX/ST) charts before UTAGE specials — UTAGE song ids carry a large offset
// that would otherwise push these niche charts to the very top — then by song id.
export function compareByReleaseDesc(a: CatalogEntry, b: CatalogEntry): number {
  const versionA = a.versionid ?? -1;
  const versionB = b.versionid ?? -1;
  if (versionA !== versionB) {
    return versionB - versionA;
  }
  const utageA = isUtageEntry(a) ? 1 : 0;
  const utageB = isUtageEntry(b) ? 1 : 0;
  if (utageA !== utageB) {
    return utageA - utageB;
  }
  const idA = Number(a.short_id) || 0;
  const idB = Number(b.short_id) || 0;
  return idB - idA;
}

export function sortByReleaseDesc(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort(compareByReleaseDesc);
}

// maimai genres, keyed by genreid (101–107). Localized names + a colored chip
// (literal class strings so Tailwind's scanner emits them). 107 (宴会場) is the
// UTAGE genre — already conveyed by the cabinet icon, so its chip is suppressed.
export type GenreInfo = {
  id: number;
  slug: string;
  zh: string;
  en: string;
  ja: string;
  badge: string;
  dot: string;
};

export const GENRES: Record<number, GenreInfo> = {
  101: {
    id: 101,
    slug: "pops-anime",
    ja: "POPS＆アニメ",
    zh: "流行＆动画",
    en: "POPS & Anime",
    badge: "border-sky-500/40 bg-sky-500/12 text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
  },
  102: {
    id: 102,
    slug: "niconico-vocaloid",
    ja: "niconico＆ボーカロイド",
    zh: "niconico＆VOCALOID",
    en: "niconico & VOCALOID",
    badge: "border-cyan-500/40 bg-cyan-500/12 text-cyan-700 dark:text-cyan-300",
    dot: "bg-cyan-500",
  },
  103: {
    id: 103,
    slug: "touhou",
    ja: "東方Project",
    zh: "东方Project",
    en: "Touhou Project",
    badge: "border-red-500/40 bg-red-500/12 text-red-600 dark:text-red-300",
    dot: "bg-red-500",
  },
  104: {
    id: 104,
    slug: "game-variety",
    ja: "ゲーム＆バラエティ",
    zh: "游戏＆综合",
    en: "Game & Variety",
    badge: "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  105: {
    id: 105,
    slug: "maimai",
    ja: "maimai",
    zh: "maimai",
    en: "maimai",
    badge: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  106: {
    id: 106,
    slug: "ongeki-chunithm",
    ja: "オンゲキ＆CHUNITHM",
    zh: "音击＆中二节奏",
    en: "ONGEKI & CHUNITHM",
    badge: "border-violet-500/45 bg-violet-500/15 text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500",
  },
  107: {
    id: 107,
    slug: "utage",
    ja: "宴会場",
    zh: "宴会场",
    en: "UTAGE",
    badge: "border-pink-500/45 bg-pink-500/15 text-pink-700 dark:text-pink-300",
    dot: "bg-pink-500",
  },
};

// Fallback id lookup by the (stable) JP genre string, for entries predating genreid.
const GENRE_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.values(GENRES).map((info) => [info.ja, info.id])
);

export function resolveGenreId(entry: { genreid?: number; genre?: string }): number | null {
  if (typeof entry.genreid === "number" && GENRES[entry.genreid]) {
    return entry.genreid;
  }
  const byName = entry.genre ? GENRE_NAME_TO_ID[entry.genre.trim()] : undefined;
  return byName ?? null;
}

export function genreInfo(entry: { genreid?: number; genre?: string }): GenreInfo | null {
  const id = resolveGenreId(entry);
  return id === null ? null : GENRES[id];
}

export function genreLabel(entry: { genreid?: number; genre?: string }, locale: EntryLocale): string {
  const info = genreInfo(entry);
  return info ? info[locale] : (entry.genre ?? "");
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

// Fallback difficulty labels by slot, used only when the catalog entry lacks the
// source-provided name. Source slots: 2 Basic / 3 Advanced / 4 Expert / 5 Master /
// 6 Re:Master / 7 Utage. The labels are official romanized proper nouns.
const MAIMAI_SLOT_LABELS: Record<number, string> = {
  2: "Basic",
  3: "Advanced",
  4: "Expert",
  5: "Master",
  6: "Re:Master",
  7: "U·TAGE",
};

export function difficultySlotLabel(difficulty: { slot: number; name?: string }): string {
  const name = difficulty.name?.trim();
  if (name) {
    return name;
  }
  return MAIMAI_SLOT_LABELS[difficulty.slot] ?? `Lv.${difficulty.slot}`;
}

// The iconic maimai difficulty colors, used to tint level pills and the detail
// table so players recognize Basic→Utage at a glance.
export type DifficultyTone =
  | "basic"
  | "advanced"
  | "expert"
  | "master"
  | "remaster"
  | "utage"
  | "default";

export function difficultyTone(difficulty: { slot: number; name?: string }): DifficultyTone {
  const name = (difficulty.name ?? "").toLowerCase();
  // Check the most specific names first (re:master contains "master").
  if (name.includes("re:master") || name.includes("remaster")) return "remaster";
  if (name.includes("master")) return "master";
  if (name.includes("expert")) return "expert";
  if (name.includes("advanced")) return "advanced";
  if (name.includes("basic")) return "basic";
  if (name.includes("utage") || name.includes("宴")) return "utage";
  switch (difficulty.slot) {
    case 2:
      return "basic";
    case 3:
      return "advanced";
    case 4:
      return "expert";
    case 5:
      return "master";
    case 6:
      return "remaster";
    case 7:
      return "utage";
    default:
      return "default";
  }
}

// Literal class strings (kept whole so Tailwind's scanner emits them). Tuned to
// read clearly on both the light and dark surfaces.
export const DIFFICULTY_TONE_CLASS: Record<DifficultyTone, string> = {
  basic: "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  advanced: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  expert: "border-rose-500/40 bg-rose-500/12 text-rose-600 dark:text-rose-300",
  master: "border-violet-500/45 bg-violet-500/15 text-violet-700 dark:text-violet-300",
  remaster: "border-fuchsia-400/45 bg-fuchsia-400/12 text-fuchsia-700 dark:text-fuchsia-200",
  utage: "border-pink-500/45 bg-pink-500/15 text-pink-700 dark:text-pink-300",
  default: "border-border bg-muted text-muted-foreground",
};

// Solid dot colors for the difficulty table.
export const DIFFICULTY_DOT_CLASS: Record<DifficultyTone, string> = {
  basic: "bg-emerald-500",
  advanced: "bg-amber-500",
  expert: "bg-rose-500",
  master: "bg-violet-500",
  remaster: "bg-fuchsia-400",
  utage: "bg-pink-500",
  default: "bg-muted-foreground",
};

// Levels can be plain ("13"), suffixed ("12+"), or decimal ("13.4").
function levelSortValue(level: string): number {
  const match = level.match(/^(\d+(?:\.\d+)?)(\+)?/);
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
  const genre = genreLabel(entry, locale);
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
  const body = ` ADX 谱面资源 lists ${count} difficult${count === 1 ? "y" : "ies"}${range ? ` (levels ${range.low}–${range.high})` : ""}${assetClause}, available to browse and download.`;
  return head + body;
}
