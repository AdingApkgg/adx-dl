import { afterEach, describe, expect, test } from "bun:test";
import { hashChunks } from "../workers/file-hash";
import { createUploadController, readUploadRecords, clearUploadRecords } from "./file-upload";
import type { StorageApi } from "../queries/storage";
import type { StoragePurpose, UploadDto } from "@/shared/storage";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const hash = "a".repeat(64);
const file = () =>
  new File([new Uint8Array(5 * 1024 * 1024)], "avatar.png", {
    type: "image/png",
  });
const dto = (patch: Partial<UploadDto> = {}): UploadDto => ({
  id: "upload",
  state: "receiving",
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  partSize: 4194304,
  partCount: 2,
  receivedParts: [],
  ...patch,
});
class HashWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  postMessage() {
    queueMicrotask(() => this.onmessage?.({ data: { hash } }));
  }
  terminate() {
    this.terminated = true;
  }
}
const originalWorker = globalThis.Worker;
afterEach(() => {
  globalThis.Worker = originalWorker;
});
function fixture(purpose: StoragePurpose = "avatar") {
  globalThis.Worker = HashWorker as unknown as typeof Worker;
  const storage = new MemoryStorage();
  let upload = dto();
  const parts: number[] = [];
  const states: { phase: string; progress: number; error?: unknown }[] = [];
  const api: StorageApi = {
    init: async () => upload,
    upload: async () => upload,
    part: async (_id, index, body) => {
      parts.push(index);
      upload = dto({
        receivedParts: [...upload.receivedParts, { index, size: body.size, sha256: hash }],
      });
    },
    complete: async () => dto({ state: "ready", fileId: "file" }),
    cancel: async () => {
      upload = dto({ state: "cancelled" });
    },
    file: async () => ({
      id: "file",
      purpose: "avatar",
      name: "avatar.png",
      size: 5 * 1024 * 1024,
      state: "ready",
      createdAt: "",
      previewUrl: "/api/v1/files/file/preview",
    }),
    deleteFile: async () => {},
    saveAvatar: async () => ({ image: "/media/new.jpg", avatarRevision: 1 }),
    removeAvatar: async () => ({ image: null, avatarRevision: 2 }),
  };
  const controller = createUploadController({
    purpose,
    api,
    userId: "alice",
    storage,
    onState: (state) => states.push(state),
  });
  return {
    api,
    storage,
    controller,
    states,
    parts,
    setUpload: (next: UploadDto) => {
      upload = next;
    },
  };
}
describe("streaming SHA256", () => {
  test("known vector and only 1 MiB slices, never whole-file arrayBuffer", async () => {
    const tiny = new File(["abc"], "a");
    expect(await hashChunks(tiny)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const input = file();
    const slices: number[] = [];
    const slice = input.slice.bind(input);
    input.arrayBuffer = () => {
      throw new Error("whole-file read");
    };
    input.slice = (start, end) => {
      slices.push((end ?? input.size) - (start ?? 0));
      return slice(start, end);
    };
    await hashChunks(input);
    expect(slices).toEqual([1048576, 1048576, 1048576, 1048576, 1048576]);
  });
});
describe("upload controller", () => {
  test("progress uses registered ready parts and skips out-of-order ready parts", async () => {
    const f = fixture();
    f.setUpload(dto({ receivedParts: [{ index: 1, size: 1048576, sha256: hash }] }));
    await f.controller.start(file());
    expect(f.parts).toEqual([0]);
    expect(f.states.filter((s) => s.phase === "uploading").map((s) => s.progress)).toContain(0.2);
    expect(f.states.at(-1)?.phase).toBe("ready");
    const records = readUploadRecords(f.storage, "alice");
    expect(records).toHaveLength(1);
    expect(Object.keys(records[0]!).sort()).toEqual(["expiry", "hash", "name", "purpose", "schemaVersion", "size", "uploadId"]);
    f.controller.forget(records[0]!.uploadId);
    expect(readUploadRecords(f.storage, "alice")).toEqual([]);
    f.controller.dispose();
  });
  test("resume requires same hash and stores only account-scoped approved metadata", async () => {
    const f = fixture();
    f.storage.setItem(
      "astrodx-uploads:alice",
      JSON.stringify([
        {
          uploadId: "upload",
          name: "avatar.png",
          size: 5242880,
          hash,
          expiry: dto().expiresAt,
        },
      ]),
    );
    expect(readUploadRecords(f.storage, "bob")).toEqual([]);
    await f.controller.resume(file(), readUploadRecords(f.storage, "alice")[0]!);
    expect(f.parts).toEqual([0, 1]);
    f.controller.dispose();
  });
  test("wrong file cannot resume or send parts", async () => {
    const f = fixture();
    await f.controller.resume(file(), {
      uploadId: "upload",
      name: "avatar.png",
      size: 5242880,
      hash: "b".repeat(64),
      expiry: dto().expiresAt,
    });
    expect(f.parts).toEqual([]);
    expect(f.states.at(-1)?.phase).toBe("error");
    f.controller.dispose();
  });
  test("cancel aborts request, sends DELETE, suppresses late success", async () => {
    const f = fixture();
    let release!: () => void;
    let aborted = false;
    let deleted = false;
    f.api.part = async (_id, _index, _body, _hash, signal) =>
      new Promise<void>((resolve) => {
        release = resolve;
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      });
    f.api.cancel = async () => {
      deleted = true;
    };
    const start = f.controller.start(file());
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    await f.controller.cancel();
    release();
    await start;
    expect(aborted).toBe(true);
    expect(deleted).toBe(true);
    expect(f.states.at(-1)?.phase).toBe("idle");
    f.controller.dispose();
  });
  test("logout clears only that account's records and disposes in-flight work", async () => {
    const f = fixture();
    let release!: () => void;
    let aborted = false;
    f.api.part = async (_id, _index, _body, _hash, signal) =>
      new Promise<void>((resolve) => {
        release = resolve;
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        });
      });
    f.storage.setItem("theme", "dark");
    const start = f.controller.start(file());
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    clearUploadRecords("alice", f.storage);
    await start;
    expect(aborted).toBe(true);
    expect(readUploadRecords(f.storage, "alice")).toEqual([]);
    expect(f.storage.getItem("theme")).toBe("dark");
  });
});

