import { afterEach, expect, test, vi } from "vitest";
import { createUploadController, hashFile } from "@/client/lib/file-upload";
import type { StorageApi } from "@/client/queries/storage";
import type { UploadDto } from "@/shared/storage";
class Worker {
  static instances: Worker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: null = null;
  terminated = false;
  constructor() {
    Worker.instances.push(this);
  }
  postMessage() {
    queueMicrotask(() => this.onmessage?.({ data: { hash: "a".repeat(64) } }));
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Worker.instances = [];
});
const dto: UploadDto = {
  id: "u",
  state: "receiving",
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  partSize: 4194304,
  partCount: 1,
  receivedParts: [],
};
function fixture() {
  vi.stubGlobal("Worker", Worker);
  const states: string[] = [];
  let state: UploadDto = { ...dto, state: "processing", fileId: "f" };
  let polls = 0;
  const api: StorageApi = {
    init: async () => dto,
    upload: async () => {
      polls++;
      return state;
    },
    part: async () => {},
    complete: async () => state,
    cancel: async () => {},
    file: async () => ({
      id: "f",
      purpose: "avatar",
      name: "a.png",
      size: 3,
      state: "ready",
      previewUrl: "/preview",
      createdAt: "",
    }),
    deleteFile: async () => {},
    saveAvatar: async () => ({ image: null, avatarRevision: 0 }),
    removeAvatar: async () => ({ image: null, avatarRevision: 0 }),
  };
  const c = createUploadController({
    api,
    userId: "u",
    storage: localStorage,
    onState: (s) => states.push(s.phase),
  });
  return {
    c,
    states,
    polls: () => polls,
    setState: (next: UploadDto) => {
      state = next;
    },
  };
}
test("processing polls 2s then 5s, pauses hidden, refreshes visible and stops terminal", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const f = fixture();
  await f.c.start(new File(["abc"], "a.png", { type: "image/png" }));
  const initial = f.polls();
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.polls()).toBe(initial);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.polls()).toBe(initial + 1);
  await vi.advanceTimersByTimeAsync(58000);
  const minute = f.polls();
  await vi.advanceTimersByTimeAsync(4999);
  expect(f.polls()).toBe(minute);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.polls()).toBe(minute + 1);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  const hidden = f.polls();
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.polls()).toBe(hidden);
  f.setState({ ...dto, state: "ready", fileId: "f" });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.polls()).toBe(hidden + 1);
  expect(f.states.at(-1)).toBe("ready");
  await vi.advanceTimersByTimeAsync(15000);
  expect(f.polls()).toBe(hidden + 1);
  f.c.dispose();
});
test("abort terminates worker and ignores late hash results", async () => {
  vi.stubGlobal("Worker", Worker);
  const aborter = new AbortController();
  const promise = hashFile(new File(["abc"], "a"), { signal: aborter.signal });
  aborter.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  expect(Worker.instances[0]!.terminated).toBe(true);
  Worker.instances[0]!.onmessage?.({ data: { hash: "late" } });
});
