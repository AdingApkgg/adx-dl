import { expect, test } from "bun:test";
import { normalizeOriginalName, objectKey, temporaryKey } from "./keys";
test("names are safe basenames with no control characters or path segments", () => {
  expect(normalizeOriginalName("../a\r\nb.png")).toBe("ab.png");
  expect(normalizeOriginalName("C:\\pictures\\photo.png")).toBe("photo.png");
  expect(normalizeOriginalName("..\u0000")).toBe("file");
  expect([...normalizeOriginalName("😀".repeat(256))]).toHaveLength(255);
});
test("only canonical lowercase hashes and server-generated identifiers produce keys", () => {
  const hash = `abcd${"0".repeat(60)}`;
  expect(objectKey(hash)).toBe(`sha256/ab/cd/${hash}`);
  for (const bad of [hash.toUpperCase(), "../a", "0".repeat(63)]) expect(() => objectKey(bad)).toThrow();
  const id = crypto.randomUUID();
  expect(temporaryKey(id, 0, id)).toBe(`tmp/${id}/0/${id}`);
  expect(() => temporaryKey("../a", 0, id)).toThrow();
  expect(() => temporaryKey(id, 115, id)).toThrow();
});
