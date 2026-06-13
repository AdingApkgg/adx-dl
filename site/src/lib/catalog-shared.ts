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
