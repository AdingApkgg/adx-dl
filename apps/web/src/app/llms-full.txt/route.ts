import { readCatalog } from "@/lib/catalog";
import {
  difficultyLevelRange,
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
  sortByReleaseDesc,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import { entrySlug } from "@/lib/route-slug";
import { resolveSiteUrl } from "@/lib/site-url";

// Companion to /llms.txt: the full, machine-readable catalog manifest. Rendered
// to a static file at build time under output: export.
export const dynamic = "force-static";

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL).replace(/\/+$/, "");

// One compact, parseable line per chart: enough facts for an answer engine to
// cite (title, author, branch, difficulty span, tempo, nicknames) plus the URL.
function chartLine(entry: CatalogEntry): string {
  const title = formatEntryTitle(entry, "en");
  const artist = formatEntryArtist(entry, "en");
  const range = difficultyLevelRange(entry);
  const count = entry.difficulties.length;
  const levels = range ? ` (Lv ${range.low}–${range.high})` : "";
  const bpm = entry.bpm ? `; BPM ${entry.bpm}` : "";
  const aliases = entry.aliases?.length ? `; aliases: ${entry.aliases.join(", ")}` : "";
  const url = `${siteUrl}/charts/${encodeURIComponent(entrySlug(entry))}`;
  return `- ${title} — ${artist}; ${count} difficult${count === 1 ? "y" : "ies"}${levels}${bpm}${aliases}; ${url}`;
}

export async function GET() {
  const catalog = await readCatalog();
  // Copy before sorting — readCatalog() is cached and shared across the build.
  const ordered = sortByReleaseDesc([...catalog.entries]);

  const byBranch = new Map<string, CatalogEntry[]>();
  for (const entry of ordered) {
    const branch = formatEntrySubcategory(entry);
    const bucket = byBranch.get(branch);
    if (bucket) {
      bucket.push(entry);
    } else {
      byBranch.set(branch, [entry]);
    }
  }

  const sections = [...byBranch.entries()]
    .map(
      ([branch, entries]) =>
        `## ${branch} (${entries.length})\n${entries.map(chartLine).join("\n")}`
    )
    .join("\n\n");

  const body = `# ADX 谱面资源 — full chart manifest

> Machine-readable manifest of every AstroDX chart in this archive (maimai DX-style rhythm-game charts): title, artist, maimai DX version branch, difficulty count and level range, BPM, community aliases (别名), and the canonical chart URL. Companion to ${siteUrl}/llms.txt.

Total: ${catalog.total_entries} charts, grouped by maimai DX version branch (newest first). Last updated ${catalog.generated_at}. Each chart page carries full metadata, cover art, an in-browser preview, and downloads.

${sections}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
