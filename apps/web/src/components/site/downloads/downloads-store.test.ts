import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";
import { createMemoryArchiveStorage } from "@/lib/archive-storage.test-helper";

import {
  setDownloadsPersistenceAdapterForTests,
  type DownloadHistoryEntry,
  type DownloadsPersistenceAdapter,
  type PersistedFile,
  type PersistedJob,
  type PersistedBatchSelection,
} from "./persistence";

import {
  classifyDownloadError,
  createInitialDownloadSourceProbes,
  downloadFailureStatus,
  downloadFailureUrl,
  estimateDownloadEtaMs,
  newBatchJobId,
  parseStoredCustomSources,
  resetDownloadQueueForTests,
  reusablePersistedFile,
  setDownloadRetryBaseDelayForTests,
  singleJobId,
  summarizeDownloadJobs,
  useDownloadsStore,
  type DownloadJob,
} from "./downloads-store";
import { CUSTOM_DOWNLOAD_SOURCE_ID } from "@/lib/download-sources";
import { resetPackableAliasIndexForTests } from "@/lib/maidata-aliases";

// Minimal browser shims: the store's download pipeline ends in saveBlobAsFile,
// which touches `document` and `URL.createObjectURL`. We stub just enough so the
// pipeline can run headless — the point is to prove the download completes while
// driven purely by the module-level store, with no React component mounted.
const savedFiles: string[] = [];
const savedBlobs: Blob[] = [];
const fetchedUrls: string[] = [];
const persistedJobs = new Map<string, PersistedJob>();
const persistedFiles = new Map<string, PersistedFile>();
const persistedHistory = new Map<string, DownloadHistoryEntry>();
const persistedSelections = new Map<string, PersistedBatchSelection>();
const localStorageValues = new Map<string, string>();

const memoryPersistence: DownloadsPersistenceAdapter = {
  persistJob: async (job) => {
    persistedJobs.set(job.id, structuredClone(job));
  },
  persistFile: async (file) => {
    persistedFiles.set(file.key, file);
  },
  loadAllJobs: async () => [...persistedJobs.values()],
  loadFilesForJob: async (jobId) =>
    [...persistedFiles.values()].filter((file) => file.jobId === jobId),
  replaceJobKeepingCompletedFiles: async (job) => {
    persistedJobs.set(job.id, structuredClone(job));
    const allowedNames = new Set(job.files.map((file) => file.name));
    for (const [key, file] of persistedFiles) {
      if (file.jobId === job.id && (!file.complete || !allowedNames.has(file.name))) {
        persistedFiles.delete(key);
      }
    }
  },
  deleteJob: async (jobId) => {
    persistedJobs.delete(jobId);
    for (const [key, file] of persistedFiles) {
      if (file.jobId === jobId) {
        persistedFiles.delete(key);
      }
    }
  },
  loadHistory: async () => [...persistedHistory.values()],
  recordHistory: async (entry) => {
    persistedHistory.set(entry.key, structuredClone(entry));
  },
  clearHistory: async () => {
    persistedHistory.clear();
  },
  persistBatchSelection: async (selection) => {
    persistedSelections.set(selection.id, structuredClone(selection));
  },
  loadBatchSelections: async () => [...persistedSelections.values()],
  deleteBatchSelection: async (id) => { persistedSelections.delete(id); },
};

// What these globals were before this file touched them. bun has no `document`
// or `localStorage`, so restoring those means deleting them again: every test
// file runs in the same process, and a leftover `document` stub with nothing
// but `createElement` on it made music-player-preferences.test.ts blow up on
// `document.documentElement` whenever the runner happened to order this file
// first (it did on CI from 2026-09-04, once a runner image update changed the
// file order — while macOS ran the files the other way round and passed).
const globalsBefore = {
  fetch: globalThis.fetch,
  document: (globalThis as Record<string, unknown>).document,
  localStorage: (globalThis as Record<string, unknown>).localStorage,
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};

function restoreGlobals() {
  globalThis.fetch = globalsBefore.fetch;
  for (const key of ["document", "localStorage"] as const) {
    if (globalsBefore[key] === undefined) {
      delete (globalThis as Record<string, unknown>)[key];
    } else {
      (globalThis as Record<string, unknown>)[key] = globalsBefore[key];
    }
  }
  URL.createObjectURL = globalsBefore.createObjectURL;
  URL.revokeObjectURL = globalsBefore.revokeObjectURL;
}

afterAll(() => {
  restoreGlobals();
  // The point of the restore: nothing DOM-shaped may outlive this file.
  expect(typeof document).toBe("undefined");
});

function installDomShims() {
  savedFiles.length = 0;
  savedBlobs.length = 0;
  fetchedUrls.length = 0;
  localStorageValues.clear();
  globalThis.fetch = (async (input) => {
    const url = String(input);
    fetchedUrls.push(url);
    // The alias manifest is a valid, empty index by default: jobs that pack
    // with aliases on then simply find none, instead of tripping over bytes.
    if (url.endsWith("/charts/aliases.json")) {
      return Response.json({});
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-length": "3" },
    });
  }) as typeof fetch;

  (globalThis as Record<string, unknown>).document = {
    body: { appendChild() {} },
    createElement: () => ({
      href: "",
      style: { display: "" },
      remove() {},
      set download(value: string) {
        savedFiles.push(value);
      },
      click() {},
    }),
  };
  (globalThis as Record<string, unknown>).localStorage = {
    get length() {
      return localStorageValues.size;
    },
    clear: () => localStorageValues.clear(),
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    key: (index: number) => [...localStorageValues.keys()][index] ?? null,
    removeItem: (key: string) => {
      localStorageValues.delete(key);
    },
    setItem: (key: string, value: string) => {
      localStorageValues.set(key, value);
    },
  } satisfies Storage;

  const url = globalThis.URL as unknown as {
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  };
  url.createObjectURL = (blob) => {
    savedBlobs.push(blob);
    return "blob:stub";
  };
  url.revokeObjectURL = () => {};
}

/** Spin until the job leaves the queued/download/archive states (or we time out). */
async function waitForSettled(id: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const job = useDownloadsStore.getState().jobs.find((entry) => entry.id === id);
    if (
      job &&
      job.status !== "queued" &&
      job.status !== "packing" &&
      job.status !== "archiving"
    ) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Job ${id} never settled (status=${job?.status ?? "missing"})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForJob(
  id: string,
  predicate: (job: ReturnType<typeof useDownloadsStore.getState>["jobs"][number]) => boolean,
  timeoutMs = 2000
): Promise<void> {
  const start = Date.now();
  for (;;) {
    const job = useDownloadsStore.getState().jobs.find((entry) => entry.id === id);
    if (job && predicate(job)) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Job ${id} did not reach the expected state`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Archive filename → its in-archive paths, so assertions ignore save order. */
async function savedArchives(): Promise<Record<string, string[]>> {
  const archives: Record<string, string[]> = {};
  for (const [index, name] of savedFiles.entries()) {
    archives[name] = Object.keys(
      unzipSync(new Uint8Array(await savedBlobs[index].arrayBuffer()))
    ).sort();
  }
  return archives;
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Condition was not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function onMobile(task: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    userAgent: "Mozilla/5.0 (iPhone)", onLine: true,
  } });
  try { await task(); }
  finally {
    for (const job of useDownloadsStore.getState().jobs) useDownloadsStore.getState().dismiss(job.id);
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as Record<string, unknown>).navigator;
  }
}

function measuredCharts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    dir: `Song ${index}`, groupDir: "maimai",
    files: [{ name: "track.mp3", url: `https://example.test/${index}/track.mp3`, bytes: 3 }],
  }));
}

function legacyBatch(id: string): PersistedJob {
  return {
    id, kind: "batch", title: "Legacy", format: "zip", createdAt: 1,
    files: [0, 1].map((index) => ({
      name: `${index}/track.mp3`, url: `https://example.test/${index}/track.mp3`, bytes: 80 * 1024 ** 2,
    })),
    dirByIndex: ["Song 0", "Song 1"], groupByIndex: ["maimai", "maimai"],
  };
}

function seedWholeFiles(spec: PersistedJob): void {
  persistedJobs.set(spec.id, structuredClone(spec));
  for (const file of spec.files) {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const key = `${spec.id}::${file.name}`;
    persistedFiles.set(key, { ...file, key, jobId: spec.id, complete: true, size: blob.size, blob });
  }
}

