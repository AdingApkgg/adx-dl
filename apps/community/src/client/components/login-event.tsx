import { useEffect } from "react";

import { loginMarkerIn, trackEvent } from "../lib/analytics";

// 登录成功后落地的那一页：地址 # 后面带着登录方式（lib/analytics.ts 的 withLoginMarker），上报一次 login 事件，
// 再把标记从地址里去掉，刷新、复制地址都不会再记一次。根组件里挂一次。
export function LoginEvent() {
  useEffect(() => {
    const method = loginMarkerIn(window.location.hash);
    if (!method) {
      return;
    }
    // 统计脚本是 defer 的，排在 React Router 的模块脚本前面执行，hydrate 之后 tracker 已经在 window.umami 上。
    trackEvent("login", { method });
    // history.state 原样传回去：React Router 在里面记着这一页的 key。replaceState 不会让 React Router 重新导航。
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }, []);
  return null;
}