test("ready-but-unsaved recovery reselects same hash and fetches private file without parts", async () => {
  const f = fixture();
  const record = {
    uploadId: "upload",
    name: "avatar.png",
    size: 5242880,
    hash,
    expiry: dto().expiresAt,
  };
  f.storage.setItem("astrodx-uploads:alice", JSON.stringify([record, { ...record, uploadId: "newer" }]));
  f.setUpload(dto({ state: "ready", fileId: "file" }));
  await f.controller.resume(file(), record);
  expect(f.parts).toEqual([]);
  expect(f.states.at(-1)?.phase).toBe("ready");
  f.controller.forget("upload");
  expect(readUploadRecords(f.storage, "alice").map((r) => r.uploadId)).toEqual(["newer"]);
  f.controller.dispose();
});

test("expired or malformed recovery is ignored and unavailable localStorage does not break upload", async () => {
  const f = fixture();
  f.storage.setItem(
    "astrodx-uploads:alice",
    JSON.stringify([
      { uploadId: "expired", name: "a", size: 1, hash, expiry: new Date(0).toISOString() },
      { uploadId: "bad", name: "a", size: -1, hash, expiry: dto().expiresAt },
    ]),
  );
  expect(readUploadRecords(f.storage, "alice")).toEqual([]);
  f.storage.setItem = () => {
    throw new DOMException("QuotaExceeded", "QuotaExceededError");
  };
  await f.controller.start(file());
  expect(f.states.at(-1)?.phase).toBe("ready");
  f.controller.dispose();
});
test("superseded complete response cannot replace the newer upload state", async () => {
  const f = fixture();
  let release!: (dto: UploadDto) => void;
  let completes = 0;
  f.api.complete = async () =>
    ++completes === 1
      ? new Promise((resolve) => {
          release = resolve;
        })
      : dto({ state: "ready", fileId: "file" });
  const old = f.controller.start(file());
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  await f.controller.start(file());
  const count = f.states.length;
  release(dto({ state: "rejected", errorCode: "IMAGE_INVALID" }));
  await old;
  expect(f.states).toHaveLength(count);
  expect(f.states.at(-1)?.phase).toBe("ready");
  f.controller.dispose();
});

test("late cancelled upload DELETE cannot reset a newer ready upload", async () => {
  const f = fixture();
  let release!: () => void;
  f.api.cancel = async () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  await f.controller.start(file());
  const cancel = f.controller.cancel();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  await f.controller.start(file());
  release();
  await cancel;
  expect(f.states.at(-1)?.phase).toBe("ready");
  f.controller.dispose();
});

test("chart controller uses chart purpose and accepts a ready private summary without public preview", async () => {
  const f = fixture("chart-source");
  let purpose: StoragePurpose | undefined;
  f.api.init = async (input) => { purpose = input.purpose; return dto(); };
  f.api.file = async () => ({ id: "file", purpose: "chart-source", name: "chart.zip", size: 5242880,
    state: "ready", createdAt: "", chart: { title: "Test", artist: "", maidataMd5Base64: "md5",
      difficulties: [], warnings: [], audio: null, hasCover: false } });
  await f.controller.start(new File([new Uint8Array(5 * 1024 * 1024)], "chart.zip", { type: "application/zip" }));
  expect(purpose).toBe("chart-source");
  expect(f.states.at(-1)?.phase).toBe("ready");
  expect(readUploadRecords(f.storage, "alice")).toEqual([]);
  expect(readUploadRecords(f.storage, "alice", "chart-source")[0]).toMatchObject({ schemaVersion: 2, purpose: "chart-source" });
  f.controller.dispose();
});

test("recovery keeps old avatars separate from schema v2 chart records and preserves both purposes", async () => {
  const f = fixture("chart-source");
  const legacy = { uploadId: "old", name: "a.png", size: 1, hash, expiry: dto().expiresAt };
  const chart = { ...legacy, schemaVersion: 2, purpose: "chart-source", uploadId: "chart", size: 20 * 1024 * 1024 };
  f.storage.setItem("astrodx-uploads:alice", JSON.stringify([legacy, chart, { ...chart, schemaVersion: 3 }, { ...chart, purpose: "other" }]));
  expect(readUploadRecords(f.storage, "alice").map((row) => row.uploadId)).toEqual(["old"]);
  expect(readUploadRecords(f.storage, "alice", "chart-source").map((row) => row.uploadId)).toEqual(["chart"]);
  f.controller.forget("chart");
  expect(readUploadRecords(f.storage, "alice").map((row) => row.uploadId)).toEqual(["old"]);
  f.controller.dispose();
});

test("chart resume cannot adopt a legacy avatar record", async () => {
  const f = fixture("chart-source");
  await f.controller.resume(new File(["x"], "a.zip"), { uploadId: "old", name: "a", size: 1, hash, expiry: dto().expiresAt });
  expect(f.parts).toEqual([]);
  expect(f.states.at(-1)?.phase).toBe("error");
  f.controller.dispose();
});
