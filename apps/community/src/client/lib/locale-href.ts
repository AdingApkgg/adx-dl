import { deLocalizeHref, type Locale, localizeHref } from "@/paraglide/runtime.js";

/**
 * 同一个页面（路径加查询串）在某种语言下的地址：先去掉现有的语言前缀，再按目标语言加上（spec 第 7.2 节）。
 * 页头的语言切换和语言不一致提示的"切换"都用它。//evil.com/x 这样的路径也只得到本站的路径（/x）。
 */
export function localeHref(pathAndSearch: string, locale: Locale): string {
  return localizeHref(deLocalizeHref(pathAndSearch), { locale });
}
