import { data, Outlet, redirect } from "react-router";

import { baseLocale, isLocale } from "@/paraglide/runtime.js";

import type { Route } from "./+types/locale";

export function loader({ params, url }: Route.LoaderArgs) {
  const lang = params.lang;
  if (lang === undefined) {
    return { locale: baseLocale };
  }
  // 基础语言不加前缀（spec 第 11.1 节）。Paraglide 会把 /zh/... 也当成中文照常渲染，
  // 不在这里跳走，同一个页面就有两个地址。
  if (lang === baseLocale) {
    // 开头的斜杠（URL 解析器把 \ 也变成了 /）只留一个：/zh//evil.com 若跳到 //evil.com，
    // 浏览器会当成 https://evil.com。
    const rest = `/${url.pathname.slice(`/${baseLocale}`.length).replace(/^[/\\]+/, "")}`;
    throw redirect(`${rest}${url.search}`, 301);
  }
  // isLocale 区分大小写，所以 /EN/... 也会走到这里。
  if (!isLocale(lang)) {
    throw data(null, { status: 404 });
  }
  return { locale: lang };
}

export default function LocaleLayout() {
  return <Outlet />;
}
