import { index, type RouteConfig, route } from "@react-router/dev/routes";

// :lang? 可选段：/ 是中文，/en、/ja 是对应语言。静态路由都挂在它下面；
// 静态段比动态段优先，所以 /login 不会被当成 lang=login。
export default [
  route(":lang?", "routes/locale.tsx", [
    index("routes/home.tsx"),
    route("login", "routes/login.tsx"),
    route("forum", "routes/forum.tsx"),
    route("forum/new", "routes/forum-new.tsx"),
    route("forum/:id", "routes/forum-topic.tsx"),
    route("notices", "routes/notices.tsx"),
    route("help/:topic?", "routes/help.tsx"),
    route("me/discussions", "routes/my-discussions.tsx"),
    route("me/notifications", "routes/notifications.tsx"),
    route("me/following", "routes/following.tsx"),
    route("me/feed", "routes/following-feed.tsx"),
    route("privacy", "routes/privacy.tsx"),
    route("onboarding", "routes/onboarding.tsx"),
    route("settings/account", "routes/settings-account.tsx"),
    route("settings/profile", "routes/settings-profile.tsx"),
    route("charts", "routes/public-charts.tsx"),
    route("charts/:id", "routes/public-chart-detail.tsx"),
    route("me/favorites", "routes/favorites.tsx"),
    route("me/reports", "routes/my-reports.tsx"),
    route("me/charts", "routes/charts.tsx"),
    route("me/charts/new", "routes/chart-new.tsx"),
    route("me/charts/:id", "routes/chart-detail.tsx"),
    route("u/:id", "routes/user-profile.tsx"),
    route("dash", "routes/dash.tsx", [
      index("routes/dash-overview.tsx"),
      route("users", "routes/dash-users.tsx"),
      route("charts", "routes/dash-charts.tsx"),
      route("status", "routes/dash-status.tsx"),
      route("discussions", "routes/dash-discussions.tsx"),
      route("featured", "routes/dash-featured.tsx"),
      route("notices", "routes/dash-notices.tsx"),
      route("reports", "routes/dash-reports.tsx"),
    ]),
    route("account-deletion", "routes/account-deletion.tsx"),
    route("*", "routes/not-found.tsx"),
  ]),
] satisfies RouteConfig;
