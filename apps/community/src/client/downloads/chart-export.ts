import { unzipSync, zipSync } from "fflate";
import { DOWNLOAD_CACHE_BYTES } from "@/shared/downloads";

export type ChartArchiveFormat = "adx" | "zip";

export function chartExportName(title: string, fallback: string): string {
  const clean = title.normalize("NFC")
    .replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, "_")
    .replace(/^[. ]+|[. ]+$/g, "");
  const name = [...clean].slice(0, 60).join("").trimEnd();
  return !name || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ? fallback : name;
}

function chooseFilename(files: string[], preferred: RegExp, supported: RegExp): string | undefined {
  const matching = files.filter(name => preferred.test(name));
  const choices = matching.length ? matching : files.filter(name => supported.test(name));
  if (choices.length > 1) throw new Error("Ambiguous chart asset");
  return choices[0];
}

/** ZIP remains the verified upload. ADX gives it the single-song layout used by the main site. */
export async function buildChartAdx(blob: Blob, title: string): Promise<Blob> {
  if (!blob.size || blob.size > DOWNLOAD_CACHE_BYTES) throw new Error("BUDGET");
  const source = new Uint8Array(await blob.arrayBuffer());
  const selected: string[] = [];
  let expanded = 0;
  let entries = 0;
  const unpacked = unzipSync(source, {
    filter({ name, originalSize }) {
      entries++;
      expanded += originalSize;
      if (entries > 128 || expanded > DOWNLOAD_CACHE_BYTES) throw new Error("BUDGET");
      const directory = name.endsWith("/");
      const parts = name.replace(/\/$/, "").normalize("NFC").split("/");
      if (/^[A-Za-z]:/.test(name) || /[\\\p{Cc}]/u.test(name) ||
        parts.length > 8 || parts.some(part => !part || part === "." || part === "..")) {
        throw new Error("Invalid chart path");
      }
      if (directory || parts.includes("__MACOSX") || parts.at(-1) === ".DS_Store") return false;
      selected.push(name);
      return true;
    },
  });
  if (Object.keys(unpacked).length !== selected.length || !selected.length) throw new Error("Invalid chart package");
  const paths = selected.map(name => name.normalize("NFC").split("/"));
  const folder = paths[0]![0];
  const wrapped = paths.every(parts => parts.length === 2 && parts[0] === folder);
  if (!wrapped && paths.some(parts => parts.length !== 1)) throw new Error("Expected one chart folder");
  const names = paths.map(parts => parts.at(-1)!);
  const maidata = chooseFilename(names, /^maidata\.txt$/i, /\.txt$/i);
  if (!maidata) throw new Error("Missing maidata");
  const audio = chooseFilename(names, /^track\.(mp3|ogg|wav)$/i, /\.(mp3|ogg|wav)$/i);
  const cover = chooseFilename(names, /^bg\.(jpe?g|png|webp)$/i, /\.(jpe?g|png|webp)$/i);
  const videos = names.filter(name => /\.(mp4|webm)$/i.test(name));
  const video = videos.length === 1 ? videos[0] : undefined;
  const output = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  const dir = chartExportName(title, "chart");
  for (const [index, entry] of selected.entries()) {
    const name = names[index]!;
    const extension = name.split(".").at(-1)!.toLowerCase();
    const file = name === maidata ? "maidata.txt" : name === audio ? `track.${extension}` :
      name === cover ? `bg.${extension}` : name === video ? `pv.${extension}` : name;
    const key = file.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate chart path");
    seen.add(key);
    output.set(`${dir}/${file}`, unpacked[entry]!);
  }
  const zipped = zipSync(Object.fromEntries(output), { level: 0, mtime: new Date(2000, 0, 1) });
  return new Blob([zipped.buffer as ArrayBuffer], { type: "application/octet-stream" });
}
