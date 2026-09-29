import type { QqEnv } from "../env";
import type { RedisCommandSender } from "../middleware/rate-limit";
import { type NapcatState, readNapcatHealth } from "../napcat/health";
import { withTimeout } from "../with-timeout";

export type LoginOptions = {
  turnstileSiteKey: string;
  qq: {
    /** false 时登录页显示"QQ 登录暂不可用"（spec 第 10.3 节）。 */
    available: boolean;
    /** 用户要先加它为好友；控制台发送器没有机器人，是 null。 */
    botQq: string | null;
  };
};

export function createLoginOptions(options: {
  turnstileSiteKey: string;
  qq: QqEnv;
  redis: RedisCommandSender;
}): () => Promise<LoginOptions> {
  return async () => {
    if (options.qq.sender === "console") {
      return { turnstileSiteKey: options.turnstileSiteKey, qq: { available: true, botQq: null } };
    }
    let state: NapcatState | null = null;
    try {
      state = await withTimeout(readNapcatHealth(options.redis), 250);
    } catch {
      state = null;
    }
    // 没有记录（worker 刚起来还没检查，或者 worker 停了）时当作可用：宁可让用户试一次，
    // 也不要因为缺一条状态就关掉入口。
    return {
      turnstileSiteKey: options.turnstileSiteKey,
      qq: { available: state === null || state === "online", botQq: options.qq.botQq },
    };
  };
}
