type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class OneBotError extends Error {
  constructor(
    readonly action: string,
    readonly retcode: number | null,
    detail: string
  ) {
    // 不带 NapCat 返回的 message：里面可能有 QQ 号，而错误会被记进日志。
    super(`onebot ${action} failed: ${detail}`);
    this.name = "OneBotError";
  }
}

type CallOptions = { timeoutMs?: number };

export type OneBotClient = {
  call<T>(action: string, params: Record<string, unknown>, options?: CallOptions): Promise<T>;
  sendPrivateMsg(userId: string, message: string, options?: CallOptions): Promise<void>;
  getStrangerInfo(userId: string, options?: CallOptions): Promise<{ nickname: string }>;
  getStatus(options?: CallOptions): Promise<{ online: boolean; good: boolean }>;
  setFriendAddRequest(flag: string, approve: boolean): Promise<void>;
};

// OneBot 11 的 HTTP 接口：POST JSON 到 <httpUrl>/<action>（调研报告第 2 节）。
export function createOneBotClient(options: { httpUrl: string; accessToken: string; fetch?: FetchLike }): OneBotClient {
  const base = options.httpUrl.replace(/\/+$/, "");
  const send: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  async function call<T>(action: string, params: Record<string, unknown>, callOptions: CallOptions = {}): Promise<T> {
    const res = await send(`${base}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.accessToken}` },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(callOptions.timeoutMs ?? 5000),
    });
    if (!res.ok) {
      throw new OneBotError(action, null, `HTTP ${res.status}`);
    }
    const body = (await res.json()) as { status?: unknown; retcode?: unknown; data?: unknown };
    // 几乎所有业务失败都是 HTTP 200，只能看 status。
    if (body.status !== "ok") {
      throw new OneBotError(action, typeof body.retcode === "number" ? body.retcode : null, `status ${String(body.status)}`);
    }
    return body.data as T;
  }

  return {
    call,
    async sendPrivateMsg(userId, message, callOptions) {
      await call("send_private_msg", { user_id: userId, message }, callOptions);
    },
    async getStrangerInfo(userId, callOptions) {
      const data = await call<{ nickname?: unknown }>("get_stranger_info", { user_id: userId }, callOptions);
      return { nickname: typeof data?.nickname === "string" ? data.nickname : "" };
    },
    async getStatus(callOptions) {
      const data = await call<{ online?: unknown; good?: unknown }>("get_status", {}, callOptions);
      return { online: data?.online === true, good: data?.good === true };
    },
    async setFriendAddRequest(flag, approve) {
      await call("set_friend_add_request", { flag, approve });
    },
  };
}
