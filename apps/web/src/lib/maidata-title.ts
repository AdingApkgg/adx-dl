/**
 * Pack-time `&title` normalization: kind markers become spaced suffixes.
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
 * This runs on the bytes being packed into an archive, never on the stored
 * files: the served maidata, the chart preview, fingerprints and enrichment all
 * keep seeing the untagged original.
 *
 * The chart kind comes from `&shortid` inside the maidata itself (< 10000 is
 * standard, >= 100000 UTAGE by the stable maimai id convention), so this needs
 * nothing from the catalog and behaves sensibly for custom sources: no
 * shortid, no change.
 */
import type { AdxArchiveInput } from "./adx-archive-shared";
import { chartDownloadDirName } from "./catalog-shared";

const STANDARD_SHORT_ID_MAX = 10000;
const UTAGE_SHORT_ID_MIN = 100000;

/** `maidata.txt` at the archive root (single) or under a chart folder (batch). */
const MAIDATA_NAME = /(?:^|\/)maidata\.txt$/;

/**
 * Returns the maidata text with the title tagged, or the input string itself
 * (`===`) when there is nothing to do — callers use the identity to skip
 * rebuilding the Blob.
 */
/** The numeric `&shortid` inside a maidata, or null when absent/non-numeric. */
function maidataShortid(text: string): string | null {
  const match = /^﻿?&shortid=([^\r\n]*)/m.exec(text);
  const shortid = match?.[1]?.trim() ?? "";
  return /^\d+$/.test(shortid) ? shortid : null;
}

export function tagMaidataTitle(text: string): string {
  const shortid = maidataShortid(text);
  if (shortid === null) {
    return text;
  }
  const id = Number(shortid);
  if (id >= STANDARD_SHORT_ID_MAX && id < UTAGE_SHORT_ID_MIN) {
    return text; // DX stays unmarked by ruling.
  }

  return text.replace(/^(﻿?&title=)([^\r\n]*)/m, (line, prefix: string, value: string) => {
    const title = value.trimEnd();
    if (title === "") {
      return line;
    }
    if (id >= UTAGE_SHORT_ID_MIN) {
      // "[即]ジングルベル" → "ジングルベル [即]". A title without the bracket
      // prefix (or with nothing after it) is left alone; a moved marker leaves
      // no leading bracket behind, so a second pass is naturally a no-op.
      const moved = /^\[([^\]]+)\]\s*(\S.*)$/.exec(title);
      return moved ? `${prefix}${moved[2]!.trimEnd()} [${moved[1]!}]` : line;
    }
    if (title.endsWith("[SD]")) {
      return line;
    }
    return `${prefix}${title} [SD]`;
  });
}

/**
 * Maps a packed-archive input list through {@link tagMaidataTitle}.
 * Only `maidata.txt` entries are considered; untouched entries keep their exact
 * Blob instance. A maidata whose bytes do not round-trip through UTF-8 (legacy
 * encodings from custom sources decode with U+FFFD) is passed through unchanged
 * rather than corrupted by a decode/re-encode cycle.
 */
export async function tagMaidataInputs(inputs: AdxArchiveInput[]): Promise<AdxArchiveInput[]> {
  return Promise.all(
    inputs.map(async (input) => {
      if (!MAIDATA_NAME.test(input.name)) {
        return input;
      }
      const text = await input.blob.text();
      if (text.includes("�")) {
        return input;
      }
      const tagged = tagMaidataTitle(text);
      if (tagged === text) {
        return input;
      }
      return { ...input, blob: new Blob([tagged]) };
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
