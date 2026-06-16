import { describe, expect, test } from "bun:test";

import {
  fetchServerStatus,
  filterVisibleStatusLines,
  parseServerStatusHtml,
  parseServerStatusPayload,
  ServerStatusParseError,
} from "@/lib/server-status";

const sampleHtml = `
  <main>
    <div>Alice</div>
    <div>状态</div><div>在线</div>
    <div>运行时间</div><div>4 天 14 小时</div>
    <div>架构</div><div>x86_64</div>
    <div>区域</div><div>SG</div>
    <div>系统</div><div>debian</div>
    <div>CPU</div><div>AMD EPYC 9755 128-Core Processor 128 Virtual Core</div>
    <div>Load</div><div>0.22 / 0.25 / 0.47</div>
    <div>上传</div><div>10.73 GiB</div>
    <div>下载</div><div>31.98 GiB</div>
    <div>启动时间</div><div>2026-06-08 06:59:09</div>
    <div>最后上报时间</div><div>2026-06-12 21:53:53</div>
    <section>
      <div>CPU</div><div>0.11%</div><div>0.11385775371323588</div>
      <div>内存</div><div>17%</div><div>66.06 GiB / 393.42 GiB</div>
      <div>虚拟内存</div><div>0%</div><div>no swap</div>
      <div>磁盘</div><div>23%</div><div>458.22 GiB / 1.92 TiB</div>
      <div>进程数</div><div>1393</div>
      <div>上传</div><div>3.42K/s</div>
      <div>下载</div><div>2.16K/s</div>
      <div>TCP</div><div>198</div>
      <div>UDP</div><div>20</div>
      <div>0s0%50%100%</div>
    </section>
  </main>
`;

const samplePayload = {
  now: 1781305164000,
  online: 3,
  servers: [
    {
      id: 66,
      name: "Alice",
      host: {
        platform: "debian",
        cpu: ["AMD EPYC 9755 128-Core Processor 128 Virtual Core"],
        mem_total: 422429560832,
        disk_total: 2112617857024,
        arch: "x86_64",
        virtualization: "kvm",
        boot_time: 1780901949,
      },
      state: {
        cpu: 0.26812364236461705,
        mem_used: 70844096512,
        disk_used: 491938463744,
        net_in_transfer: 34424954488,
        net_out_transfer: 11653720241,
        net_in_speed: 1764,
        net_out_speed: 2037,
        uptime: 403206,
        load_1: 0.27,
        load_5: 0.39,
        load_15: 0.41,
        tcp_conn_count: 184,
        udp_conn_count: 20,
        process_count: 1415,
      },
      country_code: "sg",
      last_active: "2026-06-13T06:59:22.030598513+08:00",
    },
  ],
};

describe("server status parser", () => {
  test("filters empty and axis-only lines", () => {
    expect(filterVisibleStatusLines(["", "CPU", "0s0%50%100%", "内存"])).toEqual([
      "CPU",
      "内存",
    ]);
  });

  test("parses key overview and metric fields from monitor html", () => {
    const snapshot = parseServerStatusHtml(sampleHtml);

    expect(snapshot.name).toBe("Alice");
    expect(snapshot.state).toBe("在线");
    expect(snapshot.cpuPercent).toBe("0.11%");
    expect(snapshot.memoryUsageText).toBe("66.06 GiB / 393.42 GiB");
    expect(snapshot.diskUsageText).toBe("458.22 GiB / 1.92 TiB");
    expect(snapshot.tcpCount).toBe("198");
    expect(snapshot.sourceUrl).toBe("https://s.saop.cc/server/66");
  });

  test("parses key overview and metric fields from public websocket payload", () => {
    const snapshot = parseServerStatusPayload(samplePayload);

    expect(snapshot.name).toBe("Alice");
    expect(snapshot.state).toBe("在线");
    expect(snapshot.cpuPercent).toBe("0.27%");
    expect(snapshot.memoryUsageText).toBe("65.98 GiB / 393.42 GiB");
    expect(snapshot.diskUsageText).toBe("458.15 GiB / 1.92 TiB");
    expect(snapshot.uploadTotal).toBe("10.85 GiB");
    expect(snapshot.downloadTotal).toBe("32.06 GiB");
    expect(snapshot.load).toBe("0.27 / 0.39 / 0.41");
    expect(snapshot.tcpCount).toBe("184");
    expect(snapshot.cpuPercentValue).toBeCloseTo(0.27, 2);
    expect(snapshot.memoryPercentValue).toBeCloseTo(16.77, 2);
    expect(snapshot.diskPercentValue).toBeCloseTo(23.29, 2);
    expect(snapshot.load1Value).toBe(0.27);
    expect(snapshot.load5Value).toBe(0.39);
    expect(snapshot.load15Value).toBe(0.41);
    expect(snapshot.uploadSpeedValue).toBe(2037);
    expect(snapshot.downloadSpeedValue).toBe(1764);
    expect(snapshot.sourceUrl).toBe("https://s.saop.cc/server/66");
  });

  test("fetchServerStatus prefers websocket data when available", async () => {
    class MockWebSocket {
      onopen: null | (() => void) = null;
      onmessage: null | ((event: { data: string }) => void) = null;
      onerror: null | ((error: unknown) => void) = null;
      onclose: null | (() => void) = null;

      constructor(public readonly url: string) {
        setTimeout(() => {
          this.onopen?.();
          this.onmessage?.({ data: JSON.stringify(samplePayload) });
        }, 0);
      }

      close() {
        this.onclose?.();
      }
    }

    const snapshot = await fetchServerStatus({
      fetchImpl: (async () => {
        throw new Error("html fallback should not run");
      }) as unknown as typeof fetch,
      webSocketImpl: MockWebSocket,
    });

    expect(snapshot.name).toBe("Alice");
    expect(snapshot.downloadTotal).toBe("32.06 GiB");
  });

  test("throws parse error when core labels are missing", () => {
    expect(() => parseServerStatusHtml("<main><div>empty</div></main>")).toThrow(
      ServerStatusParseError
    );
  });
});
