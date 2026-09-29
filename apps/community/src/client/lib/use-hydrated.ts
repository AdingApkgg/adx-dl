import { useEffect, useState } from "react";

// 首次渲染（服务端和浏览器里 hydrate 的那一次）返回 false，之后返回 true。
// 日期、国家名这类依赖时区和 ICU 版本的文字等到 true 再显示，服务端和浏览器渲染出的文字才一致。
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
