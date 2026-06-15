// Maps a maimai version string (from the catalog `version` field) to a version
// icon hosted at /genrepics/<index>.png. Most-specific (PLUS) variants are
// matched before their base version. Returns null when no version icon applies
// (e.g. empty/unknown version) so callers fall back to a text label.
const VERSION_IMAGE_RULES: ReadonlyArray<readonly [RegExp, number]> = [
  [/circle/i, 25],
  [/buddies\s*plus/i, 22],
  [/buddies/i, 21],
  [/prism\s*plus/i, 24],
  [/prism/i, 23],
  [/festival\s*plus/i, 20],
  [/festival/i, 19],
  [/universe\s*plus/i, 18],
  [/universe/i, 17],
  [/splash\s*plus/i, 16],
  [/splash/i, 15],
  [/finale/i, 12],
  [/milk\s*plus/i, 11],
  [/milk/i, 10],
  [/murasaki\s*plus/i, 9],
  [/murasaki/i, 8],
  [/pink\s*plus/i, 7],
  [/pink/i, 6],
  [/orange\s*plus/i, 5],
  [/orange/i, 4],
  [/green\s*plus/i, 3],
  [/green/i, 2],
  // DX (でらっくす) base + PLUS — matched after the named DX versions above.
  [/(?:dx|でらっくす)\s*plus/i, 14],
  [/(?:dx|でらっくす)/i, 13],
  [/maimai\s*plus/i, 1],
];

export const VERSION_IMAGE_DIMENSIONS = { width: 332, height: 160 } as const;

export function versionImageIndex(version: string | null | undefined): number | null {
  const value = (version ?? "").trim();
  if (!value) {
    return null;
  }
  for (const [pattern, index] of VERSION_IMAGE_RULES) {
    if (pattern.test(value)) {
      return index;
    }
  }
  if (/^maimai$/i.test(value)) {
    return 0;
  }
  return null;
}

export function versionImageSrc(version: string | null | undefined): string | null {
  const index = versionImageIndex(version);
  return index === null ? null : `/genrepics/${index}.png`;
}

export function versionImageSrcByIndex(index: number): string {
  return `/genrepics/${index}.png`;
}

export type MaimaiVersion = { index: number; name: string; slug: string };

// The full maimai version lineup in chronological order (matches genrepics 0–25).
// Names follow the catalog's convention so slugs line up with catalog-derived ones.
const VERSION_NAMES: ReadonlyArray<readonly [number, string]> = [
  [0, "maimai"],
  [1, "maimai PLUS"],
  [2, "maimai GreeN"],
  [3, "maimai GreeN PLUS"],
  [4, "maimai ORANGE"],
  [5, "maimai ORANGE PLUS"],
  [6, "maimai PiNK"],
  [7, "maimai PiNK PLUS"],
  [8, "maimai MURASAKi"],
  [9, "maimai MURASAKi PLUS"],
  [10, "maimai MiLK"],
  [11, "maimai MiLK PLUS"],
  [12, "maimai FiNALE"],
  [13, "maimai DX"],
  [14, "maimai DX PLUS"],
  [15, "maimai DX Splash"],
  [16, "maimai DX Splash PLUS"],
  [17, "maimai DX UNiVERSE"],
  [18, "maimai DX UNiVERSE PLUS"],
  [19, "maimai DX FESTiVAL"],
  [20, "maimai DX FESTiVAL PLUS"],
  [21, "maimai DX BUDDiES"],
  [22, "maimai DX BUDDiES PLUS"],
  [23, "maimai DX PRiSM"],
  [24, "maimai DX PRiSM PLUS"],
  [25, "maimai DX CiRCLE"],
];

function toVersionSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export const MAIMAI_VERSIONS: MaimaiVersion[] = VERSION_NAMES.map(([index, name]) => ({
  index,
  name,
  slug: toVersionSlug(name),
}));
