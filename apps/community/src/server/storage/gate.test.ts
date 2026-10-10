import { describe, expect, test } from "bun:test";
import { createStorageBreaker, createStorageGate } from "./gate";
import { ObjectMissingError, StorageUnavailableError } from "./errors";
describe("storage acquisition", () => {
  test("saturation rejects immediately and release is idempotent", () => {
    const gate = createStorageGate({ limit: 2 });
    const first = gate.acquire();
    const second = gate.acquire();
    expect(() => gate.acquire()).toThrow(StorageUnavailableError);
    first();
    first();
    const third = gate.acquire();
    expect(() => gate.acquire()).toThrow(StorageUnavailableError);
    second();
    third();
    gate.acquire()();
  });
  test("invalid limits reject configuration", () => {
    for (const limit of [0, -1, 1.5, Infinity]) expect(() => createStorageGate({ limit })).toThrow(TypeError);
  });
});
describe("storage breaker", () => {
  test("five consecutive failures in 30s open for 15s and allow only one recovery probe", () => {
    let time = 0;
    const breaker = createStorageBreaker({ now: () => time });
    for (let i = 0; i < 5; i++) {
      breaker.acquire().failure(new Error("transport"));
      time += 1000;
    }
    expect(() => breaker.acquire()).toThrow(StorageUnavailableError);
    time = 18_999;
    expect(() => breaker.acquire()).toThrow(StorageUnavailableError);
    time = 19_000;
    const probe = breaker.acquire();
    expect(() => breaker.acquire()).toThrow(StorageUnavailableError);
    probe.success();
    breaker.acquire().success();
  });
  test("success and elapsed window reset consecutive failures", () => {
    let time = 0;
    const breaker = createStorageBreaker({ now: () => time });
    for (let i = 0; i < 4; i++) breaker.acquire().failure(new Error());
    breaker.acquire().success();
    for (let i = 0; i < 4; i++) breaker.acquire().failure(new Error());
    time = 30_001;
    breaker.acquire().failure(new Error());
    breaker.acquire().success();
  });
  test("missing, forbidden, caller cancellation and duplicate settlement do not trip", () => {
    const breaker = createStorageBreaker({ now: () => 0 });
    for (let i = 0; i < 6; i++) {
      breaker.acquire().failure(new ObjectMissingError());
      breaker.acquire().failure({ $metadata: { httpStatusCode: 403 } });
      breaker.acquire().cancel();
    }
    const attempt = breaker.acquire();
    attempt.failure(new Error());
    attempt.failure(new Error());
    attempt.failure(new Error());
    breaker.acquire().success();
  });
  test("failed half-open probe reopens and cancelled probe can be retried", () => {
    let time = 0;
    const breaker = createStorageBreaker({ now: () => time });
    for (let i = 0; i < 5; i++) breaker.acquire().failure(new Error());
    time = 15_000;
    breaker.acquire().cancel();
    breaker.acquire().failure(new Error());
    time = 29_999;
    expect(() => breaker.acquire()).toThrow(StorageUnavailableError);
    time = 30_000;
    breaker.acquire().success();
    breaker.acquire().success();
  });
});
test("local saturation never opens the storage circuit", async () => {
  const { withStorageCircuitBreaker } = await import("./gate");
  const gate = createStorageGate({ limit: 1 });
  const release = gate.acquire();
  const driver = withStorageCircuitBreaker({
    ready: async () => {
      gate.acquire()();
    },
  } as import("./contracts").ObjectDriver);
  for (let i = 0; i < 6; i++) await expect(driver.ready()).rejects.toBeInstanceOf(StorageUnavailableError);
  release();
  await driver.ready();
});
test("old in-flight successes cannot close a newer opened circuit", () => {
  let time = 0;
  const breaker = createStorageBreaker({ now: () => time });
  const old = breaker.acquire();
  for (let i = 0; i < 5; i++) breaker.acquire().failure(new Error());
  old.success();
  expect(() => breaker.acquire()).toThrow(StorageUnavailableError);
  time = 15_000;
  breaker.acquire().success();
});
test("post-header failures are recorded before a consumer reads and half-open reads stay exclusive", async () => {
  const { withStorageCircuitBreaker } = await import("./gate");
  let time = 0;
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const raw = {
    get: async () => ({
      size: 1,
      mime: "image/jpeg",
      sha256: "a".repeat(64),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
        },
      }),
    }),
    ready: async () => {},
  } as unknown as import("./contracts").ObjectDriver;
  const driver = withStorageCircuitBreaker(raw, { now: () => time });
  for (let i = 0; i < 5; i++) {
    await driver.get({ bucket: "original", key: "test" });
    bodyController!.error(new Error("private upstream detail"));
    await Bun.sleep(0);
  }
  await expect(driver.ready()).rejects.toBeInstanceOf(StorageUnavailableError);
  time = 15_000;
  const probe = await driver.get({ bucket: "original", key: "test" });
  await expect(driver.ready()).rejects.toBeInstanceOf(StorageUnavailableError);
  await probe.body.cancel();
  await driver.ready();
});
test("cancellation failures return only public-safe errors", async () => {
  const { withStorageCircuitBreaker } = await import("./gate");
  const raw = {
    get: async () => ({
      size: 1,
      mime: "image/jpeg",
      sha256: "a".repeat(64),
      body: new ReadableStream<Uint8Array>({
        cancel() {
          throw new Error("private upstream secret");
        },
      }),
    }),
  } as unknown as import("./contracts").ObjectDriver;
  const read = await withStorageCircuitBreaker(raw).get({
    bucket: "original",
    key: "test",
  });
  await expect(read.body.cancel()).rejects.toBeInstanceOf(StorageUnavailableError);
});
