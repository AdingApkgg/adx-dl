/**
 * Pack-time `&title` tagging with the chart kind: ` [SD]` / ` [DX]`.
 *
 * AstroDX's level list shows nothing but `&title`, so a song's standard and DX
 * charts — whose titles are identical upstream — are indistinguishable in-game
 * once both are installed. Both kinds are tagged so every installed chart says
 * what it is outright ("SD" is the ecosystem's standard-chart abbreviation:
 * diving-fish's `type` field, the prober bots, SimaiHub — which marks SD the
 * same way but leaves DX bare; marking both was a deliberate choice here, an
 * unmarked row shouldn't need outside knowledge to read). UTAGE titles already
 * carry their `[X]` kanji prefix and stay untouched.
 *
 * This runs on the bytes being packed into an archive, never on the stored
 * files: the served maidata, the chart preview, fingerprints and enrichment all
 * keep seeing the untagged original.
 *
 * The chart kind comes from `&shortid` inside the maidata itself (< 10000 is
 * standard, 10000–99999 DX, >= 100000 UTAGE by the stable maimai id
 * convention), so this needs nothing from the catalog and behaves sensibly for
 * custom sources: no shortid, no tag.
 */
import type { AdxArchiveInput } from "./adx-archive-shared";

const DX_SHORT_ID_MIN = 10000;
const UTAGE_SHORT_ID_MIN = 100000;

/** `maidata.txt` at the archive root (single) or under a chart folder (batch). */
const MAIDATA_NAME = /(?:^|\/)maidata\.txt$/;

/**
 * Returns the maidata text with the title tagged, or the input string itself
 * (`===`) when there is nothing to do — callers use the identity to skip
 * rebuilding the Blob.
 */
export function tagMaidataTitle(text: string): string {
  const shortidMatch = /^﻿?&shortid=([^\r\n]*)/m.exec(text);
  if (!shortidMatch) {
    return text;
  }
  const shortid = shortidMatch[1]!.trim();
  if (!/^\d+$/.test(shortid) || Number(shortid) >= UTAGE_SHORT_ID_MIN) {
    return text;
  }
  const tag = Number(shortid) >= DX_SHORT_ID_MIN ? "[DX]" : "[SD]";

  return text.replace(/^(﻿?&title=)([^\r\n]*)/m, (line, prefix: string, value: string) => {
    const title = value.trimEnd();
    if (title === "" || title.endsWith("[SD]") || title.endsWith("[DX]")) {
      return line;
    }
    return `${prefix}${title} ${tag}`;
  });
}

/**
 * Maps a packed-archive input list through {@link tagMaidataTitle}. Only
 * `maidata.txt` entries are considered; untouched entries keep their exact
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
