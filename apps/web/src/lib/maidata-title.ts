/**
 * Pack-time `maidata.txt` normalization: kind markers become spaced title
 * suffixes, and — by device-local preference — community aliases ride along in
 * the title while decimal chart constants collapse to display levels.
 *
 * AstroDX's level list shows nothing but `&title`, so a song's standard and DX
 * charts — whose titles are identical upstream — are indistinguishable in-game
 * once both are installed. Standard charts get a ` [SD]` suffix, mirroring
 * SimaiHub's convention ("SD" is the ecosystem's abbreviation — diving-fish's
 * `type` field, prober bots, SimaiHub filenames — and since 2026-08 the
 * catalog's `cabinet` value too); DX charts stay unmarked. UTAGE titles come
 * with a `[X]` kanji PREFIX upstream — that marker moves to the end
 * ("[即]ジングルベル" → "ジングルベル [即]") so every marker sits in the same
 * place and the list alphabetizes by the actual song name.
 *
 * Two settings extend that output (see `useDownloadsStore`, both defaulting to
 * today's behaviour): `aliasesByShortId` appends the chart's community
 * nicknames after the kind marker — "ジングルベル [SD] (圣诞歌/铃儿响叮当)" —
 * so a chart can be found by alias inside AstroDX's search; `preciseLevels:
 * false` rewrites `&lv_N=13.7` to the display level `13+`, grouped exactly the
 * way the site's level filter groups constants.
 *
 * This runs on the bytes being packed into an archive, never on the stored
 * files: the served maidata, the chart preview, fingerprints and enrichment all
 * keep seeing the untagged original.
 *
 * The chart kind comes from `&shortid` inside the maidata itself (< 10000 is
 * standard, >= 100000 UTAGE by the stable maimai id convention), so this needs
 * nothing from the catalog and behaves sensibly for custom sources: no
 * shortid, no change. Aliases are looked up by that same id, which is what
 * keeps persisted jobs, history reruns and stale cached specs consistent.
 */
import type { AdxArchiveInput } from "./adx-archive-shared";
import { chartDownloadDirName, difficultyDisplayLevel } from "./catalog-shared";

const STANDARD_SHORT_ID_MAX = 10000;
const UTAGE_SHORT_ID_MIN = 100000;

/** `maidata.txt` at the archive root (single) or under a chart folder (batch). */
const MAIDATA_NAME = /(?:^|\/)maidata\.txt$/;

/** The numeric `&shortid` inside a maidata, or null when absent/non-numeric. */
function maidataShortid(text: string): string | null {
  const match = /^﻿?&shortid=([^\r\n]*)/m.exec(text);
  const shortid = match?.[1]?.trim() ?? "";
  return /^\d+$/.test(shortid) ? shortid : null;
}

/** ` (alias/alias)` — the parenthesised tail aliases are appended as. */
function aliasSuffix(aliases: readonly string[] | undefined): string {
  return aliases && aliases.length > 0 ? ` (${aliases.join("/")})` : "";
}

/** The kind-marker rewrite of a trimmed, non-empty title. */
function markTitle(title: string, id: number): string {
  if (id >= STANDARD_SHORT_ID_MAX && id < UTAGE_SHORT_ID_MIN) {
    return title; // DX stays unmarked by ruling.
  }
  if (id >= UTAGE_SHORT_ID_MIN) {
    // "[即]ジングルベル" → "ジングルベル [即]". A title without the bracket
    // prefix (or with nothing after it) is left alone; a moved marker leaves
    // no leading bracket behind, so a second pass is naturally a no-op.
    const moved = /^\[([^\]]+)\]\s*(\S.*)$/.exec(title);
    return moved ? `${moved[2]!.trimEnd()} [${moved[1]!}]` : title;
  }
  return title.endsWith("[SD]") ? title : `${title} [SD]`;
}

/**
 * Returns the maidata text with the title tagged (and, given `aliases`, the
 * alias tail appended after the marker), or the input string itself (`===`)
 * when there is nothing to do — callers use the identity to skip rebuilding
 * the Blob.
 */
