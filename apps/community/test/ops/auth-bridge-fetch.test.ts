import { expect, mock, test } from "bun:test";
import { fetchReadonlyPublic } from "./auth-bridge-helper";

const target = "https://adxc.saop.cc/help";
const options = { headers: new Headers({ cookie: "test-only-cookie" }), proxy: "http://host.docker.internal:20172", decompress: false as const, redirect: "manual" as const };

test.each(["GET", "HEAD"])("%s retries a failed connection on the same public origin", async method => {
  const response = new Response(null, { status: 200 });
  const read = mock(async (_input: string, _init: RequestInit) => response);
  read.mockRejectedValueOnce(new Error("connection closed"));
  expect(await fetchReadonlyPublic(target, { ...options, method }, read)).toBe(response);
  expect(read).toHaveBeenCalledTimes(2);
  for (const [input, init] of read.mock.calls) {
    expect(input).toBe(target);
    expect(init.method).toBe(method);
    expect(new Headers(init.headers).get("cookie")).toBe("test-only-cookie");
  }
});

test("a stalled connection is aborted before the next attempt succeeds", async () => {
  const response = new Response(null, { status: 200 });
  let attempts = 0;
  const read = mock(async (_input: string, init: RequestInit): Promise<Response> => {
    if (++attempts > 1) return response;
    const signal = init.signal;
    if (!signal) throw new Error("connection deadline required");
    return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  expect(await fetchReadonlyPublic(target, options, read, 10)).toBe(response);
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[0]?.[1].signal?.aborted).toBe(true);
});

test.each([403, 429, 503])("HTTP %d is returned once without retry", async status => {
  const response = new Response(null, { status });
  const read = mock(async () => response);
  expect(await fetchReadonlyPublic(target, options, read)).toBe(response);
  expect(read).toHaveBeenCalledTimes(1);
});

test("persistent transport failure stops after three attempts", async () => {
  const read = mock(async () => { throw new Error("connection closed"); });
  await expect(fetchReadonlyPublic(target, options, read)).rejects.toThrow("connection closed");
  expect(read).toHaveBeenCalledTimes(3);
});

test("write methods are rejected before any upstream request", async () => {
  const read = mock(async () => new Response(null));
  await expect(fetchReadonlyPublic(target, { ...options, method: "POST" }, read)).rejects.toThrow("READONLY_METHOD_REQUIRED");
  expect(read).not.toHaveBeenCalled();
});


test("a caller cannot extend the production connection deadline", async () => {
  const read = mock(async () => new Response(null));
  await expect(fetchReadonlyPublic(target, options, read, 6001)).rejects.toThrow("READONLY_DEADLINE_REQUIRED");
  expect(read).not.toHaveBeenCalled();
});
