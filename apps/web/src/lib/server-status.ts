export const STATUS_SOURCE_URL = "https://s.saop.cc/server/66";
export const STATUS_WS_URL = "wss://s.saop.cc/api/v1/ws/server";
export const STATUS_SERVER_ID = 66;

export type ServerStatusSnapshot = {
  name: string | null;
  state: string | null;
  uptime: string | null;
  arch: string | null;
  region: string | null;
  system: string | null;
  cpuModel: string | null;
  load: string | null;
  uploadTotal: string | null;
  downloadTotal: string | null;
  bootTime: string | null;
  lastReportTime: string | null;
  cpuPercent: string | null;
  memoryPercent: string | null;
  memoryUsageText: string | null;
  swapPercent: string | null;
  swapUsageText: string | null;
  diskPercent: string | null;
  diskUsageText: string | null;
  processCount: string | null;
  uploadSpeed: string | null;
  downloadSpeed: string | null;
  tcpCount: string | null;
  udpCount: string | null;
  cpuPercentValue: number | null;
  memoryPercentValue: number | null;
  diskPercentValue: number | null;
  load1Value: number | null;
  load5Value: number | null;
  load15Value: number | null;
  uploadSpeedValue: number | null;
  downloadSpeedValue: number | null;
  fetchedAt: string;
  sourceUrl: string;
};

export class ServerStatusParseError extends Error {
  constructor(message = "Failed to parse public monitor page") {
    super(message);
    this.name = "ServerStatusParseError";
  }
}

type ServerStatusPayload = {
  now?: number;
  servers?: ServerStatusPayloadServer[];
};

type ServerStatusPayloadServer = {
  id: number;
  name?: string;
  host?: {
    platform?: string;
    cpu?: string[];
    mem_total?: number;
    disk_total?: number;
    swap_total?: number;
    arch?: string;
    boot_time?: number;
  };
  state?: {
    cpu?: number;
    mem_used?: number;
    swap_used?: number;
    disk_used?: number;
    net_in_transfer?: number;
    net_out_transfer?: number;
    net_in_speed?: number;
    net_out_speed?: number;
    uptime?: number;
    load_1?: number;
    load_5?: number;
    load_15?: number;
    tcp_conn_count?: number;
    udp_conn_count?: number;
    process_count?: number;
  };
  country_code?: string;
  last_active?: string;
};

type ServerStatusWebSocket = {
  close: () => void;
  onopen: null | (() => void);
  onmessage: null | ((event: { data: string }) => void);
  onerror: null | ((error: unknown) => void);
  onclose: null | (() => void);
};

type ServerStatusWebSocketConstructor = new (url: string) => ServerStatusWebSocket;

type FetchServerStatusOptions = {
  fetchImpl?: typeof fetch;
  webSocketImpl?: ServerStatusWebSocketConstructor;
  serverId?: number;
  timeoutMs?: number;
};

export function filterVisibleStatusLines(lines: string[]) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^0s(?:0[%M/.\dA-Za-z]+)+$/u.test(line))
    .filter((line) => !/^0s0%50%100%$/u.test(line));
}

function normalizeStatusLine(line: string) {
  return line.replace(/\s+/gu, " ").trim();
}

function trimTrailingZeros(value: string) {
  return value.replace(/\.?0+$/u, "");
}

function formatDecimal(value: number, digits = 2) {
  return trimTrailingZeros(value.toFixed(digits));
}

