import type { ServerWebSocket } from "bun";

export type OneBotCall = { action: string; params: Record<string, unknown>; authorization: string | null };

type Handler = (params: Record<string, unknown>) => unknown;

// 假 NapCat：HTTP 接口按 action 分发给 handle() 注册的处理函数；正向 WebSocket 记录连接，
// 可以主动推事件或断开。响应格式照 NapCat：失败也是 HTTP 200，看 status。
export function startFakeOneBot(options: { accessToken: string }) {
  const calls: OneBotCall[] = [];
  const upgradePaths: string[] = [];
  const handlers = new Map<string, Handler>();
  const sockets = new Set<ServerWebSocket<unknown>>();
  let connections = 0;

  const server = Bun.serve({
    port: 0,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        if (url.searchParams.get("access_token") !== options.accessToken) {
          return new Response("token verify failed!", { status: 403 });
        }
        upgradePaths.push(url.pathname);
        return srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      const action = url.pathname.slice(1);
      const params = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      calls.push({ action, params, authorization: req.headers.get("authorization") });
      if (req.headers.get("authorization") !== `Bearer ${options.accessToken}`) {
        return new Response(JSON.stringify({ message: "token verify failed!" }), { status: 403 });
      }
      const handler = handlers.get(action);
      if (!handler) {
        return Response.json({ status: "failed", retcode: 1404, data: null, message: "不支持的 Api" });
      }
      try {
        return Response.json({ status: "ok", retcode: 0, data: (await handler(params)) ?? null, message: "" });
      } catch (error) {
        return Response.json({ status: "failed", retcode: 200, data: null, message: String(error) });
      }
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
        connections += 1;
      },
      close(ws) {
        sockets.delete(ws);
      },
      message() {},
    },
  });

  return {
    httpUrl: `http://127.0.0.1:${server.port}`,
    wsUrl: `ws://127.0.0.1:${server.port}`,
    calls,
    upgradePaths,
    handle(action: string, handler: Handler) {
      handlers.set(action, handler);
    },
    push(event: object) {
      for (const ws of sockets) {
        ws.send(JSON.stringify(event));
      }
    },
    dropConnections() {
      for (const ws of sockets) {
        ws.close();
      }
    },
    connections: () => connections,
    stop() {
      server.stop(true);
    },
  };
}

export async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("condition not met in time");
    }
    await Bun.sleep(10);
  }
}
