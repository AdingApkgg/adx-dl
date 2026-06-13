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
