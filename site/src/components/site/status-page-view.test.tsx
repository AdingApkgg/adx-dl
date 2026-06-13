import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StatusPageView } from "@/components/site/status-page-view";
import type { ServerStatusHistoryPoint } from "@/lib/server-status-history";
import type { ServerStatusSnapshot } from "@/lib/server-status";

const snapshot: ServerStatusSnapshot = {
  name: "Alice",
  state: "在线",
  uptime: "4 天 14 小时",
  arch: "x86_64",
  region: "SG",
  system: "debian",
  cpuModel: "AMD EPYC 9755",
  load: "0.22 / 0.25 / 0.47",
  uploadTotal: "10.73 GiB",
  downloadTotal: "31.98 GiB",
  bootTime: "2026-06-08 06:59:09",
  lastReportTime: "2026-06-12 21:53:53",
  cpuPercent: "0.11%",
  memoryPercent: "17%",
  memoryUsageText: "66.06 GiB / 393.42 GiB",
  swapPercent: "0%",
  swapUsageText: "no swap",
  diskPercent: "23%",
  diskUsageText: "458.22 GiB / 1.92 TiB",
  processCount: "1393",
  uploadSpeed: "3.42K/s",
  downloadSpeed: "2.16K/s",
  tcpCount: "198",
  udpCount: "20",
  cpuPercentValue: 0.11,
  memoryPercentValue: 16.8,
  diskPercentValue: 23.3,
  load1Value: 0.22,
  load5Value: 0.25,
  load15Value: 0.47,
  uploadSpeedValue: 3502,
  downloadSpeedValue: 2212,
  fetchedAt: "2026-06-13T00:00:00.000Z",
  sourceUrl: "https://s.saop.cc/server/66",
};

const history: ServerStatusHistoryPoint[] = [
  {
    timestamp: 1781306400000,
    timeLabel: "06:00",
    cpuPercent: 0.09,
    memoryPercent: 16.7,
    diskPercent: 23.2,
    load1: 0.18,
    load5: 0.21,
    load15: 0.27,
    uploadSpeed: 1800,
    downloadSpeed: 1500,
  },
  {
    timestamp: 1781310000000,
    timeLabel: "07:00",
    cpuPercent: 0.11,
    memoryPercent: 16.8,
    diskPercent: 23.3,
    load1: 0.22,
    load5: 0.25,
    load15: 0.47,
    uploadSpeed: 3502,
    downloadSpeed: 2212,
  },
];

describe("status page view", () => {
  test("renders overview, resource, and network cards from snapshot", () => {
    const html = renderToStaticMarkup(
      <StatusPageView
        locale="zh"
        snapshot={snapshot}
        history={history}
        isRefreshing={false}
        errorMessage={null}
      />
    );

    expect(html).toContain("Alice");
    expect(html).toContain("在线");
    expect(html).toContain("66.06 GiB / 393.42 GiB");
    expect(html).toContain("3.42K/s");
    expect(html).toContain("查看原监控页");
    expect(html).toContain("资源趋势");
    expect(html).toContain("网络趋势");
  });

  test("renders soft error while keeping last successful data visible", () => {
    const html = renderToStaticMarkup(
      <StatusPageView
        locale="zh"
        snapshot={snapshot}
        history={history}
        isRefreshing={false}
        errorMessage="刷新失败，显示的是上次成功数据"
      />
    );

    expect(html).toContain("刷新失败，显示的是上次成功数据");
    expect(html).toContain("Alice");
  });

  test("renders hard error state when there is no snapshot", () => {
    const html = renderToStaticMarkup(
      <StatusPageView
        locale="zh"
        snapshot={null}
        history={[]}
        isRefreshing={false}
        errorMessage="监控页面暂时无法访问"
      />
    );

    expect(html).toContain("监控页面暂时无法访问");
    expect(html).toContain("查看原监控页");
  });

  test("renders chart waiting state when history has not accumulated yet", () => {
    const html = renderToStaticMarkup(
      <StatusPageView
        locale="zh"
        snapshot={snapshot}
        history={history.slice(0, 1)}
        isRefreshing={false}
        errorMessage={null}
      />
    );

    expect(html).toContain("等待更多数据");
  });
});
