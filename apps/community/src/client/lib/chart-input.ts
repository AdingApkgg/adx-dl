import { ApiError } from "@/shared/api-client";

export const CHART_ZIP_LIMIT = 64 * 1024 * 1024;
export type FolderFile = { file: File; path: string };
export type ChartParts = Partial<Record<"maidata" | "audio" | "cover" | "video", File>>;

export function chartFolderEntries(files: readonly File[]): FolderFile[] {
  if (!files.length || files.length > 128) throw new ApiError(422, "CHART_ENTRY_LIMIT", "Choose one chart folder");
  const seen = new Set<string>();
  let total = 0;
  return files.map((file) => {
    if (!file.webkitRelativePath) throw new ApiError(422, "CHART_FOLDER_UNSUPPORTED", "Choose a ZIP when directory paths are unavailable");
    const path = file.webkitRelativePath.normalize("NFC");
    const parts = path.split("/");
    if (path.includes("\\") || /^[A-Za-z]:/.test(path) || Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      parts.some((part) => !part || part === "." || part === "..") || parts.length > 8 || new TextEncoder().encode(path).length > 240)
      throw new ApiError(422, "CHART_PATH_INVALID", "Invalid folder path");
    const key = path.toLowerCase();
    if (seen.has(key)) throw new ApiError(422, "CHART_PATH_COLLISION", "Duplicate folder path");
    seen.add(key);
    total += file.size;
    if (total > 128 * 1024 * 1024) throw new ApiError(422, "CHART_EXPANDED_LIMIT", "Folder is too large");
    return { file, path };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function packChartFolder(files: readonly File[], signal?: AbortSignal): Promise<File> {
  const entries = chartFolderEntries(files);
  return packEntries(entries, `${entries[0]!.path.split("/")[0]!.replace(/\.zip$/i, "")}.zip`, signal);
}

/** Canonical names make independently selected assets one deterministic, resumable chart. */
export function packChartParts(parts: ChartParts, signal?: AbortSignal): Promise<File> {
  if (!parts.maidata) throw new ApiError(422, "CHART_MAIDATA_MISSING", "Choose a score file");
  const entries: FolderFile[] = [];
  let total = 0;
  for (const [role, stem, extensions, limit] of [
    ["maidata", "maidata", ["txt"], 1_048_576],
    ["audio", "track", ["mp3", "ogg", "wav"], 33_554_432],
    ["cover", "bg", ["jpg", "jpeg", "png", "webp"], 8_388_608],
    ["video", "pv", ["mp4", "webm"], CHART_ZIP_LIMIT],
  ] as const) {
    const file = parts[role];
    if (!file) continue;
    const extension = file.name.split(".").pop()!.toLowerCase();
    if (!(extensions as readonly string[]).includes(extension))
      throw new ApiError(422, "CHART_PART_TYPE_INVALID", "Unsupported file type for this chart asset");
    if (!file.size || file.size > limit) throw new ApiError(422, "CHART_ASSET_TOO_LARGE", "Invalid chart asset size");
    total += file.size;
    if (total > CHART_ZIP_LIMIT) throw new ApiError(422, "FILE_TOO_LARGE", "Chart package is too large");
    entries.push({ file, path: `${stem}.${extension}` });
  }
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return packEntries(entries, "chart.zip", signal);
}

function packEntries(entries: FolderFile[], name: string, signal?: AbortSignal): Promise<File> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const worker = new Worker(new URL("../workers/chart-folder.ts", import.meta.url), { type: "module" });
    let done = false;
    const finish = (error?: unknown, zip?: ArrayBuffer) => {
      if (done) return;
      done = true;
      worker.terminate();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(new File([zip!], name, { type: "application/zip" }));
    };
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(new ApiError(422, "CHART_PACKAGE_INVALID", "Folder packaging failed"));
    worker.onmessage = (event: MessageEvent<{ zip?: ArrayBuffer; error?: string }>) => {
      if (event.data.error) finish(new ApiError(422, event.data.error, "Folder packaging failed"));
      else if (event.data.zip) finish(undefined, event.data.zip);
    };
    worker.postMessage(entries);
  });
}
