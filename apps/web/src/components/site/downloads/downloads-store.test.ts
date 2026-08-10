import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";

import {
  setDownloadsPersistenceAdapterForTests,
  type DownloadHistoryEntry,
  type DownloadsPersistenceAdapter,
  type PersistedFile,
  type PersistedJob,
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
};

function installDomShims() {
  savedFiles.length = 0;
  savedBlobs.length = 0;
  fetchedUrls.length = 0;
  localStorageValues.clear();
  globalThis.fetch = (async (input) => {
    fetchedUrls.push(String(input));
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-length": "3" },
    });
  }) as typeof fetch;

  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({
      href: "",
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

describe("downloads-store", () => {
  beforeEach(() => {
    installDomShims();
    persistedJobs.clear();
    persistedFiles.clear();
    persistedHistory.clear();
    setDownloadsPersistenceAdapterForTests(memoryPersistence);
    setDownloadRetryBaseDelayForTests(1);
    resetDownloadQueueForTests();
    useDownloadsStore.setState({
      jobs: [],
      presented: {},
      selectedSourceId: "r2",
      customSources: [],
      preferredFormat: "adx",
      preferredBatchGrouping: "version",
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
      sourceProbes: createInitialDownloadSourceProbes(),
    });
    setDownloadsPersistenceAdapterForTests(null);
    setDownloadRetryBaseDelayForTests(undefined);
    resetDownloadQueueForTests();
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

    useDownloadsStore.getState().hydrateFromStorage();
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
    expect(fetchedUrls).toEqual([
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
      "https://astrodx-charts-g400s.saop.cc/0/10/track.mp3",
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
    useDownloadsStore.getState().startBatch({
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
      "https://astrodx-charts-g400s.saop.cc/0/10/track.mp3",
    ]);
    expect(
      ["r2", "alice", "tsumugi", "awmc", "g510", "g400s"].every((sourceId) => {
        const probe =
          useDownloadsStore.getState().sourceProbes[
            sourceId as "r2" | "alice" | "tsumugi" | "awmc" | "g510" | "g400s"
          ];
        return probe?.state === "ok" && probe.latencyMs !== null;
      })
    ).toBe(true);
    expect(
      Object.keys(useDownloadsStore.getState().sourceProbes).sort()
    ).toEqual(["alice", "awmc", "g400s", "g510", "r2", "tsumugi"]);

    await refresh();
    expect(fetchedUrls).toHaveLength(6);
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
    useDownloadsStore.getState().startBatch({
      id,
      title: "G400s batch",
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
      sourceId: "g400s",
    });

    await waitForSettled(id);
    expect(fetchedUrls).toContain(
      "https://astrodx-charts-g400s.saop.cc/25/11951/track.mp3"
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
    const ids = useDownloadsStore.getState().startBatch({
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

    const ids = useDownloadsStore.getState().startBatch({
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

    const ids = useDownloadsStore.getState().startBatch({
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

    const ids = useDownloadsStore.getState().startBatch({
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
    const ids = useDownloadsStore.getState().startBatch({
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
    const [id] = useDownloadsStore.getState().startBatch({
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
    useDownloadsStore.getState().startBatch({
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
    useDownloadsStore.getState().startBatch({
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
    useDownloadsStore.getState().startBatch({
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

  test("each batch start gets its own job id so bars never adopt foreign jobs", async () => {
    const first = newBatchJobId();
    const second = newBatchJobId();
    expect(first).not.toBe(second);

    const chartFor = (dir: string, url: string) => ({
      groupDir: "25 CiRCLE",
      dir,
      files: [{ name: "maidata.txt", url }],
    });
    useDownloadsStore.getState().startBatch({
      id: first,
      title: "AstroDX Charts",
      charts: [chartFor("Song A", "https://example.test/a/maidata.txt")],
      includeVideo: true,
      format: "adx",
    });
    useDownloadsStore.getState().startBatch({
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
    useDownloadsStore.getState().rerunHistoryEntry(entry.key);
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