function formatBinaryBytes(
  value: number | null | undefined,
  units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
) {
  if (value == null || Number.isNaN(value) || value < 0) {
    return null;
  }

  if (value < 1024) {
    return `${Math.round(value)} ${units[0]}`;
  }

  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount.toFixed(2)} ${units[unitIndex]}`;
}

function formatTransferSpeed(value: number | null | undefined) {
  return formatBinaryBytes(value, ["B/s", "K/s", "M/s", "G/s", "T/s", "P/s"]);
}

function formatPercent(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  return `${formatDecimal(value, digits)}%`;
}

function formatRoundedPercent(used: number | null | undefined, total: number | null | undefined) {
  if (used == null || total == null || total <= 0) {
    return null;
  }

  return `${Math.round((used / total) * 100)}%`;
}

function formatLocalDate(date: Date) {
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const seconds = `${date.getSeconds()}`.padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatIsoDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const directMatch = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/u);
  if (directMatch) {
    return `${directMatch[1]} ${directMatch[2]}`;
  }

  return formatLocalDate(new Date(value));
}

function formatUnixDate(seconds: number | null | undefined) {
  if (seconds == null || Number.isNaN(seconds)) {
    return null;
  }

  return formatLocalDate(new Date(seconds * 1000));
}

function formatUptime(seconds: number | null | undefined) {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) {
    return null;
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }

  if (minutes > 0) {
    return `${minutes} 分钟`;
  }

  return `${Math.floor(seconds)} 秒`;
}

function collectTextNodeLines(node: ParentNode | ChildNode, lines: string[]) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      const text = normalizeStatusLine(child.textContent ?? "");
      if (text) {
        lines.push(text);
      }
      continue;
    }

    if (child.nodeType === 1) {
      collectTextNodeLines(child, lines);
    }
  }
}

function decodeHtmlEntities(html: string) {
  return html
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function extractVisibleStatusLinesFromHtml(html: string) {
  const text = decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/giu, "\n")
    .replace(/<style[\s\S]*?<\/style>/giu, "\n")
    .replace(/<!--[\s\S]*?-->/gu, "\n")
    .replace(/<[^>]+>/gu, "\n");
  return filterVisibleStatusLines(text.split(/\n+/u).map(normalizeStatusLine));
}

function extractVisibleStatusLines(document: Document) {
  const lines: string[] = [];
  collectTextNodeLines(document.body, lines);

  if (lines.length > 0) {
    return filterVisibleStatusLines(lines);
  }

  const fallbackLines = document.body.textContent?.split(/\n+/u).map(normalizeStatusLine) ?? [];
  return filterVisibleStatusLines(fallbackLines);
}

function pickValueAfter(lines: string[], label: string, matcher?: (line: string) => boolean) {
  let fallback: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== label) {
      continue;
    }

    const candidates = lines.slice(index + 1, index + 4).filter((line) => line !== label);
    if (!matcher) {
      return candidates[0] ?? null;
    }

    const matched = candidates.find(matcher);
    if (matched) {
      return matched;
    }

    fallback ??= candidates[0] ?? null;
  }

  return fallback;
}

function extractName(lines: string[]) {
  const excluded = new Set([
    "iMonitor",
    "哪吒监控",
    "概览",
    "当前时间",
    "详情",
    "网络",
  ]);

  return lines.find((line) => !excluded.has(line)) ?? null;
}

function findServerById(payload: ServerStatusPayload, serverId: number) {
  return payload.servers?.find((server) => server.id === serverId) ?? null;
}

export function parseServerStatusPayload(
  payload: ServerStatusPayload,
  serverId = STATUS_SERVER_ID
): ServerStatusSnapshot {
  const server = findServerById(payload, serverId);
  if (!server) {
    throw new ServerStatusParseError(`Server ${serverId} not found in public websocket payload`);
  }

  const memTotal = server.host?.mem_total ?? null;
  const memUsed = server.state?.mem_used ?? null;
  const swapTotal = server.host?.swap_total ?? null;
  const swapUsed = server.state?.swap_used ?? null;
  const diskTotal = server.host?.disk_total ?? null;
  const diskUsed = server.state?.disk_used ?? null;
  const loadValues = [server.state?.load_1, server.state?.load_5, server.state?.load_15].filter(
    (value): value is number => typeof value === "number" && !Number.isNaN(value)
  );
  const isOnline =
    !!server.last_active &&
    !server.last_active.startsWith("0001-01-01") &&
    !!server.state &&
    Object.keys(server.state).length > 0;

  return {
    name: server.name ?? null,
    state: isOnline ? "在线" : "离线",
    uptime: formatUptime(server.state?.uptime),
    arch: server.host?.arch ?? null,
    region: server.country_code?.toUpperCase() ?? null,
    system: server.host?.platform ?? null,
    cpuModel: server.host?.cpu?.[0] ?? null,
    load: loadValues.length === 3 ? loadValues.map((value) => value.toFixed(2)).join(" / ") : null,
    uploadTotal: formatBinaryBytes(server.state?.net_out_transfer, ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]),
    downloadTotal: formatBinaryBytes(server.state?.net_in_transfer, ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]),
    bootTime: formatUnixDate(server.host?.boot_time),
    lastReportTime: formatIsoDate(server.last_active),
    cpuPercent: formatPercent(server.state?.cpu),
    memoryPercent: formatRoundedPercent(memUsed, memTotal),
    memoryUsageText:
      memUsed != null && memTotal != null
        ? `${formatBinaryBytes(memUsed) ?? "0 B"} / ${formatBinaryBytes(memTotal) ?? "0 B"}`
        : null,
    swapPercent:
      swapTotal && swapTotal > 0 ? formatRoundedPercent(swapUsed ?? 0, swapTotal) : "0%",
    swapUsageText:
      swapTotal && swapTotal > 0
        ? `${formatBinaryBytes(swapUsed ?? 0) ?? "0 B"} / ${formatBinaryBytes(swapTotal) ?? "0 B"}`
        : "no swap",
    diskPercent: formatRoundedPercent(diskUsed, diskTotal),
    diskUsageText:
      diskUsed != null && diskTotal != null
        ? `${formatBinaryBytes(diskUsed) ?? "0 B"} / ${formatBinaryBytes(diskTotal) ?? "0 B"}`
        : null,
    processCount:
      typeof server.state?.process_count === "number" ? `${server.state.process_count}` : null,
    uploadSpeed: formatTransferSpeed(server.state?.net_out_speed),
    downloadSpeed: formatTransferSpeed(server.state?.net_in_speed),
    tcpCount: typeof server.state?.tcp_conn_count === "number" ? `${server.state.tcp_conn_count}` : null,
    udpCount: typeof server.state?.udp_conn_count === "number" ? `${server.state.udp_conn_count}` : null,
    cpuPercentValue: server.state?.cpu ?? null,
    memoryPercentValue:
      memUsed != null && memTotal != null && memTotal > 0 ? (memUsed / memTotal) * 100 : null,
    diskPercentValue:
      diskUsed != null && diskTotal != null && diskTotal > 0 ? (diskUsed / diskTotal) * 100 : null,
    load1Value: server.state?.load_1 ?? null,
    load5Value: server.state?.load_5 ?? null,
    load15Value: server.state?.load_15 ?? null,
    uploadSpeedValue: server.state?.net_out_speed ?? null,
    downloadSpeedValue: server.state?.net_in_speed ?? null,
    fetchedAt: formatLocalDate(new Date(payload.now ?? Date.now())) ?? new Date().toISOString(),
    sourceUrl: STATUS_SOURCE_URL,
  };
}

export function parseServerStatusHtml(html: string): ServerStatusSnapshot {
  const lines =
    typeof DOMParser === "function"
      ? extractVisibleStatusLines(new DOMParser().parseFromString(html, "text/html"))
      : extractVisibleStatusLinesFromHtml(html);

  const snapshot: ServerStatusSnapshot = {
    name: extractName(lines),
    state: pickValueAfter(lines, "状态"),
    uptime: pickValueAfter(lines, "运行时间"),
    arch: pickValueAfter(lines, "架构"),
    region: pickValueAfter(lines, "区域"),
    system: pickValueAfter(lines, "系统"),
    cpuModel: pickValueAfter(lines, "CPU", (line) => !line.includes("%")),
    load: pickValueAfter(lines, "Load"),
    uploadTotal: pickValueAfter(lines, "上传", (line) => /GiB|MiB|TiB/u.test(line)),
    downloadTotal: pickValueAfter(lines, "下载", (line) => /GiB|MiB|TiB/u.test(line)),
    bootTime: pickValueAfter(lines, "启动时间"),
    lastReportTime: pickValueAfter(lines, "最后上报时间"),
    cpuPercent: pickValueAfter(lines, "CPU", (line) => line.includes("%")),
    memoryPercent: pickValueAfter(lines, "内存", (line) => line.includes("%")),
    memoryUsageText: pickValueAfter(lines, "内存", (line) => line.includes("/")),
    swapPercent: pickValueAfter(lines, "虚拟内存", (line) => line.includes("%")),
    swapUsageText: pickValueAfter(lines, "虚拟内存", (line) => line === "no swap" || line.includes("/")),
    diskPercent: pickValueAfter(lines, "磁盘", (line) => line.includes("%")),
    diskUsageText: pickValueAfter(lines, "磁盘", (line) => line.includes("/")),
    processCount: pickValueAfter(lines, "进程数"),
    uploadSpeed: pickValueAfter(lines, "上传", (line) => /\/s$/u.test(line)),
    downloadSpeed: pickValueAfter(lines, "下载", (line) => /\/s$/u.test(line)),
    tcpCount: pickValueAfter(lines, "TCP"),
    udpCount: pickValueAfter(lines, "UDP"),
    cpuPercentValue: null,
    memoryPercentValue: null,
    diskPercentValue: null,
    load1Value: null,
    load5Value: null,
    load15Value: null,
    uploadSpeedValue: null,
    downloadSpeedValue: null,
    fetchedAt: new Date().toISOString(),
    sourceUrl: STATUS_SOURCE_URL,
  };

  if (!snapshot.state || !snapshot.cpuPercent || !snapshot.memoryUsageText || !snapshot.lastReportTime) {
    throw new ServerStatusParseError();
  }

  return snapshot;
}

async function fetchServerStatusFromWebSocket({
  webSocketImpl,
  serverId,
  timeoutMs,
}: {
  webSocketImpl: ServerStatusWebSocketConstructor;
  serverId: number;
  timeoutMs: number;
}) {
  return await new Promise<ServerStatusSnapshot>((resolve, reject) => {
    let settled = false;
    const socket = new webSocketImpl(STATUS_WS_URL);

    const cleanup = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      try {
        socket.close();
      } catch {
        // Ignore close errors from browser implementations that race after resolution.
      }
    };

    const resolveWith = (value: ServerStatusSnapshot) => {
      cleanup();
      resolve(value);
    };

    const rejectWith = (error: Error) => {
      cleanup();
      reject(error);
    };

    const timeoutId = setTimeout(() => {
      rejectWith(new Error("Monitor websocket timed out"));
    }, timeoutMs);

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as ServerStatusPayload;
        if (!findServerById(payload, serverId)) {
          return;
        }

        resolveWith(parseServerStatusPayload(payload, serverId));
      } catch (error) {
        rejectWith(
          error instanceof Error ? error : new ServerStatusParseError("Invalid websocket payload")
        );
      }
    };

    socket.onerror = () => {
      if (!settled) {
        rejectWith(new Error("Monitor websocket request failed"));
      }
    };

    socket.onclose = () => {
      if (!settled) {
        rejectWith(new Error("Monitor websocket closed before receiving status data"));
      }
    };
  });
}

export async function fetchServerStatus({
  fetchImpl = fetch,
  webSocketImpl = globalThis.WebSocket as ServerStatusWebSocketConstructor | undefined,
  serverId = STATUS_SERVER_ID,
  timeoutMs = 5_000,
}: FetchServerStatusOptions = {}) {
  if (typeof webSocketImpl === "function") {
    try {
      return await fetchServerStatusFromWebSocket({
        webSocketImpl,
        serverId,
        timeoutMs,
      });
    } catch {
      // Fall back to HTML parsing for environments where the public websocket is unavailable.
    }
  }

  const response = await fetchImpl(STATUS_SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Monitor request failed: ${response.status}`);
  }

  const html = await response.text();
  return parseServerStatusHtml(html);
}
