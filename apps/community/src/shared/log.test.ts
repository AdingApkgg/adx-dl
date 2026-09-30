import { describe, expect, test } from "bun:test";

import { createLogger } from "./log";

describe("createLogger", () => {
  test("每条日志是一行 JSON，带时间、级别、事件和字段", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));

    log.info("request", { path: "/healthz", status: 200, skipped: undefined });
    log.warn("requeued", { count: 2 });
    log.error("boom", { message: "x" });

    expect(lines).toHaveLength(3);
    const first = JSON.parse(lines[0] ?? "{}");
    expect(first).toMatchObject({ level: "info", event: "request", path: "/healthz", status: 200 });
    expect(typeof first.time).toBe("string");
    expect("skipped" in first).toBe(false);
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ level: "warn", event: "requeued", count: 2 });
    expect(JSON.parse(lines[2] ?? "{}")).toMatchObject({ level: "error", event: "boom", message: "x" });
  });

  test("调用方的字段不能冒充时间、级别和事件", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));

    log.info("request", { path: "/", time: "1970-01-01T00:00:00.000Z", level: "error", event: "spoofed" });

    const entry = JSON.parse(lines[0] ?? "{}");
    expect(entry).toMatchObject({ level: "info", event: "request", path: "/" });
    expect(entry.time).not.toBe("1970-01-01T00:00:00.000Z");
    // 这三项仍然排在最前面，docker logs 里一眼能看到。
    expect(Object.keys(entry).slice(0, 3)).toEqual(["time", "level", "event"]);
  });
});
