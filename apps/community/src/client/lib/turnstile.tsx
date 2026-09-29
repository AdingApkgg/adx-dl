import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { getLocale } from "@/paraglide/runtime.js";

type TurnstileRenderOptions = {
  sitekey: string;
  language?: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const LANGUAGES = { zh: "zh-cn", en: "en", ja: "ja" } as const;

let loading: Promise<TurnstileApi> | undefined;

// 按需加载 Turnstile 的脚本，整个页面只加载一次。CSP 的 script-src 已经放行
// challenges.cloudflare.com（1a），动态插入的外部脚本不需要 nonce。
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile is missing")));
    script.onerror = () => {
      loading = undefined;
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export type Turnstile = {
  /** 渲染 widget 的容器，放在表单里：<div ref={turnstile.ref} /> */
  ref: RefObject<HTMLDivElement | null>;
  /** 拿到的令牌；还没通过或已过期时是 null。令牌只能用一次，提交后要 reset()。 */
  token: string | null;
  reset(): void;
  /** 脚本加载失败、widget 渲染失败，或者 widget 自己报了错（它会自动重试，重试成功后又变回 false）。 */
  failed: boolean;
};

export function useTurnstile(siteKey: string): Turnstile {
  const ref = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then(
      (api) => {
        if (cancelled || !ref.current) {
          return;
        }
        try {
          widgetId.current = api.render(ref.current, {
            sitekey: siteKey,
            language: LANGUAGES[getLocale()],
            callback: (value) => {
              setToken(value);
              // widget 出错后自己重试成功了：失败的提示要跟着消失。
              setFailed(false);
            },
            "expired-callback": () => setToken(null),
            "error-callback": () => {
              setToken(null);
              setFailed(true);
            },
          });
        } catch {
          // render 会直接抛错（例如站点密钥不对）。这时没有 widget 可用，和脚本加载失败一样提示用户；
          // 不接住的话它会变成未处理的 rejection，页面上也不会有任何提示。
          setFailed(true);
        }
      },
      () => {
        if (!cancelled) {
          setFailed(true);
        }
      }
    );
    return () => {
      cancelled = true;
      if (widgetId.current) {
        window.turnstile?.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetId.current) {
      window.turnstile?.reset(widgetId.current);
    }
  }, []);

  return { ref, token, reset, failed };
}
