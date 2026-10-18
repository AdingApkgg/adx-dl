import { expect, test } from "bun:test";
import { createLogger } from "@/shared/log";
import type { RedisCommandSender } from "../middleware/rate-limit";
import { createOneBotClient } from "./client";
import { readNapcatHealth, readNapcatObservation, recordNapcatHealth, writeNapcatHealth } from "./health";
function fixture() {
  const records = new Map<string, string>();
  const writes: string[][] = [];
  const redis: RedisCommandSender = { async send(command, args) {
    if (command === "GET") return records.get(args[0]!) ?? null;
    if (command === "SET") { records.set(args[0]!, args[1]!); writes.push(args); return "OK"; }
    throw new Error("Unexpected command");
  } };
  return { records, writes, redis };
}
test("stable observations preserve change time and stale evidence becomes unknown", async () => {
  const { redis, records, writes } = fixture(), key = "health:test", lines: string[] = [], log = createLogger(line => lines.push(line));
  const previous = new Date(Date.now() - 60_000).toISOString();
  records.set(key + ":last", JSON.stringify({ state: "offline", checkedAt: previous, changedAt: previous, failure: "qq_offline" }));
  await writeNapcatHealth(redis, "offline", key, "qq_offline", log);
  expect((await readNapcatObservation(redis, key)).changedAt).toBe(previous);
  expect(lines).toHaveLength(0);
  expect(writes.map(args => args.slice(2))).toEqual([["EX", "180"], ["EX", "604800"]]);
  records.delete(key);
  expect(await readNapcatHealth(redis, key)).toBeNull();
  expect(await readNapcatObservation(redis, key)).toMatchObject({ state: "unknown", changedAt: previous });
  await writeNapcatHealth(redis, "online", key, null, log);
  expect(await readNapcatObservation(redis, key)).toMatchObject({ state: "online", failure: null });
  expect(lines).toHaveLength(1);
});
test("provider failures are classified without raw exception text", async () => {
  const { redis } = fixture(), lines: string[] = [];
  const client = createOneBotClient({ httpUrl: "https://secret.invalid", accessToken: "secret-token", fetch: async () => Response.json({ status: "failed", message: "private-chat secret-token" }) });
  await recordNapcatHealth(client, redis, "test", createLogger(line => lines.push(line)));
  expect(await readNapcatObservation(redis, "test")).toMatchObject({ state: "unreachable", failure: "provider_error" });
  expect(lines.join()).not.toMatch(/private-chat|secret-token|secret.invalid/);
});
test("malformed and expired live observations cannot claim online or offline", async () => {
  const { redis, records } = fixture();
  for (const record of [{ state: "online" }, { state: "offline", checkedAt: new Date(Date.now() - 181_000).toISOString() },
    { state: "online", checkedAt: new Date(Date.now() + 60_000).toISOString() }]) {
    records.set("test", JSON.stringify(record));
    expect(await readNapcatHealth(redis, "test")).toBeNull();
    expect((await readNapcatObservation(redis, "test")).state).toBe("unknown");
  }
});
