// Umami 统计的自定义事件（spec 第 11.6 节）。只有两个：login（带登录方式）和 onboarding_done，
// 不带用户 id，也不带任何个人信息。页面浏览由统计脚本自己记（根组件里的 <script>，没开统计时不放）。

export type LoginMethod = "google" | "qq" | "passkey";

type Tracker = { track(event: string, data?: Record<string, string>): unknown };

export function trackEvent(event: "login", data: { method: LoginMethod }): void;
export function trackEvent(event: "onboarding_done"): void;
export function trackEvent(event: string, data?: Record<string, string>): void {
  try {
    // 统计脚本加载后把 tracker 放在 window.umami 上。没开统计、被拦截插件挡掉时没有它。
    (globalThis as { umami?: Tracker }).umami?.track(event, data);
  } catch {
    // 统计出错不能影响页面。
  }
}

// 登录成功以后一律整页跳转（Google 是从 Google 跳回来），统计脚本跟着新页面重新加载。所以登录方式记在新地址的
// # 后面，新页面加载后由 LoginEvent 组件读出来、上报、再从地址里去掉。# 后面的内容不发给服务器，
// 统计脚本也设了不记它（data-exclude-hash）。
const LOGIN_MARKER = /^#login=(google|qq|passkey)$/;

export function withLoginMarker(href: string, method: LoginMethod): string {
  return `${href.split("#")[0]}#login=${method}`;
}

export function loginMarkerIn(hash: string): LoginMethod | null {
  const method = LOGIN_MARKER.exec(hash)?.[1];
  return method === "google" || method === "qq" || method === "passkey" ? method : null;
}
