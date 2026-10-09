import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

export type ThrottleOptions = {
  /** 两条日志之间至少隔多久，默认一分钟。 */
  intervalMs?: number;
  now?: () => number;
};

// 同一个事件在一段时间里最多记一条错误日志。Redis、Umami 这类依赖整段宕掉时每个请求都失败一次，照原样记，
// 日志会被同一行刷满，别的事件反而看不见。被压下去的次数记在下一条的 suppressed 里。错误一律经 describeError。
export function throttledErrorLog(
  log: Logger,
  event: string,
  { intervalMs = 60_000, now = Date.now }: ThrottleOptions = {}
): (error: unknown) => void {
  let lastAt: number | null = null;
  let suppressed = 0;
  return (error) => {
    const time = now();
    if (lastAt !== null && time - lastAt < intervalMs) {
      suppressed += 1;
      return;
    }
    log.error(event, { ...describeError(error), ...(suppressed > 0 ? { suppressed } : {}) });
    lastAt = time;
    suppressed = 0;
  };
}