export function tagMaidataTitle(text: string, aliases?: readonly string[]): string {
  const shortid = maidataShortid(text);
  if (shortid === null) {
    return text;
  }
  const id = Number(shortid);
  const suffix = aliasSuffix(aliases);

  return text.replace(/^(﻿?&title=)([^\r\n]*)/m, (line, prefix: string, value: string) => {
    const title = value.trimEnd();
    if (title === "") {
      return line;
    }
    // An alias tail from an earlier pass is peeled off so the marker logic sees
    // the bare title, then put back — which is what keeps a second pass a no-op.
    const bare =
      suffix !== "" && title.endsWith(suffix)
        ? title.slice(0, -suffix.length).trimEnd()
        : title;
    const next = `${markTitle(bare, id)}${suffix}`;
    return next === title ? line : `${prefix}${next}`;
  });
}

/**
 * Rewrites every `&lv_N=` decimal chart constant ("13.7") to its display level
 * ("13+"), the grouping `difficultyDisplayLevel` uses for the site's level
 * filter. Anything that is not a plain decimal — "13+", utage "13?"/"13+?", an
 * empty field — is left byte-identical, and so is every other field.
 */
export function collapseMaidataLevels(text: string): string {
  return text.replace(/^(﻿?&lv_\d+=)([^\r\n]*)/gm, (line, prefix: string, value: string) => {
    const constant = value.trim();
    if (!/^\d+\.\d+$/.test(constant)) {
      return line;
    }
    const display = difficultyDisplayLevel(constant);
    return display === null ? line : `${prefix}${value.replace(constant, display)}`;
  });
}

export type PackMaidataOptions = {
  /**
   * Community aliases keyed by `&shortid` (the `/charts/aliases.json`
   * manifest); null or absent appends nothing.
   */
  aliasesByShortId?: Readonly<Record<string, readonly string[]>> | null;
  /** Keep decimal chart constants (default); `false` collapses them to display levels. */
  preciseLevels?: boolean;
};

/** The whole pack-time rewrite of one maidata; the input string itself when nothing applies. */
export function packMaidata(text: string, options: PackMaidataOptions = {}): string {
  const shortid = maidataShortid(text);
  const aliases =
    shortid === null ? undefined : options.aliasesByShortId?.[String(Number(shortid))];
  const titled = tagMaidataTitle(text, aliases);
  return options.preciseLevels === false ? collapseMaidataLevels(titled) : titled;
}

/**
 * Maps a packed-archive input list through {@link packMaidata}.
 * Only `maidata.txt` entries are considered; untouched entries keep their exact
 * Blob instance. A maidata whose bytes do not round-trip through UTF-8 (legacy
 * encodings from custom sources decode with U+FFFD) is passed through unchanged
 * rather than corrupted by a decode/re-encode cycle.
 */
export async function packMaidataInputs(
  inputs: AdxArchiveInput[],
  options: PackMaidataOptions = {}
): Promise<AdxArchiveInput[]> {
  return Promise.all(
    inputs.map(async (input) => {
      if (!MAIDATA_NAME.test(input.name)) {
        return input;
      }
      const text = await input.blob.text();
      if (text.includes("�")) {
        return input;
      }
      const packed = packMaidata(text, options);
      if (packed === text) {
        return input;
      }
      return { ...input, blob: new Blob([packed]) };
    })
  );
}

/**
 * Heals a chart folder name that predates the id-prefix naming: specs served
 * from a stale SW cache, persisted jobs and download-history reruns replay
 * their stored `dir` verbatim, which would quietly reintroduce the same-name
 * overwrite bug the prefix exists to fix. The shortid comes out of the chart's
 * own maidata at pack time, and `chartDownloadDirName` reapplies the exact
 * naming rules (zero-padding, byte budget). A dir that already carries a
 * 6-digit prefix — or a maidata without a usable shortid — passes through
 * unchanged.
 */
export function chartDirWithMaidataId(dir: string, maidataText: string): string {
  const trimmed = dir.trim();
  if (/^\d{6} /.test(trimmed)) {
    return dir;
  }
  const shortid = maidataShortid(maidataText);
  if (shortid === null) {
    return dir;
  }
  return chartDownloadDirName({ short_id: shortid, remote_dir_name: trimmed });
}