describe("downloads-store", () => {
  test("concurrent desktop groups serialize cohort progress and replay the original layout, BGA and format", async () => {
    const updates: string[][] = [];
    let release!: () => void;
    let firstWriteStarted = false;
    const firstWrite = new Promise<void>((resolve) => { release = resolve; });
    setDownloadsPersistenceAdapterForTests({ ...memoryPersistence, persistBatchSelection: async (selection) => {
      updates.push([...selection.completedJobIds]);
      if (selection.completedJobIds.length === 1) {
        firstWriteStarted = true;
        await firstWrite;
      }
      await memoryPersistence.persistBatchSelection(selection);
    } });
    try {
      const id = newBatchJobId();
      const charts = measuredCharts(2).map((chart, index) => ({ ...chart,
        groupDir: `Version ${index}`, genreDir: `Genre ${index}`,
        files: [...chart.files, { name: "pv.mp4", url: `https://example.test/${index}/pv.mp4`, bytes: 7 }],
      }));
      const ids = await useDownloadsStore.getState().startBatch({
        id, title: "Both genres", charts, includeVideo: true, format: "zip", grouping: "genre",
      });
      await waitForCondition(() => firstWriteStarted && ids.every((id) => useDownloadsStore.getState().jobs.find((job) => job.id === id)?.status === "success"));
      expect(useDownloadsStore.getState().history).toEqual([]);
      expect(updates.map((ids) => ids.length)).toEqual([0, 1]);
      release();
      await waitForCondition(() => useDownloadsStore.getState().history.length === 1 && persistedSelections.size === 0);
      expect(updates.map((ids) => ids.length)).toEqual([0, 1, 2]);
      expect(new Set(updates[2])).toEqual(new Set(ids));
      const [entry] = useDownloadsStore.getState().history;
      expect(entry.job.groupByIndex).toEqual(["Genre 0", "Genre 1"]);
      expect(entry.job.files.map((file) => file.bytes)).toEqual([3, 7, 3, 7]);
      expect(entry.job.format).toBe("zip");
      useDownloadsStore.getState().setPreferredBatchGrouping("version");
      useDownloadsStore.getState().setPreferredFormat("adx");
      useDownloadsStore.getState().setSelectedSourceId("g510");
      await useDownloadsStore.getState().rerunHistoryEntry(entry.key);
      const replays = useDownloadsStore.getState().jobs.filter((job) => !ids.includes(job.id));
      expect(replays).toHaveLength(2);
      expect(replays.map((job) => job.title)).toEqual(["Genre 0", "Genre 1"]);
      expect(replays.every((job) => job.format === "zip" && job.total === 2 && job.sourceId === "g510")).toBe(true);
      for (const job of replays) await waitForJob(job.id, (job) => job.status === "success");
      await waitForCondition(() => useDownloadsStore.getState().history.length === 2 && persistedSelections.size === 0);
      expect(await savedArchives()).toEqual({
        "Genre 0.zip": ["Genre 0/Song 0/pv.mp4", "Genre 0/Song 0/track.mp3"],
        "Genre 1.zip": ["Genre 1/Song 1/pv.mp4", "Genre 1/Song 1/track.mp3"],
      });
    } finally { release(); }
  });

  test("a failed child stays incomplete until retry succeeds and never records partial-selection history", async () => {
    await onMobile(async () => {
      const successfulFetch = globalThis.fetch;
      globalThis.fetch = (async (input, init) => String(input).endsWith("/8/track.mp3")
        ? new Response("missing", { status: 404 }) : successfulFetch(input, init)) as typeof fetch;
      const id = newBatchJobId();
      const ids = await useDownloadsStore.getState().startBatch({
        id, title: "Retry whole", charts: measuredCharts(17), includeVideo: false,
      });
      await waitForJob(ids[0], (job) => job.status === "ready");
      useDownloadsStore.getState().saveArchive(ids[0], 0);
      useDownloadsStore.getState().confirmSavedBatch(ids[0]);
      await waitForJob(ids[1], (job) => job.status === "error");
      await waitForJob(ids[2], (job) => job.status === "ready");
      expect(useDownloadsStore.getState().history).toEqual([]);
      expect(persistedSelections.get(id)?.completedJobIds).not.toContain(ids[1]);
      useDownloadsStore.getState().saveArchive(ids[2], 0);
      useDownloadsStore.getState().confirmSavedBatch(ids[2]);
      globalThis.fetch = successfulFetch;
      useDownloadsStore.getState().resume(ids[1]);
      await waitForJob(ids[1], (job) => job.status === "ready");
      await waitForCondition(() => useDownloadsStore.getState().history.length === 1 && persistedSelections.size === 0);
      expect(useDownloadsStore.getState().history[0].fileCount).toBe(17);
    });
  });

  test("hydrate repairs an all-completed cohort once after a crash before history cleanup", async () => {
    const job = legacyBatch("completed-selection");
    const selection = { id: job.id, job, jobIds: ["released-part0", "released-part1"], completedJobIds: ["released-part0", "released-part1"] };
    persistedSelections.set(selection.id, selection);
    persistedHistory.set(`selection:${selection.id}`, { key: `selection:${selection.id}`, job, finishedAt: 1, fileCount: job.files.length });
    useDownloadsStore.getState().hydrateFromStorage();
    await waitForCondition(() => useDownloadsStore.getState().history.length === 1 && persistedSelections.size === 0);
    expect(useDownloadsStore.getState().history[0].key).toBe(`selection:${selection.id}`);
    expect(persistedHistory.size).toBe(1);
    resetDownloadQueueForTests();
    useDownloadsStore.setState({ jobs: [], history: [] });
    useDownloadsStore.getState().hydrateFromStorage();
    await waitForCondition(() => useDownloadsStore.getState().history.length === 1);
    expect(persistedHistory.size).toBe(1);
  });

  test("unknown mobile chart sizes get standalone groups without counting excluded BGA", async () => {
    await onMobile(async () => {
      const charts = measuredCharts(4);
      charts[0].files.push({ name: "pv.mp4", url: "https://example.test/0/pv.mp4", bytes: undefined! });
      charts[1].files[0].bytes = undefined!;
      const ids = await useDownloadsStore.getState().startBatch({
        id: newBatchJobId(), title: "Mixed sizes", charts, includeVideo: false,
      });
      expect(ids.map((id) => useDownloadsStore.getState().jobs.find((job) => job.id === id)?.total)).toEqual([1, 1, 2]);
      expect(ids.map((id) => useDownloadsStore.getState().jobs.find((job) => job.id === id)?.mobileMemoryWarning)).toEqual([undefined, "unknown-size", undefined]);
      expect(useDownloadsStore.getState().jobs.every((job) => !job.mobileLegacyBatch)).toBe(true);
    });
  });

  test("more than eight mobile parts make one original-selection history entry only when all finish", async () => {
    await onMobile(async () => {
      const id = newBatchJobId();
      const ids = await useDownloadsStore.getState().startBatch({
        id, title: "Whole selection", charts: measuredCharts(72), includeVideo: false, format: "zip",
      });
      expect(ids).toHaveLength(9);
      for (const [index, childId] of ids.entries()) {
        await waitForJob(childId, (job) => job.status === "ready");
        if (index < ids.length - 1) expect(useDownloadsStore.getState().history).toEqual([]);
        expect(useDownloadsStore.getState().saveArchive(childId, 0)).toBe(true);
        expect(useDownloadsStore.getState().confirmSavedBatch(childId)).toBe(true);
      }
      await waitForCondition(() => useDownloadsStore.getState().history.length === 1 && persistedSelections.size === 0 && persistedJobs.size === 0);
      const [entry] = useDownloadsStore.getState().history;
      expect(entry.job.id).toBe(id);
      expect(entry.job.title).toBe("Whole selection");
      expect(entry.fileCount).toBe(72);
      expect(entry.job.files).toHaveLength(72);
      expect(entry.job.files.every((file) => file.bytes === 3)).toBe(true);
      expect(entry.job.dirByIndex).toEqual(measuredCharts(72).map((chart) => chart.dir));
      expect(entry.job.groupByIndex).toEqual(Array(72).fill("maimai"));
      expect(entry.job.batchSelectionId).toBeUndefined();
      expect(useDownloadsStore.getState().jobs.every((job) => job.savedArchiveInfo?.archiveCount === 1 && !job.archives)).toBe(true);
    });
  });

  test("selection completion survives reload after a completed child cache was released", async () => {
    await onMobile(async () => {
      const id = newBatchJobId();
      const ids = await useDownloadsStore.getState().startBatch({
        id, title: "Reload selection", charts: measuredCharts(17), includeVideo: false,
      });
      await waitForJob(ids[0], (job) => job.status === "ready");
      useDownloadsStore.getState().pause(ids[1]);
      useDownloadsStore.getState().pause(ids[2]);
      useDownloadsStore.getState().saveArchive(ids[0], 0);
      useDownloadsStore.getState().confirmSavedBatch(ids[0]);
      await waitForCondition(() => !persistedJobs.has(ids[0]) && persistedSelections.get(id)?.completedJobIds.includes(ids[0]) === true);
      resetDownloadQueueForTests();
      useDownloadsStore.setState({ jobs: [], history: [] });
      useDownloadsStore.getState().hydrateFromStorage();
      await waitForCondition(() => useDownloadsStore.getState().jobs.length === 2);
      expect(useDownloadsStore.getState().jobs.every((job) => !job.mobileLegacyBatch)).toBe(true);
      expect(useDownloadsStore.getState().history).toEqual([]);
      for (const childId of ids.slice(1)) {
        useDownloadsStore.getState().resume(childId);
        await waitForJob(childId, (job) => job.status === "ready");
        useDownloadsStore.getState().saveArchive(childId, 0);
        useDownloadsStore.getState().confirmSavedBatch(childId);
      }
      await waitForCondition(() => useDownloadsStore.getState().history.length === 1 && persistedSelections.size === 0);
      expect(useDownloadsStore.getState().history[0].fileCount).toBe(17);
      expect(fetchedUrls).toHaveLength(17);
    });
  });

  test("dismissing an unfinished selection child clears its cohort and cannot claim full history", async () => {
    await onMobile(async () => {
      const id = newBatchJobId();
      const ids = await useDownloadsStore.getState().startBatch({
        id, title: "Canceled selection", charts: measuredCharts(17), includeVideo: false,
      });
      await waitForJob(ids[0], (job) => job.status === "ready");
      useDownloadsStore.getState().dismiss(ids[1]);
      useDownloadsStore.getState().saveArchive(ids[0], 0);
      useDownloadsStore.getState().confirmSavedBatch(ids[0]);
      await waitForJob(ids[2], (job) => job.status === "ready");
      useDownloadsStore.getState().saveArchive(ids[2], 0);
      useDownloadsStore.getState().confirmSavedBatch(ids[2]);
      await waitForCondition(() => persistedSelections.size === 0 && persistedJobs.size === 0);
      expect(useDownloadsStore.getState().history).toEqual([]);
      expect(persistedHistory.size).toBe(0);
    });
  });

  test("resuming an old mobile batch keeps its full layout and completed checkpoints", async () => {
    await onMobile(async () => {
      const spec = legacyBatch("legacy-resume");
      seedWholeFiles(spec);
      useDownloadsStore.getState().hydrateFromStorage();
      await waitForJob(spec.id, (job) => job.status === "paused");
      expect(useDownloadsStore.getState().jobs[0].mobileLegacyBatch).toBe(true);
      useDownloadsStore.getState().resume(spec.id);
      await waitForJob(spec.id, (job) => job.status === "ready");
      expect(useDownloadsStore.getState().jobs).toHaveLength(1);
      expect(fetchedUrls).toEqual([]);
      expect(persistedJobs.get(spec.id)).toMatchObject({ id: spec.id, files: spec.files });
      expect([...persistedFiles.values()]).toHaveLength(2);
    });
  });

  test("explicit legacy restart replaces once and waits for old cache cleanup before fetching", async () => {
    await onMobile(async () => {
      const spec = legacyBatch("legacy-restart");
      seedWholeFiles(spec);
      useDownloadsStore.getState().hydrateFromStorage();
      await waitForJob(spec.id, (job) => job.status === "paused");
      let release!: () => void;
      const cleanup = new Promise<void>((resolve) => { release = resolve; });
      setDownloadsPersistenceAdapterForTests({ ...memoryPersistence, deleteJob: async (id) => {
        if (id === spec.id) await cleanup;
        await memoryPersistence.deleteJob(id);
      } });
      try {
        const ids = await useDownloadsStore.getState().restartLegacyBatch(spec.id);
        expect(ids).toHaveLength(2);
        expect(await useDownloadsStore.getState().restartLegacyBatch(spec.id)).toEqual([]);
        expect(useDownloadsStore.getState().jobs.some((job) => job.id === spec.id)).toBe(false);
        expect(useDownloadsStore.getState().jobs.every((job) => !job.mobileLegacyBatch)).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(fetchedUrls).toEqual([]);
        release();
        await waitForJob(ids[0], (job) => job.status === "ready");
        expect(fetchedUrls).toHaveLength(1);
        expect(persistedJobs.has(spec.id)).toBe(false);
        expect([...persistedFiles.values()].some((file) => file.jobId === spec.id)).toBe(false);
      } finally { release(); }
    });
  });

  test("explicit legacy restart preserves a deleted custom route snapshot", async () => {
    await onMobile(async () => {
      const baseUrl = "https://deleted.example.test/charts";
      const spec: PersistedJob = { ...legacyBatch("legacy-custom-restart"), sourceId: "custom:deleted", sourceName: "Old mirror", sourceBaseUrl: baseUrl,
        files: legacyBatch("unused").files.map((file, index) => ({ ...file, url: `${baseUrl}/25/${index}/track.mp3` })) };
      seedWholeFiles(spec);
      useDownloadsStore.getState().hydrateFromStorage();
      await waitForJob(spec.id, (job) => job.status === "paused");
      const ids = await useDownloadsStore.getState().restartLegacyBatch(spec.id);
      await waitForJob(ids[0], (job) => job.status === "ready");
      expect(useDownloadsStore.getState().jobs.every((job) => job.sourceId === "custom:deleted" && job.sourceBaseUrl === baseUrl && job.sourceName === "Old mirror")).toBe(true);
      expect(fetchedUrls).toEqual([`${baseUrl}/25/0/track.mp3`]);
    });
  });

  test("individual downloads keep one chart per file even when mobile streaming is supported", async () => {
    await onMobile(async () => {
      const disk = createMemoryArchiveStorage();
      disk.storage.estimate = async () => ({ quota: 100 * 1024 ** 3, usage: 0 });
      Object.defineProperty(navigator, "storage", { configurable: true, value: disk.storage });
      const id = newBatchJobId();
      const ids = await useDownloadsStore.getState().startBatch({
        id, title: "Selection", includeVideo: true, individual: true,
        charts: measuredCharts(2),
      });
      expect(ids).toHaveLength(2);
      expect(ids.map(id => useDownloadsStore.getState().jobs.find(job => job.id === id)?.total)).toEqual([1, 1]);
      await waitForJob(ids[0], job => job.status === "ready");
      expect(fetchedUrls).toHaveLength(1);
      expect(useDownloadsStore.getState().jobs.find(job => job.id === ids[0])?.title).toBe("Song 0");
      expect(persistedSelections.get(id)?.job.individual).toBe(true);
      useDownloadsStore.getState().saveArchive(ids[0], 0);
      useDownloadsStore.getState().confirmSavedBatch(ids[0]);
      await waitForJob(ids[1], job => job.status === "ready");
      expect(fetchedUrls).toHaveLength(2);
      useDownloadsStore.getState().saveArchive(ids[1], 0);
      useDownloadsStore.getState().confirmSavedBatch(ids[1]);
      await waitForCondition(() => useDownloadsStore.getState().history.length === 1);
      const entry = useDownloadsStore.getState().history[0];
      expect(entry.job.individual).toBe(true);
      await useDownloadsStore.getState().rerunHistoryEntry(entry.key);
      const replays = useDownloadsStore.getState().jobs.filter(job => !ids.includes(job.id));
      expect(replays).toHaveLength(2);
      expect(replays.map(job => job.total)).toEqual([1, 1]);
    });
  });

  test("stream-capable mobile batches keep more than eight songs together by version", async () => {
    await onMobile(async () => {
      const disk = createMemoryArchiveStorage();
      disk.storage.estimate = async () => ({ quota: 100 * 1024 ** 3, usage: 0 });
      Object.defineProperty(navigator, "storage", { configurable: true, value: disk.storage });
      const ids = await useDownloadsStore.getState().startBatch({
        id: newBatchJobId(), title: "Versions", includeVideo: true,
        charts: measuredCharts(10).map((chart, index) => ({ ...chart, groupDir: index < 9 ? "Version A" : "Version B",
          files: chart.files.map(file => ({...file, bytes: 200 * 1024 ** 2})) })),
      });
      expect(ids).toHaveLength(2);
      expect(ids.map(id => useDownloadsStore.getState().jobs.find(job => job.id === id)?.total)).toEqual([9, 1]);
      await waitForJob(ids[0], job => job.status === "ready");
      expect(useDownloadsStore.getState().jobs.find(job => job.id === ids[0])?.mobileMemoryWarning).toBeUndefined();
      expect(fetchedUrls).toHaveLength(9);
      useDownloadsStore.getState().saveArchive(ids[0], 0);
      useDownloadsStore.getState().confirmSavedBatch(ids[0]);
      await waitForJob(ids[1], job => job.status === "ready");
    });
  });

  test("stream API with insufficient quota preserves mobile small parts before fetching", async () => {
    await onMobile(async () => {
      const disk = createMemoryArchiveStorage();
      disk.storage.estimate = async () => ({ quota: 1, usage: 0 });
      Object.defineProperty(navigator, "storage", { configurable: true, value: disk.storage });
      const ids = await useDownloadsStore.getState().startBatch({
        id: newBatchJobId(), title: "Low space", charts: measuredCharts(9), includeVideo: true,
      });
      expect(ids).toHaveLength(2);
      await waitForJob(ids[0], job => job.status === "ready");
      expect(fetchedUrls).toHaveLength(8);
      expect(disk.files.size).toBe(0);
    });
  });

  test("disk failure replans the full version into small parts without fetching completed songs again", async () => {
    await onMobile(async () => {
      let rewrites = 0;
      setDownloadsPersistenceAdapterForTests({...memoryPersistence, persistFile: async (file) => {
        if (persistedFiles.get(file.key)?.blob === file.blob) rewrites++;
        await memoryPersistence.persistFile(file);
      }});
      const disk = createMemoryArchiveStorage();
      const getRoot = disk.storage.getDirectory;
      disk.storage.getDirectory = async () => {
        const root = await getRoot();
        const directory = await root.getDirectoryHandle();
        const getHandle = directory.getFileHandle;
        return {getDirectoryHandle: async () => ({...directory, getFileHandle: async (name: string) => {
          const handle = await getHandle(name);
          return {...handle, createWritable: async () => new WritableStream<Uint8Array>({
            write(chunk) { if (chunk.length > 1) throw new DOMException("Quota exhausted", "QuotaExceededError"); },
          })};
        }})};
      };
      Object.defineProperty(navigator, "storage", { configurable: true, value: disk.storage });
      const [parent] = await useDownloadsStore.getState().startBatch({
        id: newBatchJobId(), title: "Runtime fallback", charts: measuredCharts(9), includeVideo: true,
      });
      await waitForCondition(() => useDownloadsStore.getState().jobs.some(job => job.fallbackParentId === parent));
      const children = useDownloadsStore.getState().jobs.filter(job => job.fallbackParentId === parent);
      expect(children).toHaveLength(2);
      await waitForJob(children[0].id, job => job.status === "ready");
      expect(fetchedUrls).toHaveLength(9);
      useDownloadsStore.getState().saveArchive(children[0].id, 0);
      useDownloadsStore.getState().confirmSavedBatch(children[0].id);
      await waitForJob(children[1].id, job => job.status === "ready");
      expect(fetchedUrls).toHaveLength(9);
      await waitForCondition(() => useDownloadsStore.getState().history.length === 1);
      expect(useDownloadsStore.getState().history[0].fileCount).toBe(9);
      expect(rewrites).toBe(0);
    });
  });

  test("a queued version loses disk headroom and splits before its first fetch", async () => {
    await onMobile(async () => {
      const disk = createMemoryArchiveStorage();
      Object.defineProperty(navigator, "storage", { configurable: true, value: disk.storage });
      const ids = await useDownloadsStore.getState().startBatch({
        id: newBatchJobId(), title: "Headroom", charts: measuredCharts(10).map((chart, index) => ({...chart, groupDir: index === 0 ? "A" : "B"})), includeVideo: true,
      });
      expect(ids).toHaveLength(2);
      await waitForJob(ids[0], job => job.status === "ready");
      expect(fetchedUrls).toHaveLength(1);
      disk.storage.estimate = async () => ({quota: 1, usage: 0});
      useDownloadsStore.getState().saveArchive(ids[0], 0);
      useDownloadsStore.getState().confirmSavedBatch(ids[0]);
      await waitForCondition(() => useDownloadsStore.getState().jobs.filter(job => job.fallbackParentId === ids[1]).length === 2);
      const children = useDownloadsStore.getState().jobs.filter(job => job.fallbackParentId === ids[1]);
      await waitForJob(children[0].id, job => job.status === "ready");
      expect(fetchedUrls).toHaveLength(9);
      useDownloadsStore.getState().saveArchive(children[0].id, 0);
      useDownloadsStore.getState().confirmSavedBatch(children[0].id);
      await waitForJob(children[1].id, job => job.status === "ready");
      expect(fetchedUrls).toHaveLength(10);
      await waitForCondition(() => useDownloadsStore.getState().history.length === 1);
      expect(useDownloadsStore.getState().history[0].fileCount).toBe(10);
    });
  });

  test("confirmed mobile saves release the disk archive before fetching the next part", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const disk = createMemoryArchiveStorage();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      userAgent: "Mozilla/5.0 (iPhone)", onLine: true, storage: disk.storage,
    } });
    try {
      const ids = await useDownloadsStore.getState().startBatch({
        id: newBatchJobId(), title: "Disk cleanup", includeVideo: true, format: "adx",
        charts: Array.from({ length: 9 }, (_, index) => ({
          groupDir: index < 8 ? "Version A" : "Version B",
          dir: `Song ${index}`, files: [{ name: "track.mp3", url: `https://example.test/${index}/track.mp3`, bytes: 3 }],
        })),
      });
      await waitForJob(ids[0], (job) => job.status === "ready");
      expect(disk.files.size).toBe(1);
      expect(fetchedUrls).toHaveLength(8);
      expect(useDownloadsStore.getState().saveArchive(ids[0], 0)).toBe(true);
      expect(useDownloadsStore.getState().confirmSavedBatch(ids[0])).toBe(true);
      await waitForJob(ids[1], (job) => job.status === "ready");
      expect(disk.removed.length).toBeGreaterThanOrEqual(1);
      expect(disk.files.size).toBe(1); // Only the second part is retained.
    } finally {
      for (const job of useDownloadsStore.getState().jobs) useDownloadsStore.getState().dismiss(job.id);
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });

  test("mobile batches retain save retries and fetch the next small group only after explicit dismissal", async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      userAgent: "Mozilla/5.0 (iPhone)", onLine: true,
    } });
    let releaseCleanup: (() => void) | undefined;
    try {
      const revokedUrls: string[] = [];
      URL.revokeObjectURL = (url) => { revokedUrls.push(url); };
      const charts = Array.from({ length: 18 }, (_, index) => ({
        dir: `Song ${index}`, groupDir: "maimai",
        files: [{ name: "track.mp3", url: `https://example.test/${index}/track.mp3`, bytes: 3 }],
      }));
      const ids = await useDownloadsStore.getState().startBatch({
        id: newBatchJobId(), title: "Collection", charts, includeVideo: false,
      });
      expect(ids).toHaveLength(3);
      await waitForJob(ids[0], (job) => job.status === "ready");
      expect(fetchedUrls).toHaveLength(8);
      expect(useDownloadsStore.getState().confirmSavedBatch(ids[0])).toBe(false);
      expect(useDownloadsStore.getState().jobs.find((job) => job.id === ids[1])?.status).toBe("queued");
      expect(useDownloadsStore.getState().saveArchive(ids[0], 0)).toBe(true);
      expect(useDownloadsStore.getState().saveArchive(ids[0], 0)).toBe(true);
      expect(revokedUrls).toHaveLength(0);
      expect(fetchedUrls).toHaveLength(8);
      expect(useDownloadsStore.getState().jobs.find((job) => job.id === ids[1])?.status).toBe("queued");
      const cleanupPending = new Promise<void>((resolve) => { releaseCleanup = resolve; });
      setDownloadsPersistenceAdapterForTests({
        ...memoryPersistence,
        deleteJob: async (id) => {
          if (id === ids[0]) await cleanupPending;
          await memoryPersistence.deleteJob(id);
        },
      });
      expect(useDownloadsStore.getState().confirmSavedBatch(ids[0])).toBe(true);
      expect(revokedUrls).toHaveLength(2);
      expect(useDownloadsStore.getState().jobs.find((job) => job.id === ids[0])?.status).toBe("success");
      expect(useDownloadsStore.getState().jobs.find((job) => job.id === ids[0])?.archives).toBeUndefined();
      expect(useDownloadsStore.getState().jobs.find((job) => job.id === ids[0])?.savedArchiveInfo).toEqual({
        fileNames: ["Collection (1).adx"], archiveCount: 1, format: "adx",
      });
      expect(useDownloadsStore.getState().jobs.find((job) => job.id === ids[0])?.completed).toBe(8);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(fetchedUrls).toHaveLength(8);
      releaseCleanup?.();
      await waitForJob(ids[1], (job) => job.status === "ready");
      expect(fetchedUrls).toHaveLength(16);
      expect([...persistedFiles.values()].filter((file) => file.jobId === ids[0])).toHaveLength(0);
      expect(useDownloadsStore.getState().saveArchive(ids[1], 0)).toBe(true);
      expect(useDownloadsStore.getState().confirmSavedBatch(ids[1])).toBe(true);
      await waitForJob(ids[2], (job) => job.status === "ready");
      expect(fetchedUrls).toHaveLength(18);
      expect(useDownloadsStore.getState().saveArchive(ids[2], 0)).toBe(true);
      expect(useDownloadsStore.getState().saveArchive(ids[2], 0)).toBe(true);
      expect(fetchedUrls).toHaveLength(18);
      const archives = await savedArchives();
      expect(Object.keys(archives)).toEqual(["Collection (1).adx", "Collection (2).adx", "Collection (3).adx"]);
      expect(Object.values(archives).flat()).toHaveLength(18);
      expect(Object.values(archives).flat()).toContain("maimai/Song 17/track.mp3");
    } finally {
      releaseCleanup?.();
      for (const job of useDownloadsStore.getState().jobs) useDownloadsStore.getState().dismiss(job.id);
      if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
      else delete (globalThis as Record<string, unknown>).navigator;
    }
  });

  test("mobile downloads have one active job and at most two file requests", async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      userAgent: "Mozilla/5.0 (Android)", onLine: true,
    } });
    let active = 0;
    let peak = 0;
    globalThis.fetch = (async (input) => {
      fetchedUrls.push(String(input));
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return new Response(new Uint8Array([1]), { headers: { "content-length": "1" } });
    }) as typeof fetch;
    try {
      const charts = Array.from({ length: 4 }, (_, index) => ({
        dir: `Song ${index}`, groupDir: index < 2 ? "one" : "two",
        files: ["track.mp3", "bg.png", "pv.mp4"].map((name) => ({
          name, url: `https://example.test/${index}/${name}`, bytes: 1,
        })),
      }));
      const ids = await useDownloadsStore.getState().startBatch({
        id: newBatchJobId(), title: "Concurrency", charts, includeVideo: true,
      });
      await waitForJob(ids[0], (job) => job.status === "ready");
      expect(peak).toBe(2);
      expect(fetchedUrls).toHaveLength(6);
      expect(useDownloadsStore.getState().jobs.find((job) => job.id === ids[1])?.status).toBe("queued");
      useDownloadsStore.getState().saveArchive(ids[0], 0);
      useDownloadsStore.getState().confirmSavedBatch(ids[0]);
      await waitForJob(ids[1], (job) => job.status === "ready");
      expect(peak).toBe(2);
      expect(fetchedUrls).toHaveLength(12);
    } finally {
      for (const job of useDownloadsStore.getState().jobs) useDownloadsStore.getState().dismiss(job.id);
      if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
      else delete (globalThis as Record<string, unknown>).navigator;
    }
  });

  test("rerunning a legacy large batch from mobile history uses the same small-group policy", async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      userAgent: "Mozilla/5.0 (iPhone)", onLine: true,
    } });
    try {
      useDownloadsStore.setState({ history: [{
        key: "legacy-history", finishedAt: 1, fileCount: 18,
        job: {
          id: "old-large-batch", kind: "batch", title: "Old collection", format: "zip", createdAt: 1,
          files: Array.from({ length: 18 }, (_, index) => ({
            name: `${index}/track.mp3`, url: `https://example.test/${index}/track.mp3`,
          })),
          dirByIndex: Array.from({ length: 18 }, (_, index) => `Song ${index}`),
          groupByIndex: Array.from({ length: 18 }, () => "maimai"),
        },
      }] });
      await useDownloadsStore.getState().rerunHistoryEntry("legacy-history");
      const jobs = useDownloadsStore.getState().jobs;
      expect(jobs.map((job) => job.total)).toEqual(Array(18).fill(1));
      expect(jobs.every((job) => job.mobileMemoryWarning === "unknown-size")).toBe(true);
      expect(jobs.every((job) => job.id !== "old-large-batch" && job.mobileBatch)).toBe(true);
      await waitForJob(jobs[0].id, (job) => job.status === "ready");
      useDownloadsStore.getState().saveArchive(jobs[0].id, 0);
      const archives = await savedArchives();
      expect(Object.keys(archives)).toEqual(["Old collection (1).zip"]);
      expect(archives["Old collection (1).zip"]).toEqual(["maimai/Song 0/track.mp3"]);
      expect(fetchedUrls).toHaveLength(1);
    } finally {
      for (const job of useDownloadsStore.getState().jobs) useDownloadsStore.getState().dismiss(job.id);
      if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
      else delete (globalThis as Record<string, unknown>).navigator;
    }
  });

  test("mobile grouping uses measured bytes excluding BGA and keeps oversized single charts whole", async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      userAgent: "Mozilla/5.0 (Android)", onLine: true,
    } });
    try {
      const charts = [80, 40, 160, 1].map((mib, index) => ({
        dir: `Song ${index}`, groupDir: "maimai",
        files: [
          { name: "track.mp3", url: `https://example.test/${index}/track.mp3`, bytes: mib * 1024 ** 2 },
          { name: "pv.mp4", url: `https://example.test/${index}/pv.mp4`, bytes: 512 * 1024 ** 2 },
        ],
      }));
      const ids = await useDownloadsStore.getState().startBatch({
        id: newBatchJobId(), title: "Bytes", charts, includeVideo: false,
      });
      expect(ids).toHaveLength(3);
      expect(ids.map((id) => persistedJobs.get(id)?.files.length ??
        useDownloadsStore.getState().jobs.find((job) => job.id === id)?.total)).toEqual([2, 1, 1]);
      expect(useDownloadsStore.getState().jobs.every((job) => job.mobileBatch)).toBe(true);
      expect(useDownloadsStore.getState().jobs.find((job) => job.id === ids[1])?.mobileMemoryWarning).toBe("oversized-chart");
    } finally {
      for (const job of useDownloadsStore.getState().jobs) useDownloadsStore.getState().dismiss(job.id);
      if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
      else delete (globalThis as Record<string, unknown>).navigator;
    }
  });

  test("completed history preserves measured bytes while canonicalizing mirrors for mobile replay", async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      userAgent: "Mozilla/5.0 (Macintosh)", onLine: true,
    } });
    try {
      const id = newBatchJobId();
      const charts = [0, 1].map((index) => ({
        dir: `Song ${index}`, groupDir: "maimai",
        files: [{ name: "track.mp3", bytes: 80 * 1024 ** 2,
          url: `https://astrodx-charts.saop.cc/25/${index}/track.mp3` }],
      }));
      await useDownloadsStore.getState().startBatch({
        id, title: "Measured history", charts, sourceId: "g510", includeVideo: false, format: "zip",
      });
      await waitForSettled(id);
      await waitForCondition(() => useDownloadsStore.getState().history.length > 0);
      const [entry] = useDownloadsStore.getState().history;
      expect(entry!.job.files.map((file) => file.url)).toEqual(charts.map((chart) => chart.files[0].url));
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
        userAgent: "Mozilla/5.0 (iPhone)", onLine: true,
      } });
      await useDownloadsStore.getState().rerunHistoryEntry(entry!.key);
      const replays = useDownloadsStore.getState().jobs.filter((job) => job.id !== id);
      expect(replays.map((job) => job.total)).toEqual([1, 1]);
      expect(entry!.job.files.map((file) => file.bytes)).toEqual([80 * 1024 ** 2, 80 * 1024 ** 2]);
      expect(replays.map((job) => job.title)).toEqual(["Measured history (1)", "Measured history (2)"]);
    } finally {
      for (const job of useDownloadsStore.getState().jobs) useDownloadsStore.getState().dismiss(job.id);
      if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
      else delete (globalThis as Record<string, unknown>).navigator;
    }
  });

  test("a mobile archive can be rebuilt after reload without fetching its completed files again", async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      userAgent: "Mozilla/5.0 (iPhone)", onLine: true,
    } });
    try {
      const id = "single:reload-save";
      useDownloadsStore.getState().startSingle({
        id, title: "Reload chart", includeVideo: false, format: "adx",
        files: [{ name: "track.mp3", url: "https://example.test/reload/track.mp3" }],
      });
      await waitForSettled(id);
      expect(useDownloadsStore.getState().jobs.find((job) => job.id === id)?.status).toBe("ready");
      const fetchCount = fetchedUrls.length;
      resetDownloadQueueForTests();
      useDownloadsStore.setState({ jobs: [] });
      useDownloadsStore.getState().hydrateFromStorage();
      await waitForJob(id, (job) => job.status === "paused");
      useDownloadsStore.getState().resume(id);
      await waitForSettled(id);
      expect(fetchedUrls.length).toBe(fetchCount);
      expect(savedFiles).toEqual([]);
      expect(useDownloadsStore.getState().jobs.find((job) => job.id === id)?.status).toBe("ready");
      expect(useDownloadsStore.getState().saveArchive(id, 0)).toBe(true);
      expect(await savedArchives()).toEqual({ "Reload chart.adx": ["Reload chart/track.mp3"] });
    } finally {
      if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
      else delete (globalThis as Record<string, unknown>).navigator;
    }
  });

  test("mobile batch waits for individual save gestures and retains bytes for retries", async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      userAgent: "Mozilla/5.0 (Linux; Android 12; HarmonyOS) HuaweiBrowser/17.0",
      onLine: true,
    } });
    try {
      const id = newBatchJobId();
      const charts = ["A", "B"].map((dir, index) => {
        const url = `https://example.test/${index}/track.mp3`;
        const name = `${index}/track.mp3`;
        const blob = new Blob([dir]);
        Object.defineProperty(blob, "size", { value: 1_200_000_000 });
        persistedFiles.set(`${id}::${name}`, {
          key: `${id}::${name}`, jobId: id, name, url, blob, size: blob.size, complete: true,
        });
        return { dir, genreDir: "maimai", groupDir: "v1", files: [{ name: "track.mp3", url, bytes: 1 }] };
      });
      const ids = await useDownloadsStore.getState().startBatch({
        id, title: "maimai", includeVideo: false, format: "zip", grouping: "genre", charts,
      });
      expect(ids).toEqual([id]);
      await waitForSettled(id);
      let job = useDownloadsStore.getState().jobs.find((entry) => entry.id === id)!;
      expect(job.status).toBe("ready");
      expect(savedFiles).toEqual([]);
      expect(persistedJobs.has(id)).toBe(true);
      expect([...persistedFiles.values()].filter((file) => file.jobId === id)).toHaveLength(2);
      const downloadsBeforeSave = fetchedUrls.length;
      expect(useDownloadsStore.getState().saveArchive(id, 0)).toBe(true);
      expect(savedFiles).toEqual(["maimai (1).zip"]);
      expect(useDownloadsStore.getState().jobs.find((entry) => entry.id === id)?.status).toBe("ready");
      expect(useDownloadsStore.getState().saveArchive(id, 1)).toBe(true);
      job = useDownloadsStore.getState().jobs.find((entry) => entry.id === id)!;
      expect(job.status).toBe("success");
      expect(savedFiles).toEqual(["maimai (1).zip", "maimai (2).zip"]);
      expect(useDownloadsStore.getState().saveArchive(id, 0)).toBe(true);
      expect(savedFiles).toEqual(["maimai (1).zip", "maimai (2).zip", "maimai (1).zip"]);
      expect(fetchedUrls.length).toBe(downloadsBeforeSave);
      const createElement = document.createElement;
      document.createElement = (() => ({
        style: { display: "" }, remove() {},
        click() { throw new Error("Browser refused the save"); },
      })) as unknown as typeof document.createElement;
      expect(useDownloadsStore.getState().saveArchive(id, 0)).toBe(false);
      expect(useDownloadsStore.getState().jobs.find((entry) => entry.id === id)?.status).toBe("ready");
      expect(useDownloadsStore.getState().jobs.find((entry) => entry.id === id)?.archives?.[0].error).toBe(true);
      document.createElement = createElement;
      expect(useDownloadsStore.getState().saveArchive(id, 0)).toBe(true);
      expect(fetchedUrls.length).toBe(downloadsBeforeSave);
      expect(await savedArchives()).toEqual({
        "maimai (1).zip": ["maimai/A/track.mp3"],
        "maimai (2).zip": ["maimai/B/track.mp3"],
      });
      useDownloadsStore.getState().dismiss(id);
      expect(useDownloadsStore.getState().saveArchive(id, 0)).toBe(false);
      await waitForCondition(() => !persistedJobs.has(id));
      expect([...persistedFiles.values()].filter((file) => file.jobId === id)).toHaveLength(0);
    } finally {
      if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
      else delete (globalThis as Record<string, unknown>).navigator;
    }
  });

  beforeEach(() => {
    installDomShims();
    persistedJobs.clear();
    persistedFiles.clear();
    persistedHistory.clear();
    persistedSelections.clear();
    setDownloadsPersistenceAdapterForTests(memoryPersistence);
    setDownloadRetryBaseDelayForTests(1);
    resetDownloadQueueForTests();
    resetPackableAliasIndexForTests();
    useDownloadsStore.setState({
      jobs: [],
      history: [],
      presented: {},
      selectedSourceId: "r2",
      customSources: [],
      preferredFormat: "adx",
      preferredBatchGrouping: "version",
      maidataAliases: false,
      maidataPreciseLevels: true,
      sourceProbes: createInitialDownloadSourceProbes(),
    });
  });

  afterEach(() => {
    useDownloadsStore.setState({
      jobs: [],
      presented: {},
      selectedSourceId: "r2",
      customSources: [],
      preferredFormat: "adx",
      preferredBatchGrouping: "version",
      maidataAliases: false,
      maidataPreciseLevels: true,
      sourceProbes: createInitialDownloadSourceProbes(),
    });
    setDownloadsPersistenceAdapterForTests(null);
    setDownloadRetryBaseDelayForTests(undefined);
    resetDownloadQueueForTests();
    // After every test, not just at the end of the file: the next test's
    // beforeEach reinstalls the shims, and no test here may leak them out.
    restoreGlobals();
  });

  test("denied localStorage property access preserves hydration and preference changes", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => { throw new DOMException("Denied", "SecurityError"); },
    });
    try {
      expect(() => useDownloadsStore.getState().hydrateFromStorage()).not.toThrow();
      expect(() => useDownloadsStore.getState().setPreferredFormat("zip")).not.toThrow();
      expect(() => useDownloadsStore.getState().setPreferredBatchGrouping("genre")).not.toThrow();
      expect(() => useDownloadsStore.getState().setMaidataAliases(true)).not.toThrow();
      expect(useDownloadsStore.getState()).toMatchObject({ preferredFormat: "zip", preferredBatchGrouping: "genre", maidataAliases: true });
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  test("summarizeDownloadJobs rolls a queue up into one headline state", () => {
    const job = (patch: Partial<DownloadJob>): DownloadJob => ({
      id: patch.id ?? "j",
      kind: "batch",
      title: "t",
      sourceId: "r2",
      format: "adx",
      status: "queued",
      completed: 0,
      total: 10,
      receivedBytes: 0,
      totalBytes: 0,
      totalBytesEstimated: false,
      speedBps: 0,
      etaMs: null,
      fileProgress: [],
      archiveCurrentFile: null,
      error: null,
      errorKind: null,
      errorDetail: null,
      skippedFiles: [],
      autoSwitchedTo: null,
      startedAt: 0,
      ...patch,
    });

    expect(summarizeDownloadJobs([])).toMatchObject({ status: "idle", percent: 0 });
    // A job still moving outranks a sibling that already failed.
    expect(
      summarizeDownloadJobs([
        job({ id: "a", status: "error" }),
        job({ id: "b", status: "packing" }),
      ]).status
    ).toBe("packing");
    expect(
      summarizeDownloadJobs([
        job({ id: "a", status: "success" }),
        job({ id: "b", status: "error" }),
      ])
    ).toMatchObject({ status: "error", done: 1, total: 2 });
    expect(
      summarizeDownloadJobs([
        job({ id: "a", status: "queued" }),
        job({ id: "b", status: "queued" }),
      ]).status
    ).toBe("queued");

    // Percent is weighted by file count: a finished 90-file job plus an
    // untouched 10-file job is 90%, not the 50% a flat average would report.
    expect(
      summarizeDownloadJobs([
        job({ id: "a", status: "success", total: 90 }),
        job({ id: "b", status: "queued", total: 10 }),
      ]).percent
    ).toBe(90);
  });

  test("migrates the legacy singleton only when the versioned collection is absent", () => {
    const legacyUrl = "https://legacy.example.com/charts/";
    expect(parseStoredCustomSources(null, legacyUrl)).toEqual([
      {
        id: CUSTOM_DOWNLOAD_SOURCE_ID,
        name: "Custom",
        baseUrl: "https://legacy.example.com/charts",
      },
    ]);
    expect(
      parseStoredCustomSources(
        JSON.stringify({ version: 1, sources: [] }),
        legacyUrl
      )
    ).toEqual([]);
    expect(parseStoredCustomSources("{broken", legacyUrl)).toEqual([]);
  });

  test("hydration reroutes legacy jobs and preserves a custom job URL snapshot", async () => {
    const legacyId = singleJobId("legacy-origin-resume");
    const customId = singleJobId("custom-origin-resume");
    const savedCustomSourceUrl = "https://mirror-a.example.com/charts";
    const currentCustomSourceUrl = "https://mirror-b.example.com/media";
    localStorageValues.set("astrodx-download-source", "custom");
    localStorageValues.set(
      "astrodx-custom-download-source",
      currentCustomSourceUrl
    );
    persistedJobs.set(legacyId, {
      id: legacyId,
      kind: "single",
      title: "legacy-origin-resume",
      format: "adx",
      createdAt: Date.now(),
      files: [
        {
          name: "maidata.txt",
          url: "https://adxcs.saop.cc/25/11951/maidata.txt",
        },
      ],
    });
    persistedJobs.set(customId, {
      id: customId,
      kind: "single",
      title: "custom-origin-resume",
      format: "adx",
      createdAt: Date.now(),
      sourceId: "custom",
      sourceBaseUrl: savedCustomSourceUrl,
      files: [
        {
          name: "track.mp3",
          url: `${savedCustomSourceUrl}/25/11951/track.mp3`,
        },
      ],
    });

    localStorageValues.set("astrodx-maidata-aliases", "1");
    localStorageValues.set("astrodx-maidata-precise-levels", "0");
    useDownloadsStore.getState().hydrateFromStorage();
    expect(useDownloadsStore.getState().maidataAliases).toBe(true);
    expect(useDownloadsStore.getState().maidataPreciseLevels).toBe(false);
    await waitForJob(legacyId, (job) => job.status === "paused");
    await waitForJob(customId, (job) => job.status === "paused");
    expect(
      useDownloadsStore.getState().jobs.find((job) => job.id === legacyId)
        ?.sourceId
    ).toBe("r2");
    expect(
      useDownloadsStore.getState().jobs.find((job) => job.id === customId)
    ).toMatchObject({
      sourceId: CUSTOM_DOWNLOAD_SOURCE_ID,
      sourceBaseUrl: savedCustomSourceUrl,
    });
    expect(useDownloadsStore.getState()).toMatchObject({
      selectedSourceId: CUSTOM_DOWNLOAD_SOURCE_ID,
      customSources: [
        {
          id: CUSTOM_DOWNLOAD_SOURCE_ID,
          name: "Custom",
          baseUrl: currentCustomSourceUrl,
        },
      ],
    });

    useDownloadsStore.getState().resume(customId);
    await waitForJob(customId, (job) => job.status === "success");
    useDownloadsStore.getState().resume(legacyId);
    await waitForJob(legacyId, (job) => job.status === "success");
    // The alias setting hydrated above makes each resumed job also fetch the
    // manifest; the routes the chart files themselves took are what matter here.
    expect(fetchedUrls.filter((url) => !url.endsWith("/charts/aliases.json"))).toEqual([
      `${savedCustomSourceUrl}/25/11951/track.mp3`,
      "https://astrodx-charts.saop.cc/25/11951/maidata.txt",
    ]);
  });

  test("shares the selected source and records it on new jobs", async () => {
    useDownloadsStore.getState().setSelectedSourceId("alice");
    expect(useDownloadsStore.getState().selectedSourceId).toBe("alice");

    const id = singleJobId("source-routed");
    useDownloadsStore.getState().startSingle({
      id,
      title: "source-routed",
      files: [
        {
          name: "track.mp3",
          url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
        },
      ],
      includeVideo: true,
      format: "adx",
    });

    expect(useDownloadsStore.getState().jobs.find((job) => job.id === id)?.sourceId).toBe(
      "alice"
    );
    await waitForSettled(id);
    expect(fetchedUrls).toContain(
      "https://astrodx-charts-alice.saop.cc/25/11951/track.mp3"
    );
  });

  test("tags [SD] titles and heals old-style dirs in the packed archive only", async () => {
    const stMaidata = "&title=ジングルベル\r\n&artist=SEGA\r\n&shortid=70\r\n&inote_2=(100)E\r\n";
    const dxMaidata = "&title=ジングルベル\r\n&artist=SEGA\r\n&shortid=10070\r\n&inote_2=(100)E\r\n";
    const encoder = new TextEncoder();
    globalThis.fetch = (async (input) => {
      const url = String(input);
      fetchedUrls.push(url);
      const body = url.includes("/0/70/")
        ? encoder.encode(stMaidata)
        : url.includes("/19/10070/")
          ? encoder.encode(dxMaidata)
          : new Uint8Array([1, 2, 3]);
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.length) },
      });
    }) as typeof fetch;

    for (const [dir, url] of [
      ["st-jingle", "https://astrodx-charts.saop.cc/0/70/maidata.txt"],
      ["dx-jingle", "https://astrodx-charts.saop.cc/19/10070/maidata.txt"],
    ] as const) {
      const id = singleJobId(dir);
      useDownloadsStore.getState().startSingle({
        id,
        title: dir,
        files: [{ name: "maidata.txt", url }],
        includeVideo: true,
        format: "adx",
      });
      await waitForSettled(id);
    }

    const decoder = new TextDecoder();
    const unpacked = Object.fromEntries(
      await Promise.all(
        savedFiles.map(async (name, index) => {
          const entries = unzipSync(new Uint8Array(await savedBlobs[index]!.arrayBuffer()));
          const maidata = Object.entries(entries).find(([path]) => path.endsWith("maidata.txt"));
          return [name, decoder.decode(maidata![1])] as const;
        })
      )
    );
    // The standard chart is tagged; the DX chart's maidata is untouched byte
    // for byte. The old-style dirs the job was started with ("st-jingle",
    // "dx-jingle") are healed from each maidata's &shortid into the id-prefixed
    // archive names. (Pack-time-only is covered by maidata-title.test.ts's
    // blob-identity cases; a successful job deletes its checkpoints, so there
    // is nothing persisted left to compare here.)
    expect(unpacked["000070 st-jingle.adx"]).toContain("&title=[SD] ジングルベル\r\n");
    expect(unpacked["010070 dx-jingle.adx"]).toBe(dxMaidata);
    // With aliases off (the default) the manifest is never even requested.
    expect(fetchedUrls).not.toContain("/charts/aliases.json");
  });

  test("appends aliases and collapses levels in the packed maidata when the options say so", async () => {
    const sdMaidata =
      "&title=ジングルベル\r\n&artist=SEGA\r\n&shortid=70\r\n&lv_5=14.6\r\n&inote_5=(100)E\r\n";
    const encoder = new TextEncoder();
    globalThis.fetch = (async (input) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url.endsWith("/charts/aliases.json")) {
        return Response.json({ "70": ["圣诞歌", "铃儿响叮当"], "10070": ["dx圣诞"] });
      }
      const body = url.includes("/0/70/") ? encoder.encode(sdMaidata) : new Uint8Array([1, 2, 3]);
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.length) },
      });
    }) as typeof fetch;

    useDownloadsStore.getState().setMaidataAliases(true);
    useDownloadsStore.getState().setMaidataPreciseLevels(false);
    expect(localStorageValues.get("astrodx-maidata-aliases")).toBe("1");
    expect(localStorageValues.get("astrodx-maidata-precise-levels")).toBe("0");

    const id = singleJobId("alias-jingle");
    useDownloadsStore.getState().startSingle({
      id,
      title: "alias-jingle",
      files: [
        { name: "maidata.txt", url: "https://astrodx-charts.saop.cc/0/70/maidata.txt" },
      ],
      includeVideo: true,
      format: "adx",
    });
    await waitForSettled(id);

    expect(useDownloadsStore.getState().jobs.find((job) => job.id === id)?.status).toBe(
      "success"
    );
    const entries = unzipSync(new Uint8Array(await savedBlobs[0]!.arrayBuffer()));
    const maidata = Object.entries(entries).find(([path]) => path.endsWith("maidata.txt"));
    const packed = new TextDecoder().decode(maidata![1]);
    expect(packed).toContain("&title=[SD] ジングルベル (圣诞歌/铃儿响叮当)\r\n");
    expect(packed).toContain("&lv_5=14+\r\n");
    expect(fetchedUrls).toContain("/charts/aliases.json");
  });

  test("still packs, without aliases, when the alias manifest cannot be fetched", async () => {
    const sdMaidata = "&title=ジングルベル\r\n&shortid=70\r\n&lv_5=14.4\r\n&inote_5=(100)E\r\n";
    const encoder = new TextEncoder();
    globalThis.fetch = (async (input) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url.endsWith("/charts/aliases.json")) {
        return new Response("nope", { status: 500 });
      }
      const body = encoder.encode(sdMaidata);
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.length) },
      });
    }) as typeof fetch;

    useDownloadsStore.getState().setMaidataAliases(true);
    // The store reports the (expected) miss on the console; keep the run quiet.
    const warn = console.warn;
    console.warn = () => {};
    const id = singleJobId("alias-offline");
    useDownloadsStore.getState().startSingle({
      id,
      title: "alias-offline",
      files: [
        { name: "maidata.txt", url: "https://astrodx-charts.saop.cc/0/70/maidata.txt" },
      ],
      includeVideo: true,
      format: "adx",
    });
    try {
      await waitForSettled(id);
    } finally {
      console.warn = warn;
    }

    expect(useDownloadsStore.getState().jobs.find((job) => job.id === id)?.status).toBe(
      "success"
    );
    const entries = unzipSync(new Uint8Array(await savedBlobs[0]!.arrayBuffer()));
    const maidata = Object.entries(entries).find(([path]) => path.endsWith("maidata.txt"));
    const packed = new TextDecoder().decode(maidata![1]);
    expect(packed).toContain("&title=[SD] ジングルベル\r\n");
    // Constants stay precise by default even though the alias switch is on.
    expect(packed).toContain("&lv_5=14.4\r\n");
  });

  test("uses and persists the preferred format when a start omits an override", async () => {
    useDownloadsStore.getState().setPreferredFormat("zip");
    expect(localStorageValues.get("astrodx-download-format")).toBe("zip");

    const id = singleJobId("preferred-format");
    useDownloadsStore.getState().startSingle({
      id,
      title: "preferred-format",
      files: [{ name: "maidata.txt", url: "https://example.test/maidata.txt" }],
      includeVideo: true,
    });

    await waitForSettled(id);
    expect(
      useDownloadsStore.getState().jobs.find((job) => job.id === id)?.format
    ).toBe("zip");
    expect(savedFiles).toEqual(["preferred-format.zip"]);
  });

  test("rejects invalid or built-in removal and restores R2 after deleting the selected custom route", () => {
    expect(
      useDownloadsStore
        .getState()
        .addCustomSource("Unsafe", "javascript:alert(1)")
    ).toBeNull();
    useDownloadsStore.getState().setSelectedSourceId(
      CUSTOM_DOWNLOAD_SOURCE_ID
    );
    expect(useDownloadsStore.getState().selectedSourceId).toBe("r2");

    const customId = useDownloadsStore
      .getState()
      .addCustomSource("My mirror", "https://mirror.example.com/charts/");
    expect(customId).not.toBeNull();
    useDownloadsStore
      .getState()
      .setSelectedSourceId(customId ?? CUSTOM_DOWNLOAD_SOURCE_ID);
    expect(useDownloadsStore.getState().removeCustomSource("r2")).toBe(false);
    expect(
      useDownloadsStore
        .getState()
        .removeCustomSource(customId ?? CUSTOM_DOWNLOAD_SOURCE_ID)
    ).toBe(true);

    expect(useDownloadsStore.getState()).toMatchObject({
      selectedSourceId: "r2",
      customSources: [],
    });
    expect(localStorageValues.get("astrodx-download-source")).toBe("r2");
    expect(localStorageValues.has("astrodx-custom-download-source")).toBe(false);
    expect(
      JSON.parse(
        localStorageValues.get("astrodx-custom-download-sources") ?? "{}"
      )
    ).toEqual({ version: 1, sources: [] });
  });

  test("keeps multiple custom routes independent across edit and removal", async () => {
    const first = useDownloadsStore
      .getState()
      .addCustomSource("First", "https://first.example.com/charts");
    const second = useDownloadsStore
      .getState()
      .addCustomSource("Second", "https://second.example.com/charts");
    if (first === null || second === null) {
      throw new Error("Expected valid custom routes");
    }
    await waitForCondition(
      () =>
        useDownloadsStore.getState().sourceProbes[first]?.measuredAt !== null &&
        useDownloadsStore.getState().sourceProbes[second]?.measuredAt !== null
    );

    useDownloadsStore.getState().setSelectedSourceId(second);
    expect(
      useDownloadsStore
        .getState()
        .updateCustomSource(first, "First renamed", "https://first.example.com/v2")
    ).toBe(true);
    expect(useDownloadsStore.getState().removeCustomSource(first)).toBe(true);

    expect(useDownloadsStore.getState()).toMatchObject({
      selectedSourceId: second,
      customSources: [
        {
          id: second,
          name: "Second",
          baseUrl: "https://second.example.com/charts",
        },
      ],
    });
    expect(useDownloadsStore.getState().sourceProbes[first]).toBeUndefined();
  });

  test("saves a custom route and uses it for single and batch jobs", async () => {
    const customSourceUrl = "https://mirror.example.com/charts";
    const customId = useDownloadsStore
      .getState()
      .addCustomSource("Mirror A", ` ${customSourceUrl}/ `);
    expect(customId).not.toBeNull();
    if (customId === null) {
      throw new Error("Expected a valid custom route");
    }
    useDownloadsStore.getState().setSelectedSourceId(customId);
    await waitForCondition(
      () =>
        useDownloadsStore.getState().sourceProbes[customId]?.measuredAt !== null
    );

    expect(useDownloadsStore.getState()).toMatchObject({
      selectedSourceId: customId,
      customSources: [{ id: customId, name: "Mirror A", baseUrl: customSourceUrl }],
    });
    expect(localStorageValues.get("astrodx-download-source")).toBe(customId);
    expect(
      parseStoredCustomSources(
        localStorageValues.get("astrodx-custom-download-sources") ?? null,
        null
      )
    ).toEqual([{ id: customId, name: "Mirror A", baseUrl: customSourceUrl }]);

    fetchedUrls.length = 0;
    await useDownloadsStore.getState().refreshSourceProbes(true);
    expect(fetchedUrls).toEqual([
      "https://astrodx-charts.saop.cc/0/10/track.mp3",
      "https://astrodx-charts-alice.saop.cc/0/10/track.mp3",
      "https://astrodx-charts-tsumugi.saop.cc/0/10/track.mp3",
      "https://astrodx-charts-wmc.saop.cc/0/10/track.mp3",
      "https://astrodx-charts-g510.saop.cc/0/10/track.mp3",
      `${customSourceUrl}/0/10/track.mp3`,
    ]);

    fetchedUrls.length = 0;
    const singleId = singleJobId("custom-source-single");
    useDownloadsStore.getState().startSingle({
      id: singleId,
      title: "custom-source-single",
      files: [
        {
          name: "track.mp3",
          url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
        },
      ],
      includeVideo: true,
      format: "adx",
    });
    expect(
      useDownloadsStore.getState().jobs.find((job) => job.id === singleId)
    ).toMatchObject({
      sourceId: customId,
      sourceBaseUrl: customSourceUrl,
      sourceName: "Mirror A",
    });
    await waitForSettled(singleId);

    const batchId = newBatchJobId();
    await useDownloadsStore.getState().startBatch({
      id: batchId,
      title: "custom-source-batch",
      charts: [
        {
          dir: "Song A",
          files: [
            {
              name: "maidata.txt",
              url: "https://astrodx-charts.saop.cc/25/11951/maidata.txt",
            },
          ],
        },
      ],
      includeVideo: true,
      format: "adx",
      sourceId: customId,
    });
    await waitForSettled(batchId);

    expect(fetchedUrls).toContain(
      `${customSourceUrl}/25/11951/track.mp3`
    );
    expect(fetchedUrls).toContain(
      `${customSourceUrl}/25/11951/maidata.txt`
    );
  });

  test("a paused custom job resumes from its saved URL after the preference changes", async () => {
    const originalSourceUrl = "https://mirror-a.example.com/charts";
    const replacementSourceUrl = "https://mirror-b.example.com/media";
    const customId = useDownloadsStore
      .getState()
      .addCustomSource("Mirror A", originalSourceUrl);
    if (customId === null) {
      throw new Error("Expected a valid custom route");
    }
    useDownloadsStore.getState().setSelectedSourceId(customId);
    await waitForCondition(
      () =>
        useDownloadsStore.getState().sourceProbes[customId]?.measuredAt !== null
    );

    const id = singleJobId("custom-source-snapshot");
    useDownloadsStore.getState().startSingle({
      id,
      title: "custom-source-snapshot",
      files: [
        {
          name: "track.mp3",
          url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
        },
      ],
      includeVideo: true,
      format: "adx",
    });
    useDownloadsStore.getState().pause(id);
    expect(
      useDownloadsStore.getState().jobs.find((job) => job.id === id)
    ).toMatchObject({
      status: "paused",
      sourceId: customId,
      sourceBaseUrl: originalSourceUrl,
    });

    expect(
      useDownloadsStore
        .getState()
        .updateCustomSource(customId, "Mirror B", replacementSourceUrl)
    ).toBe(true);
    await waitForCondition(
      () =>
        useDownloadsStore.getState().sourceProbes[customId]?.measuredAt !== null
    );
    fetchedUrls.length = 0;
    useDownloadsStore.getState().resume(id);
    await waitForJob(id, (job) => job.status === "success");

    expect(fetchedUrls).toContain(
      `${originalSourceUrl}/25/11951/track.mp3`
    );
    expect(fetchedUrls).not.toContain(
      `${replacementSourceUrl}/25/11951/track.mp3`
    );
  });

  test("a deleted custom route does not change an existing paused job snapshot", async () => {
    const sourceUrl = "https://removed.example.com/charts";
    const customId = useDownloadsStore
      .getState()
      .addCustomSource("Temporary", sourceUrl);
    if (customId === null) {
      throw new Error("Expected a valid custom route");
    }
    useDownloadsStore.getState().setSelectedSourceId(customId);

    const id = singleJobId("deleted-custom-snapshot");
    useDownloadsStore.getState().startSingle({
      id,
      title: "deleted-custom-snapshot",
      files: [
        {
          name: "track.mp3",
          url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
        },
      ],
      includeVideo: true,
      format: "adx",
    });
    useDownloadsStore.getState().pause(id);
    expect(useDownloadsStore.getState().removeCustomSource(customId)).toBe(true);
    expect(useDownloadsStore.getState().selectedSourceId).toBe("r2");

    fetchedUrls.length = 0;
    useDownloadsStore.getState().resume(id);
    await waitForJob(id, (job) => job.status === "success");
    expect(fetchedUrls).toEqual([
      `${sourceUrl}/25/11951/track.mp3`,
    ]);
  });

  test("shares one latency probe round and respects the freshness window", async () => {
    const refresh = useDownloadsStore.getState().refreshSourceProbes;
    await Promise.all([refresh(true), refresh(true)]);

    expect(fetchedUrls).toEqual([
      "https://astrodx-charts.saop.cc/0/10/track.mp3",
      "https://astrodx-charts-alice.saop.cc/0/10/track.mp3",
      "https://astrodx-charts-tsumugi.saop.cc/0/10/track.mp3",
      "https://astrodx-charts-wmc.saop.cc/0/10/track.mp3",
      "https://astrodx-charts-g510.saop.cc/0/10/track.mp3",
    ]);
    expect(
      ["r2", "alice", "tsumugi", "awmc", "g510"].every((sourceId) => {
        const probe =
          useDownloadsStore.getState().sourceProbes[
            sourceId as "r2" | "alice" | "tsumugi" | "awmc" | "g510"
          ];
        return probe?.state === "ok" && probe.latencyMs !== null;
      })
    ).toBe(true);
    expect(
      Object.keys(useDownloadsStore.getState().sourceProbes).sort()
    ).toEqual(["alice", "awmc", "g510", "r2", "tsumugi"]);

    await refresh();
    expect(fetchedUrls).toHaveLength(5);
  });

  test("reuses only a complete matching resource, including across mirror hosts", () => {
    const prior: PersistedFile = {
      key: "job::track.mp3",
      jobId: "job",
      name: "track.mp3",
      url: "https://astrodx-charts.saop.cc/track.mp3",
      complete: true,
      size: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])]),
    };

    expect(
      reusablePersistedFile({ url: "https://astrodx-charts.saop.cc/track.mp3" }, prior)
    ).toBe(prior);
    expect(
      reusablePersistedFile(
        { url: "https://astrodx-charts-alice.saop.cc/track.mp3" },
        prior
      )
    ).toBe(prior);
    expect(
      reusablePersistedFile(
        { url: "https://astrodx-charts-alice.saop.cc/other.mp3" },
        prior
      )
    ).toBeUndefined();
    expect(
      reusablePersistedFile({ url: "https://example.test/track.mp3" }, prior)
    ).toBeUndefined();

    const customPrior: PersistedFile = {
      ...prior,
      url: "https://mirror-a.example.com/charts/track.mp3",
      sourceBaseUrl: "https://mirror-a.example.com/charts",
    };
    expect(
      reusablePersistedFile(
        { url: "https://mirror-b.example.com/media/track.mp3" },
        customPrior,
        "https://mirror-b.example.com/media"
      )
    ).toBe(customPrior);
  });

  test("a failed job can switch source and restart cleanly", async () => {
    const id = singleJobId("switch-source");
    globalThis.fetch = (async (input) => {
      fetchedUrls.push(String(input));
      throw new TypeError("network failed");
    }) as typeof fetch;

    useDownloadsStore.getState().startSingle({
      id,
      title: "switch-source",
      files: [
        {
          name: "track.mp3",
          url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
        },
      ],
      includeVideo: true,
      format: "adx",
      sourceId: "r2",
    });
    await waitForJob(id, (job) => job.status === "error");

    globalThis.fetch = (async (input) => {
      fetchedUrls.push(String(input));
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" },
      });
    }) as typeof fetch;
    useDownloadsStore.getState().restartWithSource(id, "g510");

    await waitForJob(id, (job) => job.sourceId === "g510" && job.status === "success");
    expect(fetchedUrls).toContain(
      "https://astrodx-charts-g510.saop.cc/25/11951/track.mp3"
    );
  });

  test("source switching keeps completed files and restarts only unfinished files", async () => {
    const id = singleJobId("switch-keeps-complete-files");
    const customSourceUrl = "https://mirror.example.com/charts";
    const customId = useDownloadsStore
      .getState()
      .addCustomSource("Mirror", customSourceUrl);
    if (customId === null) {
      throw new Error("Expected a valid custom route");
    }
    await waitForCondition(
      () =>
        useDownloadsStore.getState().sourceProbes[customId]?.measuredAt !== null
    );
    fetchedUrls.length = 0;
    // This case is about the *manual* switch. Park every probe back at "idle"
    // so automatic failover (covered separately below) finds no healthy
    // candidate and cannot reroute the job before the assertions run.
    useDownloadsStore.setState({
      sourceProbes: createInitialDownloadSourceProbes(
        useDownloadsStore.getState().customSources
      ),
    });
    let rejectTrack: ((reason?: unknown) => void) | undefined;
    const firstRequests: { url: string; headers: Headers }[] = [];

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      firstRequests.push({ url, headers: new Headers(init?.headers) });
      if (url.endsWith("/maidata.txt")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-length": "3" },
        });
      }
      if (rejectTrack === undefined) {
        return await new Promise<Response>((_resolve, reject) => {
          rejectTrack = reject;
        });
      }
      // The engine retries transient failures — every retry must fail too for
      // the job to surface an error.
      throw new TypeError("network failed");
    }) as typeof fetch;

    useDownloadsStore.getState().startSingle({
      id,
      title: "switch-keeps-complete-files",
      files: [
        {
          name: "maidata.txt",
          url: "https://astrodx-charts.saop.cc/25/11951/maidata.txt",
        },
        {
          name: "track.mp3",
          url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
        },
      ],
      includeVideo: true,
      format: "adx",
      sourceId: "r2",
    });

    await waitForCondition(() => persistedFiles.has(`${id}::maidata.txt`));
    rejectTrack?.(new TypeError("network failed"));
    await waitForJob(id, (job) => job.status === "error");
    const failedJob = useDownloadsStore.getState().jobs.find((job) => job.id === id);
    expect(failedJob?.completed).toBe(1);
    expect(failedJob?.totalBytes).toBe(0);
    expect(failedJob?.fileProgress).toEqual([
      { name: "maidata.txt", received: 3, total: 3, status: "done" },
      { name: "track.mp3", received: 0, total: null, status: "pending" },
    ]);

    const switchedRequests: { url: string; headers: Headers }[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      switchedRequests.push({ url, headers: new Headers(init?.headers) });
      if (url.endsWith("/maidata.txt")) {
        throw new Error("completed maidata.txt must not be fetched again");
      }
      return new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { "content-length": "3" },
      });
    }) as typeof fetch;

    useDownloadsStore.getState().restartWithSource(id, customId);
    await waitForJob(
      id,
      (job) => job.sourceId === customId && job.status === "success"
    );

    expect([...new Set(firstRequests.map((request) => request.url))].sort()).toEqual([
      "https://astrodx-charts.saop.cc/25/11951/maidata.txt",
      "https://astrodx-charts.saop.cc/25/11951/track.mp3",
    ]);
    expect(switchedRequests.map((request) => request.url)).toEqual([
      `${customSourceUrl}/25/11951/track.mp3`,
    ]);
    expect(switchedRequests[0].headers.has("Range")).toBe(false);
    expect(switchedRequests[0].headers.has("If-Range")).toBe(false);
  });

  test("manual pause keeps whole files but discards the current file prefix", async () => {
    const id = singleJobId("pause-keeps-only-complete-files");
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/maidata.txt")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-length": "3" },
        });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([4]));
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("Aborted", "AbortError"));
          });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-length": "3" },
      });
    }) as typeof fetch;

    useDownloadsStore.getState().startSingle({
      id,
      title: "pause-keeps-only-complete-files",
      files: [
        {
          name: "maidata.txt",
          url: "https://astrodx-charts.saop.cc/25/11951/maidata.txt",
        },
        {
          name: "track.mp3",
          url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
        },
      ],
      includeVideo: true,
      format: "adx",
      sourceId: "r2",
    });

    await waitForCondition(() => {
      const job = useDownloadsStore.getState().jobs.find((entry) => entry.id === id);
      return (
        persistedFiles.has(`${id}::maidata.txt`) &&
        (job?.fileProgress.find((file) => file.name === "track.mp3")?.received ?? 0) > 0
      );
    });
    useDownloadsStore.getState().pause(id);

    const paused = useDownloadsStore.getState().jobs.find((job) => job.id === id);
    expect(paused).toMatchObject({ status: "paused", completed: 1, totalBytes: 0 });
    expect(paused?.fileProgress).toEqual([
      { name: "maidata.txt", received: 3, total: 3, status: "done" },
      { name: "track.mp3", received: 0, total: null, status: "pending" },
    ]);

    const resumeRequests: { url: string; headers: Headers }[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      resumeRequests.push({ url, headers: new Headers(init?.headers) });
      if (url.endsWith("/maidata.txt")) {
        throw new Error("completed maidata.txt must not be fetched after pause");
      }
      return new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { "content-length": "3" },
      });
    }) as typeof fetch;

    useDownloadsStore.getState().resume(id);
    await waitForJob(id, (job) => job.status === "success");
    expect(resumeRequests.map((request) => request.url)).toEqual([
      "https://astrodx-charts.saop.cc/25/11951/track.mp3",
    ]);
    expect(resumeRequests[0].headers.has("Range")).toBe(false);
    expect(resumeRequests[0].headers.has("If-Range")).toBe(false);
  });

  test("pause and source switch supersede a run still loading saved checkpoints", async () => {
    const id = singleJobId("switch-before-storage-load");
    useDownloadsStore.getState().startSingle({
      id,
      title: "switch-before-storage-load",
      files: [
        {
          name: "track.mp3",
          url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
        },
      ],
      includeVideo: true,
      format: "adx",
      sourceId: "r2",
    });

    // Pausing synchronously must invalidate the queued/current run before the
    // source-switch replacement starts.
    useDownloadsStore.getState().pause(id);
    useDownloadsStore.getState().restartWithSource(id, "alice");

    await waitForJob(id, (job) => job.sourceId === "alice" && job.status === "success");
    expect(fetchedUrls).toEqual([
      "https://astrodx-charts-alice.saop.cc/25/11951/track.mp3",
    ]);
  });

  test("batch jobs route every chart through the selected source", async () => {
    const id = newBatchJobId();
    await useDownloadsStore.getState().startBatch({
      id,
      title: "G510 batch",
      charts: [
        {
          dir: "Song A",
          files: [
            {
              name: "track.mp3",
              url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
            },
          ],
        },
      ],
      includeVideo: true,
      format: "adx",
      sourceId: "g510",
    });

    await waitForSettled(id);
    expect(fetchedUrls).toContain(
      "https://astrodx-charts-g510.saop.cc/25/11951/track.mp3"
    );
  });

  test("single download runs to success with no component mounted", async () => {
    const id = singleJobId("Tell Your World");
    useDownloadsStore.getState().startSingle({
      id,
      title: "Tell Your World",
      files: [{ name: "maidata.txt", url: "https://example.test/maidata.txt" }],
      groupDir: "25 CiRCLE",
      includeVideo: true,
      format: "adx",
    });

    // The job exists immediately (synchronously), proving state lives in the
    // store rather than in a component's render.
    expect(useDownloadsStore.getState().jobs.find((j) => j.id === id)?.status).toBe("packing");

    await waitForSettled(id);
    const job = useDownloadsStore.getState().jobs.find((j) => j.id === id);
    expect(job?.status).toBe("success");
    expect(savedFiles).toEqual(["Tell Your World.adx"]);
    const entries = unzipSync(new Uint8Array(await savedBlobs[0].arrayBuffer()));
    expect(Object.keys(entries)).toEqual(["25 CiRCLE/Tell Your World/maidata.txt"]);
  });

  test("re-triggering an in-flight job is a no-op (dedupe)", async () => {
    const id = singleJobId("dup");
    const files = [{ name: "maidata.txt", url: "https://example.test/maidata.txt" }];
    const start = () =>
      useDownloadsStore
        .getState()
        .startSingle({ id, title: "dup", files, includeVideo: true, format: "adx" });

    start();
    start(); // ignored while the first is still packing
    expect(useDownloadsStore.getState().jobs.filter((j) => j.id === id)).toHaveLength(1);

    await waitForSettled(id);
    expect(savedFiles).toHaveLength(1);
  });

  test("cross-version batch queues one job per version", async () => {
    const ids = await useDownloadsStore.getState().startBatch({
      id: newBatchJobId(),
      title: "AstroDX Charts",
      charts: [
        {
          groupDir: "25 CiRCLE",
          dir: "Same Song",
          files: [{ name: "maidata.txt", url: "https://example.test/circle/maidata.txt" }],
        },
        {
          groupDir: "24 PRiSM PLUS",
          dir: "Same Song",
          files: [{ name: "maidata.txt", url: "https://example.test/prism/maidata.txt" }],
        },
      ],
      includeVideo: true,
      format: "adx",
    });

    // Two independent queue entries, each titled by its own version.
    expect(ids).toHaveLength(2);
    expect(
      ids.map((id) => useDownloadsStore.getState().jobs.find((job) => job.id === id)?.title)
    ).toEqual(["25 CiRCLE", "24 PRiSM PLUS"]);

    await Promise.all(ids.map((id) => waitForSettled(id)));

    expect(await savedArchives()).toEqual({
      "25 CiRCLE.adx": ["25 CiRCLE/Same Song/maidata.txt"],
      "24 PRiSM PLUS.adx": ["24 PRiSM PLUS/Same Song/maidata.txt"],
    });
  });

  test("a failing version does not take the rest of the queue down with it", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url.includes("/prism/")) {
        throw new TypeError("network failed");
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" },
      });
    }) as typeof fetch;

    const ids = await useDownloadsStore.getState().startBatch({
      id: newBatchJobId(),
      title: "AstroDX Charts",
      charts: [
        {
          groupDir: "25 CiRCLE",
          dir: "Song A",
          files: [{ name: "maidata.txt", url: "https://example.test/circle/maidata.txt" }],
        },
        {
          groupDir: "24 PRiSM PLUS",
          dir: "Song B",
          files: [{ name: "maidata.txt", url: "https://example.test/prism/maidata.txt" }],
        },
      ],
      includeVideo: true,
      format: "adx",
    });

    await Promise.all(ids.map((id) => waitForSettled(id)));
    const statuses = ids.map(
      (id) => useDownloadsStore.getState().jobs.find((job) => job.id === id)?.status
    );
    // The whole point of splitting: one broken group fails alone.
    expect(statuses).toEqual(["success", "error"]);
    expect(savedFiles).toEqual(["25 CiRCLE.adx"]);
  });

  test("only MAX_ACTIVE_JOBS run at once; the rest wait as queued", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      started.push(url);
      fetchedUrls.push(url);
      await held;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" },
      });
    }) as typeof fetch;

    const ids = await useDownloadsStore.getState().startBatch({
      id: newBatchJobId(),
      title: "AstroDX Charts",
      charts: ["25 CiRCLE", "24 PRiSM PLUS", "23 PRiSM", "22 BUDDiES PLUS"].map(
        (groupDir, index) => ({
          groupDir,
          dir: `Song ${index}`,
          files: [
            { name: "maidata.txt", url: `https://example.test/${index}/maidata.txt` },
          ],
        })
      ),
      includeVideo: true,
      format: "adx",
    });
    expect(ids).toHaveLength(4);

    const statusesOf = () =>
      ids.map(
        (id) => useDownloadsStore.getState().jobs.find((job) => job.id === id)?.status
      );
    await waitForCondition(
      () => statusesOf().filter((status) => status === "queued").length === 2
    );
    // Two slots busy, two waiting — and the waiting ones never opened a socket.
    expect(statusesOf()).toEqual(["packing", "packing", "queued", "queued"]);
    expect(started).toHaveLength(2);

    release?.();
    await Promise.all(ids.map((id) => waitForSettled(id)));
    expect(statusesOf()).toEqual(["success", "success", "success", "success"]);
    expect(Object.keys(await savedArchives()).sort()).toEqual([
      "22 BUDDiES PLUS.adx",
      "23 PRiSM.adx",
      "24 PRiSM PLUS.adx",
      "25 CiRCLE.adx",
    ]);
  });

  test("pausing a queued job takes it out of the queue without fetching", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = (async (input) => {
      fetchedUrls.push(String(input));
      await held;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" },
      });
    }) as typeof fetch;

    const ids = await useDownloadsStore.getState().startBatch({
      id: newBatchJobId(),
      title: "AstroDX Charts",
      charts: ["25 CiRCLE", "24 PRiSM PLUS", "23 PRiSM"].map((groupDir, index) => ({
        groupDir,
        dir: `Song ${index}`,
        files: [{ name: "maidata.txt", url: `https://example.test/${index}/maidata.txt` }],
      })),
      includeVideo: true,
      format: "adx",
    });

    const queuedId = ids[2];
    await waitForJob(queuedId, (job) => job.status === "queued");
    useDownloadsStore.getState().pause(queuedId);
    expect(
      useDownloadsStore.getState().jobs.find((job) => job.id === queuedId)?.status
    ).toBe("paused");

    release?.();
    await Promise.all(ids.slice(0, 2).map((id) => waitForSettled(id)));
    // Its slot was never used, so its file was never requested.
    expect(fetchedUrls.some((url) => url.includes("/2/"))).toBe(false);

    // And it can still be resumed later, once the queue has drained.
    useDownloadsStore.getState().resume(queuedId);
    await waitForJob(queuedId, (job) => job.status === "success");
    expect(fetchedUrls.some((url) => url.includes("/2/"))).toBe(true);
  });

  test("batch grouped by genre queues one job per genre folder", async () => {
    const ids = await useDownloadsStore.getState().startBatch({
      id: newBatchJobId(),
      title: "AstroDX Charts",
      charts: [
        {
          groupDir: "25 CiRCLE",
          genreDir: "東方Project",
          dir: "Song A",
          files: [{ name: "maidata.txt", url: "https://example.test/a/maidata.txt" }],
        },
        {
          groupDir: "25 CiRCLE",
          genreDir: "POPS＆アニメ",
          dir: "Song B",
          files: [{ name: "maidata.txt", url: "https://example.test/b/maidata.txt" }],
        },
      ],
      includeVideo: true,
      format: "adx",
      grouping: "genre",
    });

    await Promise.all(ids.map((jobId) => waitForSettled(jobId)));

    // Same version, two genres: the genre layout decides the split, not the version.
    expect(await savedArchives()).toEqual({
      "東方Project.adx": ["東方Project/Song A/maidata.txt"],
      "POPS＆アニメ.adx": ["POPS＆アニメ/Song B/maidata.txt"],
    });
  });

  test("a genre-grouped job keeps its folder layout across a source switch", async () => {
    globalThis.fetch = (async (input) => {
      fetchedUrls.push(String(input));
      throw new TypeError("network failed");
    }) as typeof fetch;

    // One genre → one job, so this exercises rerouting rather than the split.
    const [id] = await useDownloadsStore.getState().startBatch({
      id: newBatchJobId(),
      title: "AstroDX Charts",
      charts: ["Song A", "Song B"].map((dir, index) => ({
        groupDir: "25 CiRCLE",
        genreDir: "東方Project",
        dir,
        files: [
          {
            name: "maidata.txt",
            url: `https://astrodx-charts.saop.cc/25/1195${index}/maidata.txt`,
          },
        ],
      })),
      includeVideo: true,
      format: "adx",
      sourceId: "r2",
      grouping: "genre",
    });

    await waitForJob(id, (job) => job.status === "error");
    // The durable spec is what a resume/restart replays from — the chosen
    // layout must live there, not only in the component that started the job.
    expect(persistedJobs.get(id)?.groupByIndex).toEqual([
      "東方Project",
      "東方Project",
    ]);

    globalThis.fetch = (async (input) => {
      fetchedUrls.push(String(input));
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" },
      });
    }) as typeof fetch;
    useDownloadsStore.getState().restartWithSource(id, "g510");
    await waitForJob(id, (job) => job.sourceId === "g510" && job.status === "success");

    // Still genre folders after rerouting — not the version layout that the
    // (unchanged) preference would have produced for a fresh start. A
    // single-group selection stays named by the collection, as before the split.
    expect(await savedArchives()).toEqual({
      "AstroDX Charts.adx": [
        "東方Project/Song A/maidata.txt",
        "東方Project/Song B/maidata.txt",
      ],
    });
    expect(useDownloadsStore.getState().preferredBatchGrouping).toBe("version");
  });

  test("setPreferredBatchGrouping persists and becomes the startBatch default", async () => {
    useDownloadsStore.getState().setPreferredBatchGrouping("genre");
    expect(localStorageValues.get("astrodx-download-batch-grouping")).toBe("genre");

    const id = newBatchJobId();
    await useDownloadsStore.getState().startBatch({
      id,
      title: "Preferred grouping",
      charts: [
        {
          groupDir: "25 CiRCLE",
          genreDir: "maimai",
          dir: "Song A",
          files: [{ name: "maidata.txt", url: "https://example.test/a/maidata.txt" }],
        },
      ],
      includeVideo: true,
      format: "adx",
    });

    await waitForSettled(id);
    const entries = unzipSync(new Uint8Array(await savedBlobs[0].arrayBuffer()));
    expect(Object.keys(entries)).toEqual(["maimai/Song A/maidata.txt"]);
  });

  test("genre grouping without genreDir data falls back to a flat archive", async () => {
    const id = newBatchJobId();
    await useDownloadsStore.getState().startBatch({
      id,
      title: "Legacy specs",
      charts: [
        {
          groupDir: "25 CiRCLE",
          dir: "Song A",
          files: [{ name: "maidata.txt", url: "https://example.test/a/maidata.txt" }],
        },
      ],
      includeVideo: true,
      format: "adx",
      grouping: "genre",
    });

    await waitForSettled(id);
    // Old cached specs.json has no genreDir — charts pack at the archive root
    // rather than under a bogus folder.
    expect(savedFiles).toEqual(["Legacy specs.adx"]);
    const entries = unzipSync(new Uint8Array(await savedBlobs[0].arrayBuffer()));
    expect(Object.keys(entries)).toEqual(["Song A/maidata.txt"]);
  });

  test("single-version batch stays one combined archive", async () => {
    const id = newBatchJobId();
    await useDownloadsStore.getState().startBatch({
      id,
      title: "25 CiRCLE selection",
      charts: [
        {
          groupDir: "25 CiRCLE",
          dir: "Song A",
          files: [{ name: "maidata.txt", url: "https://example.test/a/maidata.txt" }],
        },
        {
          groupDir: "25 CiRCLE",
          dir: "Song B",
          files: [{ name: "maidata.txt", url: "https://example.test/b/maidata.txt" }],
        },
      ],
      includeVideo: true,
      format: "adx",
    });

    await waitForSettled(id);

    expect(savedFiles).toEqual(["25 CiRCLE selection.adx"]);
    const entries = unzipSync(new Uint8Array(await savedBlobs[0].arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      "25 CiRCLE/Song A/maidata.txt",
      "25 CiRCLE/Song B/maidata.txt",
    ]);
  });

  test("a large genre job saves every numbered part and completes once", async () => {
    const id = newBatchJobId();
    const charts = ["Song A", "Song B"].map((dir, index) => {
      const url = `https://example.test/${index}/track.mp3`;
      const name = `${index}/track.mp3`;
      const blob = new Blob([dir]);
      Object.defineProperty(blob, "size", { value: 1_200_000_000 });
      persistedFiles.set(`${id}::${name}`, {
        key: `${id}::${name}`,
        jobId: id,
        name,
        url,
        complete: true,
        size: blob.size,
        blob,
      });
      return {
        dir,
        genreDir: "maimai",
        groupDir: "25 CiRCLE",
        files: [{ name: "track.mp3", url }],
      };
    });
    const ids = await useDownloadsStore.getState().startBatch({
      id,
      title: "maimai",
      charts,
      includeVideo: true,
      format: "zip",
      grouping: "genre",
    });
    expect(ids).toEqual([id]);
    await waitForSettled(id);
    const job = useDownloadsStore.getState().jobs.find((entry) => entry.id === id);
    expect(job?.status).toBe("success");
    expect(job?.completed).toBe(2);
    expect(job?.receivedBytes).toBe(2_400_000_000);
    expect(await savedArchives()).toEqual({
      "maimai (1).zip": ["maimai/Song A/track.mp3"],
      "maimai (2).zip": ["maimai/Song B/track.mp3"],
    });
    expect(useDownloadsStore.getState().history.filter((entry) => entry.job.id === id))
      .toHaveLength(1);
    expect(persistedFiles.size).toBe(2);
    useDownloadsStore.getState().dismiss(id);
    await waitForCondition(() => persistedFiles.size === 0);
  });

  test("each batch start gets its own job id so bars never adopt foreign jobs", async () => {
    const first = newBatchJobId();
    const second = newBatchJobId();
    expect(first).not.toBe(second);

    const chartFor = (dir: string, url: string) => ({
      groupDir: "25 CiRCLE",
      dir,
      files: [{ name: "maidata.txt", url }],
    });
    await useDownloadsStore.getState().startBatch({
      id: first,
      title: "AstroDX Charts",
      charts: [chartFor("Song A", "https://example.test/a/maidata.txt")],
      includeVideo: true,
      format: "adx",
    });
    await useDownloadsStore.getState().startBatch({
      id: second,
      title: "AstroDX Charts",
      charts: [chartFor("Song B", "https://example.test/b/maidata.txt")],
      includeVideo: true,
      format: "adx",
    });

    // Same collection title, still two independent jobs (the old name-keyed id
    // made the second start a dedupe no-op against the first).
    expect(useDownloadsStore.getState().jobs).toHaveLength(2);

    await waitForSettled(first);
    await waitForSettled(second);
    expect(savedFiles).toHaveLength(2);
  });

  test("present/unpresent ref-counts so the tray only shows orphaned jobs", () => {
    const id = newBatchJobId();
    const store = useDownloadsStore.getState();

    store.presentInline(id);
    store.presentInline(id);
    expect(useDownloadsStore.getState().presented[id]).toBe(2);

    store.unpresentInline(id);
    expect(useDownloadsStore.getState().presented[id]).toBe(1);

    store.unpresentInline(id);
    expect(useDownloadsStore.getState().presented[id]).toBeUndefined();
  });

  test("dismiss removes a job from the store", async () => {
    const id = singleJobId("gone");
    useDownloadsStore.getState().startSingle({
      id,
      title: "gone",
      files: [{ name: "maidata.txt", url: "https://example.test/maidata.txt" }],
      includeVideo: true,
      format: "adx",
    });
    await waitForSettled(id);

    useDownloadsStore.getState().dismiss(id);
    expect(useDownloadsStore.getState().jobs.find((j) => j.id === id)).toBeUndefined();
  });

  test("dismiss waits for an in-flight whole-file checkpoint before cleanup", async () => {
    const id = singleJobId("dismiss-checkpoint-race");
    let signalPersistStarted: (() => void) | undefined;
    const persistStarted = new Promise<void>((resolve) => {
      signalPersistStarted = resolve;
    });
    let releasePersist: (() => void) | undefined;
    const persistRelease = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });
    setDownloadsPersistenceAdapterForTests({
      ...memoryPersistence,
      persistFile: async (file) => {
        signalPersistStarted?.();
        await persistRelease;
        persistedFiles.set(file.key, file);
      },
    });

    useDownloadsStore.getState().startSingle({
      id,
      title: "dismiss-checkpoint-race",
      files: [{ name: "maidata.txt", url: "https://example.test/maidata.txt" }],
      includeVideo: true,
      format: "adx",
    });
    await persistStarted;

    useDownloadsStore.getState().dismiss(id);
    expect(useDownloadsStore.getState().jobs.find((job) => job.id === id)).toBeUndefined();
    expect(persistedJobs.has(id)).toBe(true);

    releasePersist?.();
    await waitForCondition(
      () =>
        !persistedJobs.has(id) &&
        ![...persistedFiles.values()].some((file) => file.jobId === id)
    );
  });

  test("dismiss cleanup cannot delete an immediate same-id restart", async () => {
    const id = singleJobId("dismiss-then-restart");
    let signalOldPersistStarted: (() => void) | undefined;
    const oldPersistStarted = new Promise<void>((resolve) => {
      signalOldPersistStarted = resolve;
    });
    let releaseOldPersist: (() => void) | undefined;
    const oldPersistRelease = new Promise<void>((resolve) => {
      releaseOldPersist = resolve;
    });
    let persistFileCalls = 0;
    setDownloadsPersistenceAdapterForTests({
      ...memoryPersistence,
      persistFile: async (file) => {
        persistFileCalls += 1;
        if (persistFileCalls === 1) {
          signalOldPersistStarted?.();
          await oldPersistRelease;
        }
        persistedFiles.set(file.key, file);
      },
    });

    useDownloadsStore.getState().startSingle({
      id,
      title: "old-generation",
      files: [{ name: "maidata.txt", url: "https://example.test/old/maidata.txt" }],
      includeVideo: true,
      format: "adx",
    });
    await oldPersistStarted;
    useDownloadsStore.getState().dismiss(id);

    globalThis.fetch = (async () => {
      throw new TypeError("new generation stays recoverable after failure");
    }) as typeof fetch;
    useDownloadsStore.getState().startSingle({
      id,
      title: "new-generation",
      files: [{ name: "maidata.txt", url: "https://example.test/new/maidata.txt" }],
      includeVideo: true,
      format: "adx",
    });
    releaseOldPersist?.();

    await waitForJob(
      id,
      (job) => job.title === "new-generation" && job.status === "error"
    );
    expect(persistedJobs.get(id)?.title).toBe("new-generation");
    expect(
      [...persistedFiles.values()].filter((file) => file.jobId === id)
    ).toHaveLength(0);
  });

  test("classifies a permanent 4xx apart from a 5xx and a flaky connection", () => {
    // "download failed" used to bucket everything as `network`, so a 404 was
    // reported as "网络问题，重试即可".
    expect(
      classifyDownloadError(
        new Error("File download failed: https://x/pv.mp4 (HTTP 404)")
      )
    ).toBe("missing");
    expect(
      classifyDownloadError(
        new Error("File download failed: https://x/track.mp3 (HTTP 503)")
      )
    ).toBe("server");
    // Congestion statuses exhausted their retries; that is not a missing file.
    expect(
      classifyDownloadError(
        new Error("File download failed: https://x/track.mp3 (HTTP 429)")
      )
    ).toBe("network");
    expect(
      classifyDownloadError(new Error("File download failed: https://x/track.mp3"))
    ).toBe("network");
    expect(classifyDownloadError(new Error("boom"))).toBe("unknown");
  });

  test("extracts the failed URL and status for the copyable detail block", () => {
    const message = "File download failed: https://mirror/25/1/pv.mp4 (HTTP 404)";
    expect(downloadFailureUrl(message)).toBe("https://mirror/25/1/pv.mp4");
    expect(downloadFailureStatus(message)).toBe(404);
    expect(downloadFailureStatus("boom")).toBeNull();
    expect(downloadFailureUrl("boom")).toBeNull();
  });

  test("quotes an ETA only once the rate estimate has converged", () => {
    expect(estimateDownloadEtaMs(1_000_000, 5_000_000, 1_000_000)).toBe(4000);
    // No measured total, or a rate too slow to trust, means no promise at all.
    expect(estimateDownloadEtaMs(1_000_000, 0, 1_000_000)).toBeNull();
    expect(estimateDownloadEtaMs(1_000_000, 5_000_000, 1024)).toBeNull();
    // An extrapolated total the transfer has already overshot.
    expect(estimateDownloadEtaMs(6_000_000, 5_000_000, 1_000_000)).toBeNull();
  });

  test("a missing optional asset is skipped instead of failing the chart", async () => {
    const id = singleJobId("optional-asset-404");
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/pv.mp4")) {
        return new Response("nope", { status: 404 });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" },
      });
    }) as typeof fetch;

    useDownloadsStore.getState().startSingle({
      id,
      title: "optional-asset-404",
      files: [
        { name: "maidata.txt", url: "https://astrodx-charts.saop.cc/25/1/maidata.txt" },
        { name: "track.mp3", url: "https://astrodx-charts.saop.cc/25/1/track.mp3" },
        { name: "pv.mp4", url: "https://astrodx-charts.saop.cc/25/1/pv.mp4" },
      ],
      includeVideo: true,
      format: "zip",
    });

    await waitForSettled(id);
    const job = useDownloadsStore.getState().jobs.find((entry) => entry.id === id);
    expect(job?.status).toBe("success");
    expect(job?.skippedFiles.map((file) => file.name)).toEqual(["pv.mp4"]);
    expect(job?.skippedFiles[0].status).toBe(404);
    // The archive is written without it rather than not written at all.
    expect(await savedArchives()).toEqual({
      "optional-asset-404.zip": [
        "optional-asset-404/maidata.txt",
        "optional-asset-404/track.mp3",
      ],
    });
  });

  test("a missing required asset still fails the chart", async () => {
    const id = singleJobId("required-asset-404");
    globalThis.fetch = (async (input) =>
      String(input).endsWith("/track.mp3")
        ? new Response("nope", { status: 404 })
        : new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-length": "3" },
          })) as typeof fetch;

    useDownloadsStore.getState().startSingle({
      id,
      title: "required-asset-404",
      files: [
        { name: "maidata.txt", url: "https://astrodx-charts.saop.cc/25/2/maidata.txt" },
        { name: "track.mp3", url: "https://astrodx-charts.saop.cc/25/2/track.mp3" },
      ],
      includeVideo: true,
      format: "zip",
    });

    await waitForSettled(id);
    const job = useDownloadsStore.getState().jobs.find((entry) => entry.id === id);
    expect(job?.status).toBe("error");
    expect(job?.errorKind).toBe("missing");
    expect(job?.errorDetail).toContain("HTTP 404");
    expect(savedFiles).toHaveLength(0);
  });

  test("a failed run moves itself to the fastest healthy route", async () => {
    const id = singleJobId("auto-failover");
    // Only Alice is healthy, so that is the only route failover may pick.
    useDownloadsStore.setState({
      sourceProbes: {
        ...createInitialDownloadSourceProbes(),
        alice: { state: "ok", latencyMs: 12, measuredAt: Date.now() },
      },
    });
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.startsWith("https://astrodx-charts.saop.cc/")) {
        throw new TypeError("network failed");
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" },
      });
    }) as typeof fetch;

    useDownloadsStore.getState().startSingle({
      id,
      title: "auto-failover",
      files: [
        { name: "maidata.txt", url: "https://astrodx-charts.saop.cc/25/3/maidata.txt" },
      ],
      includeVideo: true,
      format: "zip",
      sourceId: "r2",
    });

    await waitForJob(id, (job) => job.status === "success", 5000);
    const job = useDownloadsStore.getState().jobs.find((entry) => entry.id === id);
    expect(job?.sourceId).toBe("alice");
    expect(job?.autoSwitchedTo).toBe("alice");
    // An automatic recovery must not rewrite the user's default route.
    expect(useDownloadsStore.getState().selectedSourceId).toBe("r2");
  });

  test("a completed download is replayable from history under a fresh id", async () => {
    const id = singleJobId("history-entry");
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" },
      })) as typeof fetch;

    useDownloadsStore.getState().startSingle({
      id,
      title: "history-entry",
      files: [
        { name: "maidata.txt", url: "https://astrodx-charts.saop.cc/25/4/maidata.txt" },
      ],
      includeVideo: true,
      format: "zip",
    });
    await waitForSettled(id);

    const [entry] = useDownloadsStore.getState().history;
    expect(entry?.fileCount).toBe(1);
    // Stored canonicalized (back to the catalog origin), so a replay honours
    // the route selected *then* rather than the mirror this run happened to use.
    expect(entry?.job.files[0].url).toBe(
      "https://astrodx-charts.saop.cc/25/4/maidata.txt"
    );

    savedFiles.length = 0;
    savedBlobs.length = 0;
    await useDownloadsStore.getState().rerunHistoryEntry(entry.key);
    const rerunId = useDownloadsStore
      .getState()
      .jobs.map((job) => job.id)
      .find((jobId) => jobId !== id);
    expect(rerunId).toBeDefined();
    expect(rerunId).not.toBe(id);
    await waitForSettled(rerunId as string);
    expect(
      useDownloadsStore.getState().jobs.find((job) => job.id === rerunId)?.status
    ).toBe("success");
  });

  test("resumeInterrupted restarts connection failures but leaves 404s and pauses alone", () => {
    const base = {
      kind: "single" as const,
      title: "t",
      sourceId: "r2" as const,
      format: "adx" as const,
      completed: 0,
      total: 1,
      receivedBytes: 0,
      totalBytes: 0,
      totalBytesEstimated: false,
      speedBps: 0,
      etaMs: null,
      fileProgress: [],
      archiveCurrentFile: null,
      error: "boom",
      errorDetail: null,
      skippedFiles: [],
      autoSwitchedTo: null,
      startedAt: 0,
    };
    useDownloadsStore.setState({
      jobs: [
        { ...base, id: "a", status: "error", errorKind: "network" },
        { ...base, id: "b", status: "error", errorKind: "missing" },
        { ...base, id: "c", status: "paused", errorKind: null, error: null },
      ],
    });
    // No spec is registered, so resume() is a no-op past the guard — the count
    // is what proves which jobs were considered recoverable.
    expect(useDownloadsStore.getState().resumeInterrupted()).toBe(1);
  });
});
