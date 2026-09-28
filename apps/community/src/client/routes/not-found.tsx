import { data } from "react-router";

// 兜底路由：完全匹配不上的地址，React Router 不执行中间件和任何 loader，404 页就拿不到
// 语言（永远是中文）和请求 ID。有了它，根路由照常执行，这里再抛 404 交给根错误边界渲染。
export function loader() {
  throw data(null, { status: 404 });
}

export default function NotFound() {
  return null;
}
