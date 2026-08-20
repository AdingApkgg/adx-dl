/**
 * Pack-time `&title` tagging for standard (SD) charts.
 *
 * AstroDX's level list shows nothing but `&title`, so a song's standard and DX
 * charts — whose titles are identical upstream — are indistinguishable in-game
 * once both are installed. The fix mirrors SimaiHub's convention, which players
 * already know: standard charts get a ` [SD]` suffix ("SD" is the ecosystem's
 * abbreviation — diving-fish's `type` field, prober bots, SimaiHub filenames —
 * and since 2026-08 the catalog's `cabinet` value too), DX charts stay
 * unmarked, and UTAGE titles already carry their `[X]` kanji prefix.
 *
 * This runs on the bytes being packed into an archive, never on the stored
 * files: the served maidata, the chart preview, fingerprints and enrichment all
 * keep seeing the untagged original.
 *
 * The chart kind comes from `&shortid` inside the maidata itself (< 10000 is
 * standard by the stable maimai id convention), so this needs nothing from the
 * catalog and behaves sensibly for custom sources: no shortid, no tag.
 */
import type { AdxArchiveInput } from "./adx-archive-shared";

const STANDARD_SHORT_ID_MAX = 10000;

/** `maidata.txt` at the archive root (single) or under a chart folder (batch). */
const MAIDATA_NAME = /(?:^|\/)maidata\.txt$/;

/**
 * Returns the maidata text with the title tagged, or the input string itself
 * (`===`) when there is nothing to do — callers use the identity to skip
 * rebuilding the Blob.
 */
export function tagStandardMaidataTitle(text: string): string {
  const shortidMatch = /^﻿?&shortid=([^\r\n]*)/m.exec(text);
  if (!shortidMatch) {
    return text;
  }
  const shortid = shortidMatch[1]!.trim();
  if (!/^\d+$/.test(shortid) || Number(shortid) >= STANDARD_SHORT_ID_MAX) {
    return text;
  }

  return text.replace(/^(﻿?&title=)([^\r\n]*)/m, (line, prefix: string, value: string) => {
    const title = value.trimEnd();
    if (title === "" || title.endsWith("[SD]")) {
      return line;
    }
    return `${prefix}${title} [SD]`;
  });
}

/**
 * Maps a packed-archive input list through {@link tagStandardMaidataTitle}.
 * Only `maidata.txt` entries are considered; untouched entries keep their exact
 * Blob instance. A maidata whose bytes do not round-trip through UTF-8 (legacy
 * encodings from custom sources decode with U+FFFD) is passed through unchanged
 * rather than corrupted by a decode/re-encode cycle.
 */
export async function tagStandardMaidataInputs(
  inputs: AdxArchiveInput[]
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
      const tagged = tagStandardMaidataTitle(text);
      if (tagged === text) {
        return input;
      }
      return { ...input, blob: new Blob([tagged]) };
    })
  );
}
