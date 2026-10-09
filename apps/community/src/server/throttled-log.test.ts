import { describe, expect, test } from "bun:test";

import { createLogger } from "@/shared/log";

import { throttledErrorLog } from "./throttled-log";

describe("throttledErrorLog", () => {
  test("一段时间里只记第一条，压下去的次数记在下一条里", () => {
    const lines: string[] = [];
    let now = 0;
    const report = throttledErrorLog(createLogger((line) => lines.push(line)), "redis_down", {
      intervalMs: 60_000,
      now: () => now,
    });
    const events = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

    report(new Error("Connection closed"));
    now = 1_000;
    report(new Error("Connection closed"));
    now = 59_999;
    report(new Error("Connection closed"));
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ level: "error", event: "redis_down", message: "Connection closed" });
    expect(events()[0]).not.toHaveProperty("suppressed");

    now = 61_000;
    report(new Error("still down"));
    expect(events()).toHaveLength(2);
    expect(events()[1]).toMatchObject({ event: "redis_down", message: "still down", suppressed: 2 });

    // 计数从这一条重新开始。
    now = 200_000;
    report(new Error("again"));
    expect(events()[2]).not.toHaveProperty("suppressed");
  });
});
