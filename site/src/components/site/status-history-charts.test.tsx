import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StatusHistoryCharts } from "@/components/site/status-history-charts";
import type { ServerStatusHistoryPoint } from "@/lib/server-status-history";

const history: ServerStatusHistoryPoint[] = [
  {
    timestamp: 1,
    timeLabel: "07:20",
    cpuPercent: 0.27,
    memoryPercent: 16.78,
    diskPercent: 23.29,
    load1: 0.27,
    load5: 0.39,
    load15: 0.41,
    uploadSpeed: 2037,
    downloadSpeed: 1764,
  },
  {
    timestamp: 2,
    timeLabel: "07:21",
    cpuPercent: 0.31,
    memoryPercent: 16.81,
    diskPercent: 23.3,
    load1: 0.33,
    load5: 0.4,
    load15: 0.42,
    uploadSpeed: 2500,
    downloadSpeed: 1900,
  },
];

describe("status history charts", () => {
  test("renders localized chart titles and series descriptions when there are at least two points", () => {
    const html = renderToStaticMarkup(<StatusHistoryCharts locale="zh" history={history} />);

    expect(html).toContain("资源趋势");
    expect(html).toContain("网络趋势");
    expect(html).toContain("CPU、内存与磁盘占用趋势");
    expect(html).toContain("上传与下载速率趋势");
  });

  test("renders waiting state under the resource chart title when there is not enough history", () => {
    const html = renderToStaticMarkup(
      <StatusHistoryCharts locale="zh" history={history.slice(0, 1)} />
    );

    expect(html).toContain("资源趋势");
    expect(html).toContain("等待更多数据");
    expect(html).not.toContain("网络趋势");
  });
});
