import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogArea } from "./catalog-shared";

const knownAreas: ReadonlyMap<string, CatalogArea> = new Map([
  ["Phigros区域", { id: "phigros", label: "Phigros" }],
  ["Muse Dash区域", { id: "muse-dash", label: "Muse Dash" }],
  ["Muse Dash区域2", { id: "muse-dash-2", label: "Muse Dash 2" }],
  ["重音テト区域", { id: "kasane-teto", label: "重音 Teto" }],
]);

async function readAreas(file: string): Promise<Record<string, string>> {
  const { areas } = JSON.parse(await readFile(file, "utf8"));
  if (
    !areas || typeof areas !== "object" || Array.isArray(areas) ||
    Object.keys(areas).length === 0 ||
    Object.entries(areas).some(([id, name]) => !/^\d+$/.test(id) || typeof name !== "string" || !name.trim())
  ) {
    throw new Error("Invalid LXNS area snapshot");
  }
  return areas;
}

export async function readCatalogAreas(directory: string): Promise<Map<string, CatalogArea>> {
  const snapshot = await readAreas(path.join(directory, ".lxns-areas-cache.json"))
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[catalog] Using bundled LXNS areas", error);
      }
      return readAreas(path.join(directory, "lxns-areas.json"));
    });
  const overrides: Array<CatalogArea & { shortIds: string[] }> = JSON.parse(
    await readFile(path.join(directory, "area-overrides.json"), "utf8")
  );
  const areas = new Map<string, CatalogArea>();
  for (const [shortId, name] of Object.entries(snapshot)) {
    const area = knownAreas.get(name) ?? {
      id: `lxns-${createHash("sha256").update(name).digest("hex").slice(0, 16)}`,
      label: name,
    };
    areas.set(shortId, area);
  }
  for (const { id, label, shortIds } of overrides) {
    for (const shortId of shortIds) areas.set(shortId, { id, label });
  }
  return areas;
}
