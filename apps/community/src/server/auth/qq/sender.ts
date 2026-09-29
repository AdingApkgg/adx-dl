import { m } from "@/paraglide/messages.js";
import type { Locale } from "@/paraglide/runtime.js";

export type QqSender = {
  /** 私聊发验证码。消息按发起请求时的页面语言（spec 第 10.3 节）。 */
  sendCode(qq: string, code: string, locale: Locale): Promise<void>;
  /** 查 QQ 昵称，查不到或超时返回 null。 */
  lookupNickname(qq: string): Promise<string | null>;
};

export function qqCodeMessage(code: string, locale: Locale): string {
  return m.qq_code_message({ code }, { locale });
}

// 本机开发用（spec 第 9.6 节）。生产环境 parseEnv 拒绝 QQ_SENDER=console。
// 故意直接打印、不走 JSON 日志：日志里不许出现 QQ 号和验证码。
export function createConsoleSender(write: (line: string) => void = (line) => console.log(line)): QqSender {
  return {
    async sendCode(qq, code, locale) {
      write(`[QQ 控制台发送器] 发给 ${qq}：${qqCodeMessage(code, locale)}`);
    },
    async lookupNickname() {
      return null;
    },
  };
}

/** 设置页显示的打码 QQ 号，如 12****89（spec 第 10.4 节）。 */
export function maskQq(qq: string): string {
  return `${qq.slice(0, 2)}****${qq.slice(-2)}`;
}
