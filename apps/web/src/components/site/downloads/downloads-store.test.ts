import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";

import {
  setDownloadsPersistenceAdapterForTests,
  type DownloadsPersistenceAdapter,
  type PersistedFile,
  type PersistedJob,
} from "./persistence";

import {
  createInitialDownloadSourceProbes,
  newBatchJobId,
  reusablePersistedFile,
  singleJobId,
  useDownloadsStore,
} from "./downloads-store";

// Minimal browser shims: the store's download pipeline ends in saveBlobAsFile,
// which touches `document` and `URL.createObjectURL`. We stub just enough so the
// pipeline can run headless — the point is to prove the download completes while
// driven purely by the module-level store, with no React component mounted.
const savedFiles: string[] = [];
const savedBlobs: Blob[] = [];
const fetchedUrls: string[] = [];
const persistedJobs = new Map<string, PersistedJob>();
const persistedFiles = new Map<string, PersistedFile>();

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
};

function installDomShims() {
  savedFiles.length = 0;
  savedBlobs.length = 0;
  fetchedUrls.length = 0;
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

/** Spin until the job leaves the active download/archive states (or we time out). */
async function waitForSettled(id: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const job = useDownloadsStore.getState().jobs.find((entry) => entry.id === id);
    if (job && job.status !== "packing" && job.status !== "archiving") {
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
    setDownloadsPersistenceAdapterForTests(memoryPersistence);
    useDownloadsStore.setState({
      jobs: [],
      presented: {},
      selectedSourceId: "r2",
      sourceProbes: createInitialDownloadSourceProbes(),
    });
  });

  afterEach(() => {
    useDownloadsStore.setState({
      jobs: [],
      presented: {},
      selectedSourceId: "r2",
      sourceProbes: createInitialDownloadSourceProbes(),
    });
    setDownloadsPersistenceAdapterForTests(null);
  });

  test("hydration reroutes a legacy-origin job before resume", async () => {
    const id = singleJobId("legacy-origin-resume");
    persistedJobs.set(id, {
      id,
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

    useDownloadsStore.getState().hydrateFromStorage();
    await waitForJob(id, (job) => job.status === "paused");
    expect(useDownloadsStore.getState().jobs.find((job) => job.id === id)?.sourceId).toBe(
      "r2"
    );

    useDownloadsStore.getState().resume(id);
    await waitForJob(id, (job) => job.status === "success");
    expect(fetchedUrls).toEqual([
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

  test("shares one latency probe round and respects the freshness window", async () => {
    const refresh = useDownloadsStore.getState().refreshSourceProbes;
    await Promise.all([refresh(true), refresh(true)]);

    expect(fetchedUrls).toEqual([
      "https://astrodx-charts.saop.cc/0/10/track.mp3",
      "https://astrodx-charts-alice.saop.cc/0/10/track.mp3",
      "https://astrodx-charts-g510.saop.cc/0/10/track.mp3",
      "https://astrodx-charts-g400s.saop.cc/0/10/track.mp3",
    ]);
    expect(
      Object.values(useDownloadsStore.getState().sourceProbes).every(
        (probe) => probe.state === "ok" && probe.latencyMs !== null
      )
    ).toBe(true);

    await refresh();
    expect(fetchedUrls).toHaveLength(4);
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
      return await new Promise<Response>((_resolve, reject) => {
        rejectTrack = reject;
      });
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

    useDownloadsStore.getState().restartWithSource(id, "alice");
    await waitForJob(id, (job) => job.sourceId === "alice" && job.status === "success");

    expect(firstRequests.map((request) => request.url).sort()).toEqual([
      "https://astrodx-charts.saop.cc/25/11951/maidata.txt",
      "https://astrodx-charts.saop.cc/25/11951/track.mp3",
    ]);
    expect(switchedRequests.map((request) => request.url)).toEqual([
      "https://astrodx-charts-alice.saop.cc/25/11951/track.mp3",
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

  test("cross-version batch saves one archive per version", async () => {
    const id = newBatchJobId();
    useDownloadsStore.getState().startBatch({
      id,
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

    await waitForSettled(id);

    expect(savedFiles).toEqual(["25 CiRCLE.adx", "24 PRiSM PLUS.adx"]);
    const circle = unzipSync(new Uint8Array(await savedBlobs[0].arrayBuffer()));
    expect(Object.keys(circle)).toEqual(["25 CiRCLE/Same Song/maidata.txt"]);
    const prism = unzipSync(new Uint8Array(await savedBlobs[1].arrayBuffer()));
    expect(Object.keys(prism)).toEqual(["24 PRiSM PLUS/Same Song/maidata.txt"]);
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
});
