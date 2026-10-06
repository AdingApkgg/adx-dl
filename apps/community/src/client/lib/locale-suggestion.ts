import { isLocale, type Locale } from "@/paraglide/runtime.js";

/**
 * 用户点过"不用了"，或者用页头的语言切换（或提示条里的"切换"）自己选过语言，就记在这个 localStorage 键里，
 * 以后不再提示（spec 第 7.2 节）。
 */
export const LOCALE_PROMPT_STORAGE_KEY = "astrodx-locale-prompt";

/** navigator.languages 里第一个主语言是站点语言（zh、en、ja）的；都不是时是 null。zh-TW 也算 zh。 */
export function preferredLocale(languages: readonly string[]): Locale | null {
  for (const tag of languages) {
    const primary = tag.split("-")[0]?.toLowerCase() ?? "";
    if (isLocale(primary)) {
      return primary;
    }
  }
  return null;
}

/** 要提示切换到哪种语言：浏览器偏好的站点语言和当前页面不一样，用户也没关过提示。不用提示时是 null。 */
export function suggestedLocale({
  languages,
  current,
  dismissed,
}: {
  languages: readonly string[];
  current: Locale;
  dismissed: boolean;
}): Locale | null {
  if (dismissed) {
    return null;
  }
  const preferred = preferredLocale(languages);
  return preferred !== null && preferred !== current ? preferred : null;
}

/** 浏览器里读：用户关过提示没有。localStorage 用不了（隐私模式、禁用了存储）时当作关过，免得每个页面都提示。 */
export function localePromptDismissed(): boolean {
  try {
    return window.localStorage.getItem(LOCALE_PROMPT_STORAGE_KEY) !== null;
  } catch {
    return true;
  }
}

/** 记下"不再提示"。 */
export function dismissLocalePrompt(): void {
  try {
    window.localStorage.setItem(LOCALE_PROMPT_STORAGE_KEY, "dismissed");
  } catch {
    // 存不了就算了：这次会话里提示条已经关掉。
  }
}
