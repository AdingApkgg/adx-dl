import { describe, expect, test } from "bun:test";

import type { ServerStatusSnapshot } from "@/lib/server-status";
import {
  appendHistoryPoint,
  buildHistoryPoint,
  type ServerStatusHistoryPoint,
} from "@/lib/server-status-history";

const snapshot: ServerStatusSnapshot = {
  name: "Alice",
  state: "在线",
  uptime: "4 天 14 小时",
  arch: "x86_64",
  region: "SG",
  system: "debian",
  cpuModel: "AMD EPYC 9755",
  load: "0.27 / 0.39 / 0.41",
  uploadTotal: "10.85 GiB",
  downloadTotal: "32.06 GiB",
  bootTime: "2026-06-08 14:59:09",
  lastReportTime: "2026-06-13 06:59:22",
  cpuPercent: "0.27%",
  memoryPercent: "17%",
  memoryUsageText: "65.98 GiB / 393.42 GiB",
  swapPercent: "0%",
  swapUsageText: "no swap",
  diskPercent: "23%",
  diskUsageText: "458.15 GiB / 1.92 TiB",
  processCount: "1415",
  uploadSpeed: "1.99 K/s",
  downloadSpeed: "1.72 K/s",
  tcpCount: "184",
  udpCount: "20",
  cpuPercentValue: 0.27,
  memoryPercentValue: 16.78,
  diskPercentValue: 23.29,
  load1Value: 0.27,
  load5Value: 0.39,
  load15Value: 0.41,
  uploadSpeedValue: 2037,
  downloadSpeedValue: 1764,
  fetchedAt: "2026-06-13 07:20:00",
  sourceUrl: "https://s.saop.cc/server/66",
};

describe("server status history", () => {
  test("builds a chart history point from snapshot numeric values", () => {
    const expectedTimestamp = new Date("2026-06-13T07:20:00").getTime();

    expect(buildHistoryPoint(snapshot)).toEqual({
      timestamp: expectedTimestamp,
      timeLabel: "07:20",
      cpuPercent: 0.27,
      memoryPercent: 16.78,
      diskPercent: 23.29,
      load1: 0.27,
      load5: 0.39,
      load15: 0.41,
      uploadSpeed: 2037,
      downloadSpeed: 1764,
    });
  });

  test("returns null when required numeric metrics are missing", () => {
    expect(
      buildHistoryPoint({
        ...snapshot,
        cpuPercentValue: null,
      })
    ).toBeNull();
  });

  test("appends points and trims to max history size", () => {
    const history: ServerStatusHistoryPoint[] = Array.from({ length: 3 }, (_, index) => ({
      timestamp: index + 1,
      timeLabel: `00:0${index}`,
      cpuPercent: index,
      memoryPercent: index,
      diskPercent: index,
      load1: index,
      load5: index,
      load15: index,
      uploadSpeed: index,
      downloadSpeed: index,
    }));

    const nextHistory = appendHistoryPoint(history, snapshot, 3);

    expect(nextHistory).toHaveLength(3);
    expect(nextHistory[0].timestamp).toBe(2);
    expect(nextHistory[2].timeLabel).toBe("07:20");
  });
});
