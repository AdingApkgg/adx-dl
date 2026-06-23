"use client";

import * as React from "react";

import { useTheme } from "@/components/site/theme-provider";
import type { Locale } from "@/lib/i18n";

// Self-hosted Artalk comment backend. The UMD bundle served from `/dist` exposes
// a `window.Artalk` global and is version-matched to this backend.
const ARTALK_SERVER = "https://artalk.saop.cc";
// Must match a site created in the Artalk admin console.
const ARTALK_SITE = "adxc";
const ARTALK_SCRIPT = `${ARTALK_SERVER}/dist/Artalk.js`;
const ARTALK_STYLES = `${ARTALK_SERVER}/dist/Artalk.css`;

const ARTALK_LOCALE: Record<Locale, string> = {
  zh: "zh-CN",
  en: "en",
  ja: "ja",
};

// `zh-CN` and `en` are bundled into Artalk.js. Every other locale ships as a
// standalone file that self-registers into `window.ArtalkI18n`; we pull the
// matching one from the same server (no npm dependency) and load it before init,
// otherwise Artalk silently falls back to English.
const ARTALK_EXTRA_LOCALE_SRC: Partial<Record<Locale, string>> = {
  ja: `${ARTALK_SERVER}/dist/i18n/ja.js`,
};

type ArtalkConf = Record<string, unknown>;
type ArtalkInstance = {
  destroy: () => void;
  setDarkMode: (value: boolean) => void;
  reload: () => void;
};
type ArtalkGlobal = {
  init: (conf: ArtalkConf) => ArtalkInstance;
};

declare global {
  interface Window {
    Artalk?: ArtalkGlobal;
  }
}

const scriptPromises = new Map<string, Promise<void>>();

// Injects a <script> once per src and resolves when it has executed. A failed
// load is evicted so a later mount can retry.
function loadScriptOnce(src: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Artalk requires a browser environment"));
  }
  const cached = scriptPromises.get(src);
  if (cached) {
    return cached;
  }
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromises.delete(src);
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });
  scriptPromises.set(src, promise);
  return promise;
}

// Loads the Artalk stylesheet + UMD bundle once, regardless of how many comment
// widgets mount over the session.
async function loadArtalk(): Promise<ArtalkGlobal> {
  if (typeof window === "undefined") {
    throw new Error("Artalk requires a browser environment");
  }
  if (!window.Artalk && !document.querySelector("link[data-artalk-styles]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = ARTALK_STYLES;
    link.setAttribute("data-artalk-styles", "");
    document.head.appendChild(link);
  }
  await loadScriptOnce(ARTALK_SCRIPT);
  if (!window.Artalk) {
    throw new Error("Artalk global was not defined after load");
  }
  return window.Artalk;
}

export function ChartComments({
  pageKey,
  pageTitle,
  locale,
}: {
  pageKey: string;
  pageTitle: string;
  locale: Locale;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const instanceRef = React.useRef<ArtalkInstance | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  React.useEffect(() => {
    let cancelled = false;
    const artalkLocale = ARTALK_LOCALE[locale] ?? "zh-CN";
    // Read the live theme at init so the first paint matches; the effect below
    // keeps it in sync afterwards without tearing the instance down.
    const initialDark =
      typeof document !== "undefined" && document.documentElement.classList.contains("dark");

    // `ja` (and any non-bundled locale) self-registers into window.ArtalkI18n
    // once its file loads, so pull it in alongside the main bundle before init.
    const localeSrc = ARTALK_EXTRA_LOCALE_SRC[locale];
    Promise.all([loadArtalk(), localeSrc ? loadScriptOnce(localeSrc) : null])
      .then(([Artalk]) => {
        if (cancelled || !containerRef.current) {
          return;
        }
        const instance = Artalk.init({
          el: containerRef.current,
          pageKey,
          pageTitle,
          server: ARTALK_SERVER,
          site: ARTALK_SITE,
          locale: artalkLocale,
          darkMode: initialDark,
          // The backend ships `darkMode: "inherit"` with `useBackendConf`; re-assert
          // our values so the widget tracks the site theme and locale, not system
          // defaults.
          remoteConfModifier: (conf: ArtalkConf) => {
            conf.darkMode = initialDark;
            conf.locale = artalkLocale;
          },
        });
        instanceRef.current = instance;
        // `remoteConfModifier` suppresses Artalk's initial comment-list auto-load;
        // trigger it explicitly or the thread renders blank (no count, no list).
        instance.reload();
      })
      .catch(() => {
        // Network/load failure: leave the container empty rather than throwing.
      });

    return () => {
      cancelled = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [pageKey, pageTitle, locale]);

  // Follow the site's light/dark toggle without re-initializing the widget.
  React.useEffect(() => {
    instanceRef.current?.setDarkMode(isDark);
  }, [isDark]);

  return <div ref={containerRef} />;
}
