import { deLocalizeHref, localizeHref } from "@/paraglide/runtime.js";

/** 注销提示页（不带语言前缀）。 */
export const ACCOUNT_DELETION_PATH = "/account-deletion";

/**
 * 待注销的用户能看注销提示页和隐私说明；别的页面一律跳过去。返回要去的地址（当前语言的注销提示页），
 * 不用跳时返回 null。没登录的访客、正常状态的用户不受影响；已经在允许访问的页面上也不跳（不会绕圈）。
 * "退出登录"是接口调用，不是页面，不受影响。
 */
export function pendingDeletionRedirect(me: { status: string } | null | undefined, pathname: string): string | null {
  if (me?.status !== "pending_deletion") {
    return null;
  }
  const path = deLocalizeHref(pathname).replace(/\/+$/, "");
  if (path === ACCOUNT_DELETION_PATH || path === "/privacy") {
    return null;
  }
  return localizeHref(ACCOUNT_DELETION_PATH);
}
