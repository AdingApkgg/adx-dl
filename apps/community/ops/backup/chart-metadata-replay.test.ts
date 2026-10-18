import { expect, test } from "bun:test";
import type { Client } from "pg";
import type { JournalRecord } from "./journal";
import { numberRestoredPublications, replayChartPermission } from "./chart-replay";

for (const extended of [false, true]) test(`permission replay uses parsed ${extended ? "extended" : "legacy empty"} metadata, never private draft columns`, async () => {
  const calls: { text: string; values: unknown[] }[] = [], chartId = crypto.randomUUID();
  const client = { async query(text: string, values: unknown[] = []) {
    calls.push({ text, values });
    if (text.startsWith("select publication_sequence")) return { rowCount: 1, rows: [{ publication_sequence: 0 }] };
    if (text.includes("insert into chart_publications")) return { rowCount: 1, rows: [] };
    return { rowCount: 0, rows: [] };
  } } as unknown as Client;
  const metadata = { description: "Public description", credits: "Public source", tags: [{ key: "public", label: "Public" }], releaseNote: "Public note" };
  const publication = { versionId: crypto.randomUUID(), title: "Snapshot", artist: "", publishedAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-18T00:00:00.000Z", ...(extended ? metadata : {}) };
  await replayChartPermission(client, { sequence: 7 } as JournalRecord, { version: 1, chartId, revision: 4, publication });
  const saved = calls.find(call => call.text.includes("insert into chart_publications"));
  expect(saved?.values.slice(6)).toEqual(extended ? [metadata.description, metadata.credits, JSON.stringify(metadata.tags), metadata.releaseNote] : ["", "", "[]", ""]);
  expect(calls.some(call => /select .*description.* from charts/.test(call.text))).toBe(false);
});
test("numbering a restored publication preserves its current metadata in the replacement permission fact", async () => {
  const chartId = crypto.randomUUID(), metadata = { description: "Public description", credits: "Public credits", tags: [{ key: "public", label: "Public" }], release_note: "Public note" };
  const calls: { text: string; values: unknown[] }[] = [];
  const client = { async query(text: string, values: unknown[] = []) {
    calls.push({ text, values });
    if (text.startsWith("select ch.id from chart_publications")) return { rowCount: 1, rows: [{ id: chartId }] };
    if (text.startsWith("insert into chart_public_ids")) return { rowCount: 1, rows: [{ id: "42" }] };
    if (text.startsWith("select ch.revision,p.*")) return { rowCount: 1, rows: [{ revision: 4, version_id: crypto.randomUUID(), title: "Public title", artist: "", published_at: new Date("2026-10-18T00:00:00Z"), updated_at: new Date("2026-10-18T00:00:00Z"), ...metadata }] };
    if (text.startsWith("insert into storage_tombstones")) return { rowCount: 1, rows: [{ sequence: 8 }] };
    return { rowCount: 0, rows: [] };
  } } as unknown as Client;
  await numberRestoredPublications(client, 7);
  const saved = calls.find(call => call.text.startsWith("insert into storage_tombstones"));
  expect(JSON.parse(String(saved?.values[0]))).toMatchObject({ publicId: "42", publication: { description: metadata.description, credits: metadata.credits, tags: metadata.tags, releaseNote: metadata.release_note } });
});
