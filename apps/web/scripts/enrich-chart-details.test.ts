import { expect, test } from "bun:test";
import { enrichEntries } from "./enrich-chart-details";

const text = "&en_title=English title\n&en_artist=English artist\n&inote_1=(120){4}1,2,3,4,E\n";
function entry() {
  return {
    short_id: "1", title: "Title", artist: "Artist", bpm: 120,
    files: { maidata: "https://example.com/chart", audio: "https://example.com/audio" },
    difficulties: [{ slot: 1, level: "1", designer: "Tester" }],
    file_bytes: { maidata: 5, audio: 9 },
  };
}
const options = { concurrency: 2, skipCharts: false, skipSizes: false };

test("media HEAD starts while maidata GET is still waiting, with accurate output", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let headStarted = false;
  const item = entry();
  const work = enrichEntries([item], options, async (_url, init) => {
    if (init?.method === "HEAD") {
      headStarted = true;
      release();
      return new Response(null, { headers: { "content-length": "123" } });
    }
    await waiting;
    return new Response(text);
  });
  await work;
  expect(headStarted).toBe(true);
  expect(item.file_bytes).toEqual({ maidata: new TextEncoder().encode(text).length, audio: 123 });
  expect(item).toMatchObject({ title_en: "English title", artist_en: "English artist", bpm_min: 120, bpm_max: 120 });
  expect(item.difficulties[0]).toMatchObject({ notes: { total: 4 } });
});

test("unavailable media removes stale sizes while failed maidata keeps prior bytes", async () => {
  const item = entry();
  await enrichEntries([item], options, async () => new Response(null, { status: 404 }));
  expect(item.file_bytes).toEqual({ maidata: 5 });
});

test("skip flags retain previous fields and avoid the skipped requests", async () => {
  const item = entry();
  let calls = 0;
  await enrichEntries([item], { ...options, skipCharts: true, skipSizes: true }, async () => {
    calls++;
    throw new Error("must not fetch");
  });
  expect(calls).toBe(0);
  expect(item.file_bytes).toEqual({ maidata: 5, audio: 9 });
});

test("skip charts still measures media and skip sizes still analyses charts", async () => {
  const sizesOnly = entry();
  await enrichEntries([sizesOnly], { ...options, skipCharts: true }, async (_url, init) => {
    expect(init?.method).toBe("HEAD");
    return new Response(null, { headers: { "content-length": "123" } });
  });
  expect(sizesOnly.file_bytes).toEqual({ maidata: 5, audio: 123 });

  const chartsOnly = entry();
  await enrichEntries([chartsOnly], { ...options, skipSizes: true }, async (_url, init) => {
    expect(init?.method).toBeUndefined();
    return new Response(text);
  });
  expect(chartsOnly.difficulties[0]).toMatchObject({ notes: { total: 4 } });
  expect(chartsOnly.file_bytes).toEqual({ maidata: 5, audio: 9 });
});

test("entry pooling bounds GET and each media kind during overlapping work", async () => {
  let gets = 0;
  let heads = 0;
  let maxGets = 0;
  let maxHeads = 0;
  await enrichEntries(Array.from({ length: 6 }, entry), options, async (_url, init) => {
    const head = init?.method === "HEAD";
    if (head) maxHeads = Math.max(maxHeads, ++heads);
    else maxGets = Math.max(maxGets, ++gets);
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (head) heads--;
    else gets--;
    return head ? new Response(null, { headers: { "content-length": "123" } }) : new Response(text);
  });
  expect(maxGets).toBe(2);
  expect(maxHeads).toBe(2);
});
