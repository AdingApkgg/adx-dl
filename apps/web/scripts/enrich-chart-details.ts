/**
 * Post-build catalog enrichment: note counts, chart duration, BPM range,
 * download sizes and romaji.
 *
 * Runs AFTER `bun run build:catalog` (same slot as the Python `enrich_aliases`
 * step) and rewrites `data/catalog/index.json` in place. It lives here, in the
 * web workspace, for one reason: the note counts must come from the very same
 * simai parser the in-browser chart preview uses, or the detail page would
 * quote numbers the preview then contradicts. Re-implementing simai parsing in
 * the Python pipeline would have been a second source of truth.
 *
 * The fields it writes are all listed in build_catalog.py's fingerprint
 * exclusions, so re-running the Python build does not restamp every
 * `imported_at` just because enrichment had run.
 *
 * Usage:
 *   bun run scripts/enrich-chart-details.ts [--limit N] [--skip-sizes] [--concurrency N]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  getAvailableDifficulties,
  parseSimaiChart,
  type Chart,
  type ChartDifficulty,
} from "@lxns-network/maimai-chart-engine";

import type { CatalogNoteCounts } from "../src/lib/catalog-shared";
import { bpmRange, chartDurationMs, countNotes } from "../src/lib/chart-analysis";
import { romajiForSearch } from "../src/lib/romaji";

// Resolved from the workspace cwd the same way scripts/submit-indexnow.ts does,
// so `bun run --filter web enrich:details` works from the repo root too.
const CATALOG_PATH = path.resolve(process.cwd(), "..", "..", "data", "catalog", "index.json");

type RawDifficulty = {
  slot: number;
  name?: string;
  level: string;
  designer: string;
  notes?: CatalogNoteCounts;
  duration_ms?: number;
};

type RawEntry = {
  slug?: string;
  short_id: string;
  title: string;
  title_en?: string;
  title_romaji?: string;
  artist: string;
  artist_en?: string;
  artist_romaji?: string;
  bpm: number | null;
  bpm_min?: number | null;
  bpm_max?: number | null;
  duration_ms?: number | null;
  file_bytes?: Record<string, number>;
  files: Record<string, string>;
  difficulties: RawDifficulty[];
};

type Catalog = { entries: RawEntry[]; [key: string]: unknown };

function parseArgs() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(`--${name}`);
  const value = (name: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? Number(args[index + 1]) : undefined;
  };
  return {
    limit: value("limit"),
    concurrency: value("concurrency") ?? 24,
    skipSizes: flag("skip-sizes"),
    skipCharts: flag("skip-charts"),
  };
}

/** Bounded-concurrency map that keeps the pool full rather than running in waves. */
async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function fetchWithRetry(url: string, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      // 4xx is a real answer — retrying will not change it.
      if (response.ok || (response.status >= 400 && response.status < 500)) return response;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const META_RE = (key: string) => new RegExp(`^&${key}\\s*=(.*)$`, "im");

function readMeta(text: string, ...keys: string[]): string {
  for (const key of keys) {
    const match = text.match(META_RE(key));
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return "";
}

type ChartDetails = {
  perSlot: Map<number, { notes: CatalogNoteCounts; durationMs: number }>;
  durationMs: number;
  bpmMin: number | null;
  bpmMax: number | null;
  titleEn: string;
  artistEn: string;
};

function analyseMaidata(text: string): ChartDetails {
  const available = getAvailableDifficulties(text);
  const perSlot = new Map<number, { notes: CatalogNoteCounts; durationMs: number }>();
  let durationMs = 0;
  let bpmMin: number | null = null;
  let bpmMax: number | null = null;

  for (const key of Object.keys(available)) {
    const slot = Number(key) as ChartDifficulty;
    let chart: Chart;
    try {
      chart = parseSimaiChart(text, slot);
    } catch {
      // One unparseable difficulty must not cost us the others.
      continue;
    }
    const slotDuration = chartDurationMs(chart);
    perSlot.set(slot, { notes: countNotes(chart.notes), durationMs: slotDuration });
    if (slotDuration > durationMs) durationMs = slotDuration;
    const range = bpmRange(chart);
    if (range) {
      bpmMin = bpmMin === null ? range.min : Math.min(bpmMin, range.min);
      bpmMax = bpmMax === null ? range.max : Math.max(bpmMax, range.max);
    }
  }

  return {
    perSlot,
    durationMs,
    bpmMin,
    bpmMax,
    titleEn: readMeta(text, "en_title", "engtitle"),
    artistEn: readMeta(text, "en_artist", "engartist"),
  };
}

type FetchResource = (url: string, init?: RequestInit) => Promise<Response>;

async function contentLength(url: string, fetchResource: FetchResource): Promise<number | null> {
  try {
    const response = await fetchResource(url, { method: "HEAD" });
    if (!response.ok) return null;
    const header = response.headers.get("content-length");
    const bytes = header ? Number(header) : Number.NaN;
    return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export async function enrichEntries(
  entries: RawEntry[],
  options: { concurrency: number; skipCharts: boolean; skipSizes: boolean },
  fetchResource: FetchResource = fetchWithRetry,
) {
  let done = 0;
  let failed = 0;
  await mapPool(entries, options.concurrency, async (entry) => {
    const chartWork = async (): Promise<number | undefined> => {
      if (options.skipCharts) return;
      const url = entry.files?.maidata;
      if (!url) return;
      try {
        const response = await fetchResource(url);
        if (!response.ok) throw new Error(`${response.status}`);
        const text = await response.text();
        const details = analyseMaidata(text);
        // The maidata host serves gzipped, so a HEAD's content-length would be
        // the compressed size — and fetch hides it entirely. Measure the real
        // payload here, where we already have the bytes in hand.
        const maidataBytes = new TextEncoder().encode(text).length;

        for (const difficulty of entry.difficulties) {
          const slotDetails = details.perSlot.get(difficulty.slot);
          if (!slotDetails || slotDetails.notes.total === 0) {
            delete difficulty.notes;
            delete difficulty.duration_ms;
            continue;
          }
          difficulty.notes = slotDetails.notes;
          difficulty.duration_ms = slotDetails.durationMs;
        }
        entry.duration_ms = details.durationMs || null;
        entry.bpm_min = details.bpmMin;
        entry.bpm_max = details.bpmMax;
        if (details.titleEn) entry.title_en = details.titleEn;
        if (details.artistEn) entry.artist_en = details.artistEn;
        return maidataBytes;
      } catch (error) {
        failed += 1;
        console.warn(`[enrich] maidata failed for ${entry.short_id}: ${String(error)}`);
      }
    };
    // Each entry's independent HEAD requests overlap its maidata GET/analysis.
    // Limits per asset kind stay at the previous entry-pool concurrency.
    const sizeKeys = ["audio", "background", "pv"] as const;
    const sizeWork = async () => {
      if (options.skipSizes) return;
      const bytes: Record<string, number> = {};
      await Promise.all(
        sizeKeys.map(async (key) => {
          const url = entry.files?.[key];
          if (!url) return;
          const size = await contentLength(url, fetchResource);
          if (size !== null) bytes[key] = size;
        })
      );
      return bytes;
    };
    const [maidataBytes, bytes] = await Promise.all([chartWork(), sizeWork()]);
    if (bytes) {
      const maidata = maidataBytes ?? entry.file_bytes?.maidata;
      if (maidata) bytes.maidata = maidata;
      if (Object.keys(bytes).length > 0) entry.file_bytes = bytes;
      else delete entry.file_bytes;
    }
    done += 1;
    if (done % 200 === 0) console.log(`[enrich] entries ${done}/${entries.length}`);
  });
  if (!options.skipCharts) console.log(`[enrich] charts: ${entries.length - failed}/${entries.length} analysed`);
  if (!options.skipSizes) {
    const sized = entries.filter((entry) => entry.file_bytes).length;
    console.log(`[enrich] sizes: ${sized}/${entries.length} entries measured`);
  }
}

async function main() {
  const options = parseArgs();
  const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8")) as Catalog;
  const entries = options.limit ? catalog.entries.slice(0, options.limit) : catalog.entries;
  console.log(`[enrich] ${entries.length} entries, concurrency ${options.concurrency}`);

  // Romaji is local work — do it for everything regardless of the network flags.
  let romajiCount = 0;
  for (const entry of entries) {
    const title = romajiForSearch(entry.title);
    const artist = romajiForSearch(entry.artist);
    if (title) {
      entry.title_romaji = title;
      romajiCount += 1;
    } else {
      delete entry.title_romaji;
    }
    if (artist) entry.artist_romaji = artist;
    else delete entry.artist_romaji;
  }
  console.log(`[enrich] romaji: ${romajiCount}/${entries.length} titles transliterated`);
  const started = performance.now();
  await enrichEntries(entries, options);
  console.log(`[enrich] network/analysis: ${((performance.now() - started) / 1000).toFixed(3)} seconds`);

  await writeFile(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log(`[enrich] wrote ${CATALOG_PATH}`);
}

if (import.meta.main) await main();
