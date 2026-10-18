import type { Logger } from "@/shared/log";
import type { NapcatFailure, NapcatObservation, NapcatState } from "@/shared/napcat";
import type { RedisCommandSender } from "../middleware/rate-limit";
import { OneBotError, type OneBotClient } from "./client";
export type { NapcatState } from "@/shared/napcat";

export const NAPCAT_HEALTH_KEY = "napcat:health";
const FRESH_MS = 180_000;
const HISTORY_SECONDS = 7 * 24 * 3600;
export const unknownNapcatObservation = (): NapcatObservation => ({ state: "unknown", checkedAt: null, changedAt: null, failure: null });
type HealthRecord = NapcatObservation & { state: NapcatState; checkedAt: string; changedAt: string };

function parseRecord(raw: unknown, maxAge: number): HealthRecord | null {
  if (typeof raw !== "string") return null;
  try {
    const r = JSON.parse(raw);
    if (!r || !["online", "offline", "unreachable"].includes(r.state) || typeof r.checkedAt !== "string") return null;
    const at = Date.parse(r.checkedAt), changed = Date.parse(r.changedAt ?? r.checkedAt), now = Date.now();
    if (!Number.isFinite(at) || !Number.isFinite(changed) || at > now + 5000 || now - at >= maxAge || changed > at) return null;
    const failure = ["qq_offline", "timeout", "provider_error", "connection_error"].includes(r.failure) ? r.failure as NapcatFailure : null;
    return { state: r.state, checkedAt: new Date(at).toISOString(), changedAt: new Date(changed).toISOString(), failure };
  } catch { return null; }
}
async function probe(client: OneBotClient): Promise<{ state: NapcatState; failure: NapcatFailure | null }> {
  try {
    return (await client.getStatus({ timeoutMs: 5000 })).online
      ? { state: "online", failure: null } : { state: "offline", failure: "qq_offline" };
  } catch (error) {
    return { state: "unreachable", failure: error instanceof OneBotError ? "provider_error"
      : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "timeout" : "connection_error" };
  }
}
export async function checkNapcat(client: OneBotClient): Promise<NapcatState> { return (await probe(client)).state; }

/** Two bounded keys: live state (3 minutes) and last observation (7 days). Logs retain transitions. */
export async function writeNapcatHealth(redis: RedisCommandSender, state: NapcatState, key = NAPCAT_HEALTH_KEY,
  failure: NapcatFailure | null = state === "offline" ? "qq_offline" : null, log?: Logger): Promise<void> {
  const previous = parseRecord(await redis.send("GET", [`${key}:last`]), HISTORY_SECONDS * 1000);
  const checkedAt = new Date().toISOString();
  const changed = !previous || previous.state !== state;
  const record: HealthRecord = { state, checkedAt, changedAt: changed ? checkedAt : (previous?.changedAt ?? checkedAt), failure };
  const value = JSON.stringify(record);
  await redis.send("SET", [key, value, "EX", "180"]);
  await redis.send("SET", [`${key}:last`, value, "EX", String(HISTORY_SECONDS)]);
  if (changed || previous?.failure !== failure) log?.info("napcat_health_changed", {
    previousState: previous?.state ?? "unknown", state, checkedAt, changedAt: record.changedAt, failure,
  });
}
export async function readNapcatObservation(redis: RedisCommandSender, key = NAPCAT_HEALTH_KEY): Promise<NapcatObservation> {
  const live = parseRecord(await redis.send("GET", [key]), FRESH_MS);
  if (live) return live;
  const last = parseRecord(await redis.send("GET", [`${key}:last`]), HISTORY_SECONDS * 1000);
  return last ? { ...last, state: "unknown" } : unknownNapcatObservation();
}
export async function readNapcatHealth(redis: RedisCommandSender, key = NAPCAT_HEALTH_KEY): Promise<NapcatState | null> {
  const record = parseRecord(await redis.send("GET", [key]), FRESH_MS);
  return record?.state ?? null;
}
export async function recordNapcatHealth(client: OneBotClient, redis: RedisCommandSender, key = NAPCAT_HEALTH_KEY, log?: Logger): Promise<void> {
  const result = await probe(client);
  await writeNapcatHealth(redis, result.state, key, result.failure, log);
}
