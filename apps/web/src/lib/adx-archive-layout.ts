import type { AdxArchiveInput, NestedChart } from "./adx-archive-shared";

// Stay below signed 32-bit sizes for older importers as well as ZIP32 offsets.
export const MAX_BATCH_ZIP_BYTES = 2 ** 31 - 1;
const MAX_ZIP32_BYTES = 0xfffffffe;
const MAX_ZIP32_ENTRIES = 0xfffe;
const ZIP_FOOTER_BYTES = 22;
const encoder = new TextEncoder();

function archivePathSegment(value: string): string {
  const cleaned = value.trim().replace(/[\\/]+/g, "_").replace(/^[.\s]+/, "");
  return cleaned.length > 0 && cleaned !== "." ? cleaned : "chart";
}

export function withRootDirectory(
  files: AdxArchiveInput[],
  directoryName?: string
): AdxArchiveInput[] {
  if (!directoryName) {
    return files;
  }
  const root = archivePathSegment(directoryName);
  return files.map((file) => ({ ...file, name: `${root}/${file.name}` }));
}

// Normalize the whole group before splitting so duplicate folder names remain
// distinct even when they land in separate independently imported archives.
function normalizeNestedCharts(charts: NestedChart[]): NestedChart[] {
  const usedByGroup = new Map<string, Set<string>>();
  return charts.map((chart) => {
    if (chart.files.length === 0) {
      throw new Error(`Chart has no files: ${chart.name}`);
    }
    const groupDir = chart.groupDir ? archivePathSegment(chart.groupDir) : "";
    const usedKey = groupDir || ".";
    const used = usedByGroup.get(usedKey) ?? new Set<string>();
    usedByGroup.set(usedKey, used);
    const safeName = archivePathSegment(chart.name);
    let name = safeName;
    for (let copy = 2; used.has(name); copy += 1) {
      name = `${safeName} (${copy})`;
    }
    used.add(name);
    return { ...chart, name, groupDir: groupDir || undefined };
  });
}

/** The exact paths used by both archive sizing and the ZIP/TAR writers. */
export function nestedArchiveFiles(
  charts: NestedChart[],
  directoryName?: string
): AdxArchiveInput[] {
  const files = normalizeNestedCharts(charts).flatMap((chart) =>
    withRootDirectory(withRootDirectory(chart.files, chart.name), chart.groupDir)
  );
  return withRootDirectory(files, directoryName);
}

function zipEntryBytes(file: AdxArchiveInput): number {
  // STORE: payload + local header (30) + descriptor (16) + central header (46).
  // UTF-8 filename appears in both headers; our writer adds no extra fields.
  return file.blob.size + 92 + 2 * encoder.encode(file.name).length;
}

export function zipArchiveBytes(files: AdxArchiveInput[]): number {
  return files.reduce((sum, file) => sum + zipEntryBytes(file), ZIP_FOOTER_BYTES);
}

export function assertZip32Limits(files: AdxArchiveInput[]): void {
  if (files.length > MAX_ZIP32_ENTRIES || zipArchiveBytes(files) > MAX_ZIP32_BYTES) {
    throw new Error("ZIP32 archive limit exceeded. Split the download into smaller archives.");
  }
}

/** Keep chart folders whole and preserve input order in independent ZIPs. */
export function splitNestedZipCharts(charts: NestedChart[]): NestedChart[][] {
  const parts: NestedChart[][] = [];
  let current: NestedChart[] = [];
  let bytes = ZIP_FOOTER_BYTES;
  let entries = 0;
  for (const chart of normalizeNestedCharts(charts)) {
    const files = nestedArchiveFiles([chart]);
    const chartBytes = zipArchiveBytes(files) - ZIP_FOOTER_BYTES;
    if (
      chartBytes + ZIP_FOOTER_BYTES > MAX_BATCH_ZIP_BYTES ||
      files.length > MAX_ZIP32_ENTRIES
    ) {
      throw new Error(
        `Chart is too large for one archive: ${chart.name}. Exclude BGA video or download this chart separately.`
      );
    }
    if (
      current.length > 0 &&
      (bytes + chartBytes > MAX_BATCH_ZIP_BYTES ||
        entries + files.length > MAX_ZIP32_ENTRIES)
    ) {
      parts.push(current);
      current = [];
      bytes = ZIP_FOOTER_BYTES;
      entries = 0;
    }
    current.push(chart);
    bytes += chartBytes;
    entries += files.length;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}
