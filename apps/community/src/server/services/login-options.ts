import type { QqEnv } from "../env";
import type { RedisCommandSender } from "../middleware/rate-limit";
import { type NapcatState, readNapcatHealth } from "../napcat/health";
import { withTimeout } from "../with-timeout";

export type LoginOptions = {
  turnstileSiteKey: string;
  awmc?: { available: true };
  qq: {
    /** false 时登录页显示"QQ 登录暂不可用"（spec 第 10.3 节）。 */
    available: boolean;
    /** 用户要先加它为好友；控制台发送器没有机器人，是 null。 */
    botQq: string | null;
  };
};

export function createLoginOptions(options: {
  turnstileSiteKey: string;
  awmc?: boolean;
  qq: QqEnv;
  redis: RedisCommandSender;
  /** 读机器人状态出错、超时时调用。调用方传进来的应当已经限过频：Redis 宕掉时每次打开登录页都会出错一次。 */
  onRedisError?: (error: unknown) => void;
}): () => Promise<LoginOptions> {
  return async () => {
    const enabled = options.awmc ? { awmc: { available: true as const } } : {};
    if (options.qq.sender === "console") {
      return { ...enabled, turnstileSiteKey: options.turnstileSiteKey, qq: { available: true, botQq: null } };
    }
    let state: NapcatState | null = null;
    try {
      state = await withTimeout(readNapcatHealth(options.redis), 250);
    } catch (error) {
      options.onRedisError?.(error);
      state = null;
    }
    // 没有记录（worker 刚起来还没检查，或者 worker 停了）时当作可用：宁可让用户试一次，
    // 也不要因为缺一条状态就关掉入口。
    return {
      ...enabled,
      turnstileSiteKey: options.turnstileSiteKey,
      qq: { available: state === null || state === "online", botQq: options.qq.botQq },
    };
  };
}
