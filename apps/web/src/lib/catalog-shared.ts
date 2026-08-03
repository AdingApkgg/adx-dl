import { MAIMAI_VERSIONS, versionImageIndex } from "@/lib/version-image";

export type CatalogDifficulty = {
  slot: number;
  /** Official difficulty name from the source (Basic/Advanced/Expert/Master/Re:Master/Utage). */
  name?: string;
  level: string;
  designer: string;
};

export type CatalogEntryMedia = {
  entry_base_url: string;
  /** Remote original cover (used for page display and OG/social images). */
  cover_url: string;
  /** Local AVIF copy for on-page display (primary); empty when unconverted. */
  cover_avif?: string;
  /** Local WebP copy — fallback for browsers without AVIF; empty when unconverted. */
  cover_webp?: string;
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
  /** maimai version index (0 = maimai … 26 = CiRCLE PLUS); used for release ordering. */
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
  /** Canonical page for this chart on the source site; travels with a copied entry. */
  page_url?: string;
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

/**
 * The card-level slice of a catalog entry: exactly what the browse grid, the
 * client search index and `ChartCard` consume. The heavy per-chart payload
 * (file specs, media/audio/PV URLs, license and source text) stays server-side;
 * batch downloads fetch it lazily from the static specs JSON endpoints.
 */
export type CatalogCardEntry = Pick<
  CatalogEntry,
  | "id"
  | "slug"
  | "title"
  | "title_en"
  | "artist"
  | "artist_en"
  | "category"
  | "subcategory"
  | "version"
  | "versionid"
  | "genre"
  | "genreid"
  | "cabinet"
  | "short_id"
  | "aliases"
  | "bpm"
  | "assets"
  | "difficulties"
> & {
  media: Pick<CatalogEntryMedia, "cover_url" | "cover_avif" | "cover_webp">;
};

/** Project a full entry down to the card slice (optional keys omitted when empty
 * so they don't cost bytes in the serialized page payload). */
export function toCatalogCardEntry(entry: CatalogEntry): CatalogCardEntry {
  return {
    id: entry.id,
    ...(entry.slug ? { slug: entry.slug } : {}),
    title: entry.title,
    ...(entry.title_en ? { title_en: entry.title_en } : {}),
    artist: entry.artist,
    ...(entry.artist_en ? { artist_en: entry.artist_en } : {}),
    category: entry.category,
    subcategory: entry.subcategory,
    version: entry.version,
    ...(entry.versionid !== undefined ? { versionid: entry.versionid } : {}),
    genre: entry.genre,
    ...(entry.genreid !== undefined ? { genreid: entry.genreid } : {}),
    cabinet: entry.cabinet,
    short_id: entry.short_id,
    ...(entry.aliases?.length ? { aliases: entry.aliases } : {}),
    bpm: entry.bpm,
    assets: entry.assets,
    difficulties: entry.difficulties,
    media: {
      cover_url: entry.media.cover_url,
      ...(entry.media.cover_avif ? { cover_avif: entry.media.cover_avif } : {}),
      ...(entry.media.cover_webp ? { cover_webp: entry.media.cover_webp } : {}),
    },
  };
}

export type CatalogCategories = Record<string, string[]>;

export type Catalog = {
  generated_at: string;
  /** Attribution block written by the builder so a copied index.json keeps its source. */
  source?: string;
  license?: string;
  license_url?: string;
  attribution?: string;
  total_entries: number;
  categories: CatalogCategories;
  entries: CatalogEntry[];
};

export type ChartAssetFile = { name: string; url: string };

function chartRouteId(entry: Pick<CatalogEntry, "id" | "slug" | "short_id">): string {
  return entry.slug?.trim() || entry.short_id?.trim() || entry.id;
}

export function localChartAssetUrl(
  entry: Pick<CatalogEntry, "id" | "slug" | "short_id">,
  fileName: "bg.png" | "maidata.txt"
): string {
  return `/adxcs/${encodeURIComponent(chartRouteId(entry))}/${fileName}`;
}

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
    entry.files.maidata
      ? { name: "maidata.txt", url: localChartAssetUrl(entry, "maidata.txt") }
      : null,
    { name: "track.mp3", url: entry.media.audio_url },
    entry.media.cover_url ? { name: "bg.png", url: entry.media.cover_url } : null,
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

/**
 * A chart's in-archive folder name plus its packable asset files (full set,
 * incl. video). `groupDir` optionally inserts a grouping folder between the
 * batch root and the chart folder, e.g. a version name in multi-version packs.
 * `genreDir` is the alternative grouping folder for genre-organized batches.
 */
export type ChartDownloadSpec = {
  dir: string;
  files: ChartAssetFile[];
  groupDir?: string;
  genreDir?: string;
};

export function getChartDownloadSpec(entry: CatalogEntry): ChartDownloadSpec {
  return {
    dir: entry.remote_dir_name,
    files: getChartAssetFiles(entry),
    groupDir: versionGroupFolderName(entry.version),
    genreDir: genreGroupFolderName(entry),
  };
}

/**
 * Genre grouping folder for downloads, using the canonical in-game (JP) genre
 * name. Slashes are normalized so a raw genre string can never nest folders.
 */
export function genreGroupFolderName(
  entry: { genreid?: number; genre?: string },
  unknownLabel = "Unknown"
): string {
  const name = genreInfo(entry)?.ja ?? entry.genre?.trim() ?? "";
  return name === "" ? unknownLabel : name.replace(/[\\/]+/g, "／");
}

export function formatEntryTitle(
  entry: Pick<CatalogEntry, "title" | "title_en">,
  locale: "zh" | "en" | "ja"
): string {
  if (locale === "en" && entry.title_en) {
    return entry.title_en;
  }
  return entry.title;
}

export function formatEntryArtist(
  entry: Pick<CatalogEntry, "artist" | "artist_en">,
  locale: "zh" | "en" | "ja"
): string {
  if (locale === "en" && entry.artist_en) {
    return entry.artist_en;
  }
  return entry.artist;
}

export function formatEntrySubcategory(
  entry: Pick<CatalogEntry, "category" | "version" | "cabinet" | "subcategory">
): string {
  if (entry.category === "Remote") {
    const remoteBranch = [entry.version, entry.cabinet].filter(Boolean).join(" / ");
    if (remoteBranch) {
      return remoteBranch;
    }
  }

  return entry.subcategory;
}

/** The release-ordering slice; both full and card entries satisfy it. */
type ReleaseOrderable = Pick<CatalogEntry, "versionid" | "cabinet" | "short_id">;

export function isUtageEntry(entry: Pick<CatalogEntry, "cabinet">): boolean {
  const cabinet = entry.cabinet?.trim();
  return Boolean(cabinet) && cabinet !== "DX" && cabinet !== "ST";
}

// Newest-first comparator. There is no per-song release date, so order by the
// maimai version era (versionid, newest first). Within a version, show standard
// (DX/ST) charts before UTAGE specials — UTAGE song ids carry a large offset
// that would otherwise push these niche charts to the very top — then by song id.
export function compareByReleaseDesc(a: ReleaseOrderable, b: ReleaseOrderable): number {
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

export function sortByReleaseDesc<T extends ReleaseOrderable>(entries: T[]): T[] {
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

/** Stable id for the untagged version bucket. */
export const UNKNOWN_VERSION_ROUTE_ID = "unknown";

const KNOWN_VERSION_INDEXES = new Set(MAIMAI_VERSIONS.map((version) => version.index));

/** Whether a value is one of the canonical maimai version ids (currently 0–26). */
export function isKnownVersionIndex(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    KNOWN_VERSION_INDEXES.has(value)
  );
}

/**
 * Resolve a chart's stable version id. New catalog data uses `versionid`;
 * older data falls back to the canonical version name.
 */
export function resolveVersionIndex(
  entry: Pick<CatalogEntry, "versionid" | "version">
): number | null {
  return isKnownVersionIndex(entry.versionid)
    ? entry.versionid
    : versionImageIndex(entry.version);
}

/**
 * Stable URL value for a version: the maimai versionid (0–26, the same value
 * stored in each chart's maidata `&versionid=`), or "unknown" for the untagged
 * bucket. It is shared by legacy route redirects and catalog query parameters.
 */
export function versionRouteId(versionIndex: number | null): string {
  return versionIndex === null ? UNKNOWN_VERSION_ROUTE_ID : String(versionIndex);
}

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

// The same difficulty palette as DIFFICULTY_TONE_CLASS, as raw colour values so
// it can go inside a CSS gradient (a Tailwind class can't). oklch to match what
// Tailwind emits, which also keeps gradient interpolation smooth.
export const DIFFICULTY_TONE_COLOR: Record<DifficultyTone, string> = {
  basic: "oklch(0.696 0.17 162.48)",
  advanced: "oklch(0.769 0.188 70.08)",
  expert: "oklch(0.645 0.246 16.439)",
  master: "oklch(0.606 0.25 292.717)",
  remaster: "oklch(0.74 0.238 322.16)",
  utage: "oklch(0.656 0.241 354.308)",
  default: "oklch(0.554 0.046 257.417)",
};

/**
 * The difficulty tone a *display level* reads as ("13+" → master).
 *
 * The level a chart sits at tracks its difficulty slot closely enough that low
 * levels read Basic-green and top levels Re:Master-violet, which is what lets
 * the level filter's track be a meaningful gradient rather than a decoration.
 */
export function levelDisplayTone(level: string): DifficultyTone {
  const base = Number.parseInt(level, 10);
  if (!Number.isFinite(base)) return "default";
  if (base <= 5) return "basic";
  if (base <= 8) return "advanced";
  if (base <= 11) return "expert";
  if (base <= 13) return "master";
  return "remaster";
}

/**
 * A CSS gradient across the given display levels, one colour stop per level.
 *
 * Per-level stops (rather than five broad bands) keep each stop at the position
 * its level actually occupies on the slider, so the colour under a thumb is the
 * colour of the level it is on.
 */
export function buildLevelGradient(levels: readonly string[]): string {
  if (levels.length === 0) {
    return `linear-gradient(90deg, ${DIFFICULTY_TONE_COLOR.default}, ${DIFFICULTY_TONE_COLOR.default})`;
  }
  if (levels.length === 1) {
    const only = DIFFICULTY_TONE_COLOR[levelDisplayTone(levels[0])];
    return `linear-gradient(90deg, ${only}, ${only})`;
  }
  const stops = levels.map((level, index) => {
    const percent = (index / (levels.length - 1)) * 100;
    return `${DIFFICULTY_TONE_COLOR[levelDisplayTone(level)]} ${percent.toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

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

/**
 * Collapse a raw level value into the display level players filter by.
 * The catalog stores chart constants ("13.4") and unverified markers ("13+?"),
 * over a hundred distinct strings — as a filter they group into "13"/"13+"
 * (a "+" level is a constant of x.6–x.9, or an explicit "+" suffix; official
 * "+" levels only exist from 7 up). Returns null for non-numeric levels.
 */
export function difficultyDisplayLevel(level: string): string | null {
  const match = level.trim().match(/^(\d+)(?:\.(\d))?(\+)?/);
  if (!match) {
    return null;
  }
  const base = Number(match[1]);
  const plus = match[3] === "+" || (match[2] !== undefined && Number(match[2]) >= 6);
  return base >= 7 && plus ? `${base}+` : `${base}`;
}

// The highest base level that has an official "+" tier. maimai runs 7+ … 14+;
// there is no 15+, so an unverified "15?" spans nothing beyond plain 15.
const MAX_PLUS_LEVEL = 14;

/**
 * The display levels a raw level value occupies, low first.
 *
 * Normally one: a constant of 13.4 is exactly "13". UTAGE charts are the
 * exception — they carry unverified levels like "13?", which have no constant
 * behind them at all, only "somewhere in level 13". Those cover the level whole,
 * i.e. both "13" and "13+", so filtering for either finds them. An explicit
 * "13+?" is already committed to the upper tier and stays single.
 */
export function difficultyDisplayLevels(level: string): string[] {
  const display = difficultyDisplayLevel(level);
  if (!display) {
    return [];
  }
  // "13?" — a bare base with a question mark, as opposed to "13+?" or "13.4".
  const isUnverifiedWholeLevel = /^\s*\d+\s*\?/.test(level);
  if (!isUnverifiedWholeLevel) {
    return [display];
  }
  const base = Number.parseInt(level.trim(), 10);
  return base >= 7 && base <= MAX_PLUS_LEVEL ? [`${base}`, `${base}+`] : [display];
}

/**
 * Distinct display levels across entries, sorted ascending in play order
 * ("12" < "12+" < "13"). Drives the level filter's option list.
 */
export function collectDifficultyLevels(
  entries: ReadonlyArray<Pick<CatalogEntry, "difficulties">>
): string[] {
  const levels = new Set<string>();
  for (const entry of entries) {
    for (const difficulty of entry.difficulties) {
      for (const level of difficultyDisplayLevels(difficulty.level ?? "")) {
        levels.add(level);
      }
    }
  }
  return [...levels].sort((a, b) => levelSortValue(a) - levelSortValue(b));
}

/**
 * True when any difficulty overlaps the display-level range [low, high].
 *
 * Compared on the sort value, so "12+" sits between "12" and "13" the way the
 * filter's slider shows it — a plain string compare would put "12+" after "13".
 *
 * Overlap rather than containment because a difficulty can span more than one
 * display level: an unverified UTAGE "13?" occupies both "13" and "13+" (see
 * difficultyDisplayLevels), so it answers a filter for either.
 */
export function entryHasLevelInRange(
  entry: Pick<CatalogEntry, "difficulties">,
  low: string,
  high: string
): boolean {
  const lowValue = levelSortValue(low);
  const highValue = levelSortValue(high);
  return entry.difficulties.some((difficulty) => {
    const spanned = difficultyDisplayLevels(difficulty.level ?? "");
    if (spanned.length === 0) {
      return false;
    }
    const spanLow = levelSortValue(spanned[0]);
    const spanHigh = levelSortValue(spanned[spanned.length - 1]);
    return spanHigh >= lowValue && spanLow <= highValue;
  });
}

/** Cabinet grouped into the three player-facing buckets used by the filter:
 *  DX (でらっくす), ST (standard), and everything else → UTAGE (宴). The catalog
 *  itself stores the real cabinet string (DX/ST, or a 宴 kanji like 協/奏), so
 *  these bucket ids exist only in the filter UI and its query params. */
export type CabinetBucket = "DX" | "ST" | "UTAGE";
export function cabinetBucket(cabinet: string): CabinetBucket {
  const key = cabinet.trim();
  if (key === "DX") return "DX";
  if (key === "ST") return "ST";
  return "UTAGE";
}

const CABINET_BUCKETS: readonly CabinetBucket[] = ["DX", "ST", "UTAGE"];
/** Bucket ids this filter answered to before; kept so shared links keep working. */
const LEGACY_CABINET_IDS: Record<string, CabinetBucket> = { UTG: "UTAGE" };

/** Resolve a `?cabinet=` value to a bucket id, or null when it names none. */
export function normalizeCabinetId(value: string): CabinetBucket | null {
  const key = value.trim();
  if ((CABINET_BUCKETS as readonly string[]).includes(key)) {
    return key as CabinetBucket;
  }
  return LEGACY_CABINET_IDS[key] ?? null;
}

/** The 宴会場 genre. Every chart carrying it is a UTAGE chart and vice versa. */
export const UTAGE_GENRE_ID = 107;
/** The Type-row bucket that selects exactly the 宴会場 charts. */
export const UTAGE_CABINET: CabinetBucket = "UTAGE";

/**
 * The browse-filter query string that selects one genre.
 *
 * 宴会場 (107) is filtered from the Type row, not the genre row — the two select
 * the same charts and only the Type row has a chip for it — so a genre link for
 * it has to point at the cabinet filter, or it lands on a page where nothing is
 * highlighted. Every genre deep link goes through here so the two stay in step.
 */
export function genreFilterQuery(genreId: number): string {
  return genreId === UTAGE_GENRE_ID
    ? `cabinet=${UTAGE_CABINET}`
    : `genre=${genreId}`;
}

/** BPM buckets (ids match the `bpm` URL param values). */
export const BPM_BUCKETS: ReadonlyArray<{ id: string; label: string; min: number; max: number }> = [
  { id: "0", label: "≤ 120", min: 0, max: 120 },
  { id: "1", label: "121–160", min: 121, max: 160 },
  { id: "2", label: "161–200", min: 161, max: 200 },
  { id: "3", label: "201+", min: 201, max: Infinity },
];
export function bpmBucketId(bpm: number | null | undefined): string | null {
  if (typeof bpm !== "number" || !Number.isFinite(bpm)) return null;
  const bucket = BPM_BUCKETS.find((b) => bpm >= b.min && bpm <= b.max);
  return bucket ? bucket.id : null;
}

/**
 * Bucket tint, slow (cool) → fast (warm), keyed by bucket id. Shared so a
 * chart's BPM reads the same colour on its detail page as in the browse filter
 * row — same idea as GENRES[].badge for genres.
 */
export const BPM_TONE: Record<string, string> = {
  "0": "border-sky-500/40 bg-sky-500/12 text-sky-700 dark:text-sky-300",
  "1": "border-teal-500/40 bg-teal-500/12 text-teal-700 dark:text-teal-300",
  "2": "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "3": "border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300",
};

/**
 * The BPM_TONE ramp as a gradient, in the filter slider's visual order: fast
 * (warm) on the left down to slow (cool) on the right, matching the level
 * slider, which also runs hardest-first.
 */
export const BPM_GRADIENT =
  "linear-gradient(90deg, oklch(0.645 0.246 16.439) 0%, oklch(0.769 0.188 70.08) 33%, oklch(0.704 0.14 182.503) 66%, oklch(0.685 0.169 237.323) 100%)";

/** An inclusive [low, high] selection over an ordered scale. */
export type FilterRange = readonly [number, number];

/** Whether a range covers its whole scale, i.e. filters nothing out. */
export function isFullRange(range: FilterRange, bounds: FilterRange): boolean {
  return range[0] <= bounds[0] && range[1] >= bounds[1];
}

/** Clamp a range into bounds and order its ends. */
export function clampRange(range: FilterRange, bounds: FilterRange): FilterRange {
  const low = Math.min(Math.max(range[0], bounds[0]), bounds[1]);
  const high = Math.min(Math.max(range[1], bounds[0]), bounds[1]);
  return low <= high ? [low, high] : [high, low];
}

/** Serialize a range as the `low-high` query value the filters use. */
export function formatRangeParam(range: FilterRange): string {
  return `${range[0]}-${range[1]}`;
}

/**
 * Read a `low-high` range param.
 *
 * Returns null when the value names no usable range, so the caller keeps its
 * default rather than applying an invisible filter.
 */
export function parseRangeParam(raw: string, bounds: FilterRange): FilterRange | null {
  const match = raw.trim().match(/^(-?\d+)-(-?\d+)$/);
  if (!match) {
    return null;
  }
  const low = Number(match[1]);
  const high = Number(match[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return null;
  }
  return clampRange([low, high], bounds);
}

/**
 * Read the `bpm` param, accepting both the range form and the bucket-id list it
 * replaced (`bpm=1,2`), which detail pages linked and users shared. A bucket
 * list becomes the span from the lowest bucket's floor to the highest one's
 * ceiling — contiguous or not, since a range cannot express a gap.
 */
export function parseBpmParam(raw: string, bounds: FilterRange): FilterRange | null {
  const asRange = parseRangeParam(raw, bounds);
  if (asRange) {
    return asRange;
  }
  const buckets = raw
    .split(",")
    .map((id) => BPM_BUCKETS.find((bucket) => bucket.id === id.trim()))
    .filter((bucket): bucket is (typeof BPM_BUCKETS)[number] => bucket !== undefined);
  if (buckets.length === 0) {
    return null;
  }
  const low = Math.min(...buckets.map((bucket) => bucket.min));
  const high = Math.max(...buckets.map((bucket) => bucket.max));
  // The top bucket is open-ended (max Infinity); cap it at the catalog's fastest.
  return clampRange([low, Number.isFinite(high) ? high : bounds[1]], bounds);
}

/**
 * Read the `level` param as indices into `levels` (ascending display levels),
 * accepting both the range form (`level=8-14`, by level *label*) and the label
 * list it replaced (`level=13,14+`). A list becomes the span from its lowest to
 * its highest label.
 */
export function parseLevelParam(
  raw: string,
  levels: readonly string[]
): FilterRange | null {
  if (levels.length === 0) {
    return null;
  }
  const bounds: FilterRange = [0, levels.length - 1];
  const indexOf = (label: string) => levels.indexOf(label.trim());

  const rangeMatch = raw.trim().match(/^([^-]+)-([^-]+)$/);
  if (rangeMatch) {
    const low = indexOf(rangeMatch[1]);
    const high = indexOf(rangeMatch[2]);
    if (low >= 0 && high >= 0) {
      return clampRange([low, high], bounds);
    }
  }

  const picked = raw
    .split(",")
    .map((label) => indexOf(label))
    .filter((index) => index >= 0);
  if (picked.length === 0) {
    return null;
  }
  return clampRange([Math.min(...picked), Math.max(...picked)], bounds);
}

function compactVersionName(name: string): string {
  const trimmed = name.trim();
  if (/^maimai$/i.test(trimmed)) {
    return "maimai";
  }
  if (/^maimai\s+DX$/i.test(trimmed)) {
    return "DX";
  }
  if (/^maimai\s+DX\s+PLUS$/i.test(trimmed)) {
    return "DX PLUS";
  }
  if (/^maimai\s+DX\s+/i.test(trimmed)) {
    return trimmed.replace(/^maimai\s+DX\s+/i, "").trim() || trimmed;
  }
  return trimmed.replace(/^maimai\s+/i, "").trim() || trimmed;
}

/**
 * Compact version folder name for downloads: a stable 00-26 order prefix plus
 * the agreed short version name.
 */
export function versionFolderName(name: string): string {
  const compact = compactVersionName(name);
  const index = versionImageIndex(name);
  return index === null ? compact : `${String(index).padStart(2, "0")} ${compact}`;
}

/** Folder inserted above chart folders in every archive, including single-chart downloads. */
export function versionGroupFolderName(
  version: string | null | undefined,
  unknownLabel = "Unknown"
): string {
  const index = versionImageIndex(version);
  if (index === null) {
    return unknownLabel;
  }

  const canonicalName =
    MAIMAI_VERSIONS.find((candidate) => candidate.index === index)?.name ??
    version ??
    unknownLabel;
  return versionFolderName(canonicalName);
}

/** Version name shortened for tight UI spaces, without the download order prefix. */
export function versionShortName(name: string): string {
  return compactVersionName(name);
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
  const body = ` This archive lists ${count} difficult${count === 1 ? "y" : "ies"}${range ? ` (levels ${range.low}–${range.high})` : ""}${assetClause}, available to browse and download.`;
  return head + body;
}

// Unique real chart-designer (谱师) names across an entry's difficulties, in slot
// order. Skips the "-"/empty placeholders the source uses when a designer is
// unknown and dedupes names shared across difficulty slots — so JSON-LD credits
// each author once and never emits a bogus "-" Person.
export function uniqueChartDesigners(entry: {
  difficulties: { designer?: string }[];
}): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const difficulty of entry.difficulties) {
    const name = (difficulty.designer ?? "").trim();
    if (!name || name === "-" || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}
