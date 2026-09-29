import { index, type RouteConfig, route } from "@react-router/dev/routes";

// :lang? 可选段：/ 是中文，/en、/ja 是对应语言。静态路由都挂在它下面；
// 静态段比动态段优先，所以 /login 不会被当成 lang=login。
export default [
  route(":lang?", "routes/locale.tsx", [
    index("routes/home.tsx"),
    route("login", "routes/login.tsx"),
    route("*", "routes/not-found.tsx"),
  ]),
] satisfies RouteConfig;
