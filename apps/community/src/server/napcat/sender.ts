import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";
import { normalizeNickname } from "@/shared/nickname";

import { type QqSender, qqCodeMessage } from "../auth/qq/sender";
import type { OneBotClient } from "./client";

export function createNapcatSender(client: OneBotClient, log: Logger): QqSender {
  return {
    async sendCode(qq, code, locale) {
      // 对方还没通过好友申请时，NapCat 要等到超时才失败（调研报告第 2.2 节），所以给个上限。
      // QQ 插件在后台调它，发码接口不等结果。
      await client.sendPrivateMsg(qq, qqCodeMessage(code, locale), { timeoutMs: 10_000 });
    },
    async lookupNickname(qq) {
      try {
        const { nickname } = await client.getStrangerInfo(qq, { timeoutMs: 3000 });
        return normalizeNickname(nickname) || null;
      } catch (error) {
        log.error("napcat_lookup_failed", describeError(error));
        return null;
      }
    },
  };
}
