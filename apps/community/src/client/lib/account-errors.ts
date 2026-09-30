import { localizeHref } from "@/paraglide/runtime.js";

import { errorCodeOf } from "./auth-errors";
import { loginHref } from "./require-user";

/**
 * 改数据的操作出错时，先看要不要整页跳走（spec 第 11.4 节）：账号正在注销，去注销提示页；未登录，去登录页
 * （登录后回到 here）。返回要去的地址；不用跳时返回 null，由页面自己提示。
 * 我们接口的 ApiError 和 Better Auth 客户端的 { code, status } 都认。
 */
export function accountErrorRedirect(error: unknown, here: string): string | null {
  const code = errorCodeOf(error);
  if (code === "ACCOUNT_PENDING_DELETION") {
    return localizeHref("/account-deletion");
  }
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  if (code === "UNAUTHORIZED" || status === 401) {
    return loginHref(here);
  }
  return null;
}
