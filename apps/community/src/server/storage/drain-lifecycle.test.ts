import { test, expect } from "bun:test";
import { createMediaDrain } from "./drain";
import type { Db } from "../db/client";
test("web shutdown aborts in-flight media and permanently closes registration", () => {
  const drain = createMediaDrain({ db: {} as Db, secret: "x".repeat(32) });
  const read = drain.register("a".repeat(64))!;
  drain.shutdown();
  expect(read.signal.aborted).toBe(true);
  expect(drain.register("b".repeat(64))).toBeNull();
  drain.shutdown();
  read.release();
});
