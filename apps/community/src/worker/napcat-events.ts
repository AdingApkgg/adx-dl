import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

export type NapcatEventsOptions = {
  wsUrl: string;
  accessToken: string;
  log: Logger;
  /** 收到加好友申请时调用，参数是事件里的 flag。 */
  onFriendRequest(flag: string): Promise<void>;
  /** 多久没收到任何消息就断开重连。NapCat 默认 30 秒一次心跳。 */
  idleTimeoutMs?: number;
  /** 断线后第一次重连前等多久；之后每次翻倍，封顶 maxBackoffMs。 */
  initialBackoffMs?: number;
  maxBackoffMs?: number;
};

// NapCat 的正向 WebSocket（NapCat 是服务端），重连由我们自己做（调研报告第 3.4 节）。
export function startNapcatEvents(options: NapcatEventsOptions): { stop(): void; connected(): boolean } {
  const idleTimeoutMs = options.idleTimeoutMs ?? 75_000;
  const initialBackoffMs = options.initialBackoffMs ?? 1000;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;

  const url = new URL(options.wsUrl);
  // 必须连根路径（或任何不是 /api 的路径）：连 /api 收不到事件。令牌放查询参数，不要把 url 记进日志。
  url.searchParams.set("access_token", options.accessToken);

  let socket: WebSocket | null = null;
  let stopped = false;
  let backoff = initialBackoffMs;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function armIdleTimer(ws: WebSocket) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      options.log.error("napcat_ws_idle");
      ws.close();
    }, idleTimeoutMs);
  }

  async function handle(data: unknown) {
    if (typeof data !== "string") {
      return;
    }
    let event: { post_type?: unknown; request_type?: unknown; flag?: unknown };
    try {
      event = JSON.parse(data) as typeof event;
    } catch {
      return;
    }
    if (event.post_type === "request" && event.request_type === "friend" && typeof event.flag === "string") {
      // 要尽快处理：flag 对应 NapCat 内存里的待处理申请，拖久了会找不到（调研报告第 2.6 节）。
      try {
        await options.onFriendRequest(event.flag);
        options.log.info("napcat_friend_request_approved");
      } catch (error) {
        options.log.error("napcat_friend_request_failed", describeError(error));
      }
    }
  }

  function connect() {
    if (stopped) {
      return;
    }
    const ws = new WebSocket(url.href);
    socket = ws;
    ws.addEventListener("open", () => {
      backoff = initialBackoffMs;
      options.log.info("napcat_ws_connected");
      armIdleTimer(ws);
    });
    ws.addEventListener("message", (event) => {
      armIdleTimer(ws);
      void handle(event.data);
    });
    // error 之后总会有 close，重连统一在 close 里做。
    ws.addEventListener("close", () => {
      clearTimeout(idleTimer);
      if (socket === ws) {
        socket = null;
      }
      if (stopped) {
        return;
      }
      options.log.error("napcat_ws_closed", { retryInMs: backoff });
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, maxBackoffMs);
    });
  }

  connect();

  return {
    stop() {
      stopped = true;
      clearTimeout(idleTimer);
      clearTimeout(reconnectTimer);
      socket?.close();
    },
    connected: () => socket?.readyState === WebSocket.OPEN,
  };
}
