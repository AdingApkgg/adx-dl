import { Button } from "@astrodx/ui/components/button";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";

import { m } from "@/paraglide/messages.js";
import { deLocalizeHref, getLocale, type Locale, localizeHref } from "@/paraglide/runtime.js";
import { htmlLang } from "@/shared/i18n/locale";

import { dismissLocalePrompt, localePromptDismissed, suggestedLocale } from "../lib/locale-suggestion";

// 浏览器语言和当前页面的语言不一致时，在页头下面提示切换（spec 第 7.2 节）。只在浏览器里、页面加载完以后判断：
// 服务端不看浏览器语言（spec 第 11.1 节），首次渲染什么都不输出，hydrate 前后一致。
// 提示用要切换到的那种语言写：看到它的人更习惯那种语言。
export function LocaleSuggestion() {
  const location = useLocation();
  const [target, setTarget] = useState<Locale | null>(null);

  useEffect(() => {
    setTarget(suggestedLocale({ languages: navigator.languages, current: getLocale(), dismissed: localePromptDismissed() }));
  }, []);

  if (target === null) {
    return null;
  }
  const lang = htmlLang(target);
  const href = localizeHref(deLocalizeHref(`${location.pathname}${location.search}`), { locale: target });
  return (
    <div role="status" lang={lang} className="border-b bg-muted/60">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 text-sm">
        <p className="mr-auto">{m.locale_suggestion({}, { locale: target })}</p>
        <Button asChild size="sm">
          <a href={href} hrefLang={lang} onClick={dismissLocalePrompt}>
            {m.locale_suggestion_switch({}, { locale: target })}
          </a>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            dismissLocalePrompt();
            setTarget(null);
          }}
        >
          {m.locale_suggestion_dismiss({}, { locale: target })}
        </Button>
      </div>
    </div>
  );
}
