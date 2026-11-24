import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readCatalogEntries } from "./catalog";
import { readCatalogAreas } from "./catalog-areas";
import { toCatalogCardEntry } from "./catalog-shared";

test("last saved areas take precedence and official additions apply to either snapshot", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "astrodx-areas-"));
  const write = (name: string, data: unknown) =>
    writeFile(path.join(directory, name), JSON.stringify(data));
  try {
    await write("lxns-areas.json", { areas: { "11875": "Phigros区域" } });
    await write(".lxns-areas-cache.json", { areas: { "11793": "重音テト区域" } });
    await write("area-overrides.json", [{ id: "muse-dash-2", label: "Muse Dash 2", shortIds: ["12061"] }]);
    const cached = await readCatalogAreas(directory);
    expect([...cached.keys()]).toEqual(["11793", "12061"]);

    await rm(path.join(directory, ".lxns-areas-cache.json"));
    const bundled = await readCatalogAreas(directory);
    expect([...bundled.keys()]).toEqual(["11875", "12061"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the browse catalog carries all 18 requested charts under their area IDs", async () => {
  const entries = (await readCatalogEntries()).map(toCatalogCardEntry);
  const expected = {
    phigros: ["11874", "11875", "11876", "11877"],
    "muse-dash": ["11571", "11572", "11573", "11574", "11575", "11576"],
    "muse-dash-2": ["12059", "12060", "12061"],
    "kasane-teto": ["11793", "11794", "11795", "11796", "11797"],
  };
  for (const [areaId, ids] of Object.entries(expected)) {
    expect(entries.filter((entry) => entry.area?.id === areaId).map((entry) => entry.short_id).sort())
      .toEqual(ids);
  }
});
