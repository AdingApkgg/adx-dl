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
    // tracker 尚未就绪时，trackEvent 等统计脚本 load 后补报；登录标记仍立即清除。
    trackEvent("login", { method });
    // history.state 原样传回去：React Router 在里面记着这一页的 key。replaceState 不会让 React Router 重新导航。
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }, []);
  return null;
}
