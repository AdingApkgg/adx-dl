import { StorageError } from "./errors";
export function parseRange(value: string, size: number): { start: number; end: number } {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  const fail = () => {
    throw new StorageError(416, "INVALID_RANGE");
  };
  if (!match || (!match[1] && !match[2])) return fail();
  const a = Number(match[1]),
    b = Number(match[2]);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || size <= 0) return fail();
  if (!match[1]) {
    if (b <= 0) return fail();
    return { start: Math.max(0, size - b), end: size - 1 };
  }
  const end = match[2] ? Math.min(b, size - 1) : size - 1;
  if (a >= size || end < a) return fail();
  return { start: a, end };
}
