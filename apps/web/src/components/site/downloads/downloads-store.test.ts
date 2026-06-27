import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { batchJobId, singleJobId, useDownloadsStore } from "./downloads-store";

// Minimal browser shims: the store's download pipeline ends in saveBlobAsFile,
// which touches `document` and `URL.createObjectURL`. We stub just enough so the
// pipeline can run headless — the point is to prove the download completes while
// driven purely by the module-level store, with no React component mounted.
const savedFiles: string[] = [];

function installDomShims() {
  savedFiles.length = 0;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-length": "3" },
    })) as typeof fetch;

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
  url.createObjectURL = () => "blob:stub";
  url.revokeObjectURL = () => {};
}

/** Spin until the job leaves the "packing" state (or we time out). */
async function waitForSettled(id: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const job = useDownloadsStore.getState().jobs.find((entry) => entry.id === id);
    if (job && job.status !== "packing") {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Job ${id} never settled (status=${job?.status ?? "missing"})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("downloads-store", () => {
  beforeEach(() => {
    installDomShims();
    useDownloadsStore.setState({ jobs: [], presented: {} });
  });

  afterEach(() => {
    useDownloadsStore.setState({ jobs: [], presented: {} });
  });

  test("single download runs to success with no component mounted", async () => {
    const id = singleJobId("Tell Your World");
    useDownloadsStore.getState().startSingle({
      id,
      title: "Tell Your World",
      files: [{ name: "maidata.txt", url: "https://example.test/maidata.txt" }],
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

  test("present/unpresent ref-counts so the tray only shows orphaned jobs", () => {
    const id = batchJobId("Festival");
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
});
