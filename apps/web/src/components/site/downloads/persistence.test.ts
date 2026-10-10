import { describe, expect, test } from "bun:test";

import { classifyStorageError, createDownloadsDatabaseOpener, normalizePersistedBatchSelection, normalizePersistedFile, subscribeToCheckpointFailures } from "./persistence";

function databaseRequest() {
  let closes = 0;
  const database = { close: () => { closes += 1; }, onversionchange: null } as unknown as IDBDatabase;
  const request = { result: database, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null } as unknown as IDBOpenDBRequest;
  return { database, request, get closes() { return closes; } };
}

describe("download database connection lifecycle", () => {
  test("blocked upgrades settle immediately and retain degradation even after a late success", async () => {
    const fixture = databaseRequest();
    let opens = 0;
    const open = createDownloadsDatabaseOpener(() => ({ open: () => { opens += 1; return fixture.request; } }));
    const failures: string[] = [];
    const unsubscribe = subscribeToCheckpointFailures((kind) => failures.push(kind));
    try {
      const pending = open();
      fixture.request.onblocked?.call(fixture.request, new Event("blocked") as IDBVersionChangeEvent);
      expect(await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve("still pending"), 50))])).toBeNull();
      expect(failures).toEqual(["blocked"]);
      fixture.request.onsuccess?.call(fixture.request, new Event("success"));
      expect(fixture.closes).toBe(1);
      expect(await open()).toBeNull();
      expect(opens).toBe(1);
      fixture.request.onblocked?.call(fixture.request, new Event("blocked") as IDBVersionChangeEvent);
      expect(failures).toEqual(["blocked"]);
    } finally { unsubscribe(); }
  });

  test("a normal connection closes on versionchange and the next operation opens again", async () => {
    const first = databaseRequest();
    const second = databaseRequest();
    let opens = 0;
    const open = createDownloadsDatabaseOpener(() => ({ open: () => [first, second][opens++]!.request }));
    const initial = open();
    first.request.onsuccess?.call(first.request, new Event("success"));
    expect(await initial).toBe(first.database);
    expect(await open()).toBe(first.database);
    expect(opens).toBe(1);
    first.database.onversionchange?.call(first.database, new Event("versionchange") as IDBVersionChangeEvent);
    expect(first.closes).toBe(1);
    const reopened = open();
    second.request.onsuccess?.call(second.request, new Event("success"));
    expect(await reopened).toBe(second.database);
    expect(opens).toBe(2);
  });
});

function baseRecord() {
  return {
    key: "job::track.mp3",
    jobId: "job",
    name: "track.mp3",
    url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
  };
}

describe("normalizePersistedFile", () => {
  test("accepts a current whole-file checkpoint, including a zero-byte file", () => {
    const blob = new Blob([]);

    expect(
      normalizePersistedFile({
        ...baseRecord(),
        complete: true,
        size: 0,
        blob,
      })
    ).toEqual({
      ...baseRecord(),
      complete: true,
      size: 0,
      blob,
    });
  });

  test("lazily accepts a legacy record only when every size proves it is complete", () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);

    expect(
      normalizePersistedFile({
        ...baseRecord(),
        etag: '"v1"',
        total: 3,
        received: 3,
        blob,
      })
    ).toEqual({
      ...baseRecord(),
      complete: true,
      size: 3,
      blob,
    });
  });

  test("preserves the route snapshot for a custom-source checkpoint", () => {
    const blob = new Blob([new Uint8Array([1])]);
    const sourceBaseUrl = "https://mirror.example.com/charts";

    expect(
      normalizePersistedFile({
        ...baseRecord(),
        sourceBaseUrl,
        complete: true,
        size: 1,
        blob,
      })
    ).toEqual({
      ...baseRecord(),
      sourceBaseUrl,
      complete: true,
      size: 1,
      blob,
    });
  });

  test("rejects legacy byte prefixes and inconsistent current records", () => {
    expect(
      normalizePersistedFile({
        ...baseRecord(),
        total: 3,
        received: 2,
        blob: new Blob([new Uint8Array([1, 2])]),
      })
    ).toBeNull();
    expect(
      normalizePersistedFile({
        ...baseRecord(),
        complete: true,
        size: 3,
        blob: new Blob([new Uint8Array([1, 2])]),
      })
    ).toBeNull();
  });
});

describe("classifyStorageError", () => {
  test("recognises a quota failure by name or message", () => {
    // Engines disagree on the shape: some throw a named DOMException, others a
    // plain Error whose message is the only clue.
    const named = new Error("write failed");
    named.name = "QuotaExceededError";
    expect(classifyStorageError(named)).toBe("quota");
    expect(classifyStorageError(new Error("The quota has been exceeded."))).toBe(
      "quota"
    );
  });

  test("treats anything else as an unknown storage failure", () => {
    expect(classifyStorageError(new Error("db closed"))).toBe("unknown");
    expect(classifyStorageError(null)).toBe("unknown");
  });
});

describe("normalizePersistedBatchSelection", () => {
  const selection = {
    id: "selection", jobIds: ["part0", "part1"], completedJobIds: ["part0"],
    job: {
      id: "selection", kind: "batch", title: "All selected", format: "zip", createdAt: 1,
      files: [{ name: "0/track.mp3", url: "https://example.test/track.mp3", bytes: 80 * 1024 ** 2 }],
      dirByIndex: ["Song"], groupByIndex: ["Genre"], sourceId: "r2", sourceBaseUrl: "https://example.test",
    },
  };

  test("keeps original layout, byte metadata and released-child progress without Blob state", () => {
    expect(normalizePersistedBatchSelection({
      ...selection, jobIds: ["part0", "part1", "part0"], completedJobIds: ["part0", "part0"],
      blob: new Blob(["unwanted"]),
      job: { ...selection.job, batchSelectionId: "old-link", archives: [new Blob(["unwanted"])],
        files: [{ ...selection.job.files[0], blob: new Blob(["unwanted"]) }] },
    })).toEqual(selection);
  });

  test("rejects impossible progress and inconsistent selection specs", () => {
    expect(normalizePersistedBatchSelection({ ...selection, completedJobIds: ["unknown-part"] })).toBeNull();
    expect(normalizePersistedBatchSelection({ ...selection, job: { ...selection.job, id: "wrong-selection" } })).toBeNull();
    expect(normalizePersistedBatchSelection({ ...selection, job: { ...selection.job, files: [{ ...selection.job.files[0], bytes: NaN }] } })).toBeNull();
    expect(normalizePersistedBatchSelection({ ...selection, jobIds: [] })).toBeNull();
  });
});
