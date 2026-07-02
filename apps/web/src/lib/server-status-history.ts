import type { ServerStatusSnapshot } from "@/lib/server-status";

export type ServerStatusHistoryPoint = {
  timestamp: number;
  timeLabel: string;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  load1: number;
  load5: number;
  load15: number;
  uploadSpeed: number;
  downloadSpeed: number;
};

function parseSnapshotTimestamp(value: string) {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function toTimeLabel(timestamp: number) {
  const date = new Date(timestamp);
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function buildHistoryPoint(snapshot: ServerStatusSnapshot): ServerStatusHistoryPoint | null {
  const timestamp = parseSnapshotTimestamp(snapshot.fetchedAt);
  if (
    timestamp == null ||
    snapshot.cpuPercentValue == null ||
    snapshot.memoryPercentValue == null ||
    snapshot.diskPercentValue == null ||
    snapshot.load1Value == null ||
    snapshot.load5Value == null ||
    snapshot.load15Value == null ||
    snapshot.uploadSpeedValue == null ||
    snapshot.downloadSpeedValue == null
  ) {
    return null;
  }

  return {
    timestamp,
    timeLabel: toTimeLabel(timestamp),
    cpuPercent: snapshot.cpuPercentValue,
    memoryPercent: snapshot.memoryPercentValue,
    diskPercent: snapshot.diskPercentValue,
    load1: snapshot.load1Value,
    load5: snapshot.load5Value,
    load15: snapshot.load15Value,
    uploadSpeed: snapshot.uploadSpeedValue,
    downloadSpeed: snapshot.downloadSpeedValue,
  };
}

export function appendHistoryPoint(
  history: ServerStatusHistoryPoint[],
  snapshot: ServerStatusSnapshot,
  maxPoints: number
) {
  const point = buildHistoryPoint(snapshot);
  if (!point) {
    return history;
  }

  const nextHistory = [...history, point];
  if (maxPoints <= 0) {
    return [];
  }

  return nextHistory.slice(-maxPoints);
}

const HISTORY_POINT_NUMERIC_FIELDS = [
  "timestamp",
  "cpuPercent",
  "memoryPercent",
  "diskPercent",
  "load1",
  "load5",
  "load15",
  "uploadSpeed",
  "downloadSpeed",
] as const;

function isHistoryPoint(value: unknown): value is ServerStatusHistoryPoint {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.timeLabel === "string" &&
    HISTORY_POINT_NUMERIC_FIELDS.every(
      (field) => typeof record[field] === "number" && Number.isFinite(record[field])
    )
  );
}

/**
 * Revives a history array persisted as JSON (e.g. in sessionStorage). Entries
 * are validated field-by-field — the payload is external state that may be
 * stale or malformed — pruned to the age window, sorted, and capped.
 */
export function parseStoredHistory(
  raw: string | null,
  maxPoints: number,
  maxAgeMs: number,
  now: number = Date.now()
): ServerStatusHistoryPoint[] {
  if (!raw || maxPoints <= 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    // Timestamps derive from the monitor's clock, so allow mild future skew
    // while still dropping garbage that would otherwise never age out.
    const cutoff = now - maxAgeMs;
    const horizon = now + maxAgeMs;
    return parsed
      .filter(isHistoryPoint)
      .filter((point) => point.timestamp >= cutoff && point.timestamp <= horizon)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-maxPoints);
  } catch {
    return [];
  }
}

/** Merges stored history into the live one, deduped by timestamp and capped. */
export function mergeHistory(
  stored: ServerStatusHistoryPoint[],
  current: ServerStatusHistoryPoint[],
  maxPoints: number
): ServerStatusHistoryPoint[] {
  if (stored.length === 0) {
    return current;
  }
  const liveTimestamps = new Set(current.map((point) => point.timestamp));
  const merged = [...stored.filter((point) => !liveTimestamps.has(point.timestamp)), ...current];
  merged.sort((a, b) => a.timestamp - b.timestamp);
  return merged.slice(-maxPoints);
}
