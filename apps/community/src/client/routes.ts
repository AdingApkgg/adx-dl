import { index, type RouteConfig, route } from "@react-router/dev/routes";

// :lang? 可选段：/ 是中文，/en、/ja 是对应语言。静态路由都挂在它下面；
// 静态段比动态段优先，所以 /login 不会被当成 lang=login。
export default [
  route(":lang?", "routes/locale.tsx", [
    index("routes/home.tsx"),
    route("login", "routes/login.tsx"),
    route("privacy", "routes/privacy.tsx"),
    route("onboarding", "routes/onboarding.tsx"),
    route("settings/account", "routes/settings-account.tsx"),
    route("settings/profile", "routes/settings-profile.tsx"),
    route("charts", "routes/public-charts.tsx"),
    route("charts/:id", "routes/public-chart-detail.tsx"),
    route("me/charts", "routes/charts.tsx"),
    route("me/charts/new", "routes/chart-new.tsx"),
    route("me/charts/:id", "routes/chart-detail.tsx"),
    route("u/:id", "routes/user-profile.tsx"),
    route("account-deletion", "routes/account-deletion.tsx"),
    route("*", "routes/not-found.tsx"),
  ]),
] satisfies RouteConfig;
