import { describe, expect, test } from "bun:test";

import { createLogger } from "./log";

describe("createLogger", () => {
  test("每条日志是一行 JSON，带时间、级别、事件和字段", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));

    log.info("request", { path: "/healthz", status: 200, skipped: undefined });
    log.error("boom", { message: "x" });

    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? "{}");
    expect(first).toMatchObject({ level: "info", event: "request", path: "/healthz", status: 200 });
    expect(typeof first.time).toBe("string");
    expect("skipped" in first).toBe(false);
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ level: "error", event: "boom", message: "x" });
  });
});
