import { redirect, type RouterContextProvider } from "react-router";

import { localizeHref } from "@/paraglide/runtime.js";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { meQuery } from "../queries/me";
import { type LoginMethod, withLoginMarker } from "./analytics";

/** 登录页的地址（当前语言），登录后回到 next。 */
export function loginHref(next: string, extra: Record<string, string> = {}): string {
  return `${localizeHref("/login")}?${new URLSearchParams({ next, ...extra })}`;
}

/** 新用户登录后去的地方：首次登录引导页（spec 第 10.3 节），看完回到 next。 */
export function onboardingHref(next: string): string {
  return `${localizeHref("/onboarding")}?${new URLSearchParams({ next })}`;
}

/** 登录成功后整页跳转的地址：新用户先去引导页。# 后面带上登录方式，新页面加载后上报统计的 login 事件。 */
export function signedInHref(next: string, method: LoginMethod, isNewUser: boolean): string {
  return withLoginMarker(isNewUser ? onboardingHref(next) : next, method);
}

/** 发起第三方登录时交给 Better Auth 的三个回跳地址。出错回登录页不带登录成功标记。 */
export function googleRedirects(next: string, reauth: boolean, method: "google" | "awmc" = "google") {
  return {
    callbackURL: signedInHref(next, method, false),
    newUserCallbackURL: signedInHref(next, method, true),
    // 要带着 next 和 reauth：否则用户再登录会落到首页而不是原来要去的页面；"重新登录"的用户已登录，
    // 少了 reauth=1，loader 会直接把他跳走，错误提示也就看不到了。
    errorCallbackURL: loginHref(next, reauth ? { reauth: "1" } : {}),
  };
}

// 需要登录的页面在 loader 里调用（spec 第 11.4 节：未登录跳到 /login?next=<原地址>）。
// 取到的当前用户留在本次请求的 QueryClient 里，页面 dehydrate 时一并带给浏览器。
export async function requireUser(context: Readonly<RouterContextProvider>, url: URL) {
  const me = await context.get(queryClientContext).query(meQuery(context.get(apiContext)));
  if (!me) {
    throw redirect(loginHref(`${url.pathname}${url.search}`));
  }
  return me;
}
