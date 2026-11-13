"use client";

import * as React from "react";

import { CommentsSkeleton } from "@/components/site/comments-skeleton";
import { useTheme } from "@astrodx/ui/theme";
import { Button } from "@astrodx/ui/components/button";
import { getDictionary, type Locale } from "@/lib/i18n";
import { probeCommentServer, watchCommentLoading } from "@/lib/comment-loading";

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
  on: (event: string, handler: () => void) => void;
  off: (event: string, handler: () => void) => void;
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
    const fail = () => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      script.remove();
      scriptPromises.delete(src);
      reject(new Error(`Failed to load ${src}`));
    };
    const timer = setTimeout(fail, 20_000);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = fail;
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
  // Latest theme, readable from the async init flow. `resolvedTheme` is the
  // canonical site theme (useSyncExternalStore reads it synchronously), so it's
  // a more reliable dark-mode source than a DOM class read that can race.
  const isDarkRef = React.useRef(isDark);
  // Drives the loading skeleton and the failure card: "loading" keeps the
  // skeleton up until Artalk has loaded the first comment list, "error" swaps in a retry
  // card so the section never sits blank after a failed third-party fetch.
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  // Bumped by the retry button to re-run the load effect (loadScriptOnce
  // evicts failed script promises, so a new attempt actually refetches).
  const [attempt, setAttempt] = React.useState(0);
  const labels = getDictionary(locale).detail;

  React.useEffect(() => {
    let cancelled = false;
    let stopWatching: (() => void) | undefined;
    const controller = new AbortController();
    const deadline = setTimeout(() => fail(), 20_000);
    const fail = () => {
      if (cancelled || controller.signal.aborted) return;
      clearTimeout(deadline);
      controller.abort();
      stopWatching?.();
      try {
        instanceRef.current?.destroy();
      } catch {
        // Clear partial UI even if an incomplete instance cannot destroy itself.
      }
      instanceRef.current = null;
      containerRef.current?.replaceChildren();
      setStatus("error");
    };
    // Re-show the skeleton when the thread is re-initialized (e.g. client-side
    // navigation between chart pages tears down and rebuilds the instance).
    // Intentional reset: the prior instance was just destroyed, so without this
    // the area would sit blank through the next load instead of showing the
    // skeleton.
    setStatus("loading");
    const artalkLocale = ARTALK_LOCALE[locale] ?? "zh-CN";

    // `ja` (and any non-bundled locale) self-registers into window.ArtalkI18n
    // once its file loads, so pull it in alongside the main bundle before init.
    const localeSrc = ARTALK_EXTRA_LOCALE_SRC[locale];
    Promise.all([
      loadArtalk(),
      localeSrc ? loadScriptOnce(localeSrc) : null,
      probeCommentServer(ARTALK_SERVER, controller.signal),
    ])
      .then(([Artalk]) => {
        if (cancelled || controller.signal.aborted || !containerRef.current) {
          return;
        }
        // init/reload can throw synchronously (e.g. a version-mismatched
        // bundle); route that into the same error card as a failed fetch.
        try {
          const instance = Artalk.init({
            el: containerRef.current,
            pageKey,
            pageTitle,
            server: ARTALK_SERVER,
            site: ARTALK_SITE,
            locale: artalkLocale,
            darkMode: isDarkRef.current,
            // Artalk >= 2.10 keeps explicit local theme/locale overrides.
            // remoteConfModifier was removed; the client loads comments itself.
            preferRemoteConf: false,
          });
          instanceRef.current = instance;
          stopWatching = watchCommentLoading(instance, (nextStatus) => {
            if (cancelled) return;
            if (nextStatus === "error") fail();
            else {
              clearTimeout(deadline);
              setStatus("ready");
            }
          });
          instance.on("mounted", () => {
            if (!cancelled) instance.setDarkMode(isDarkRef.current);
          });
        } catch {
          fail();
        }
      })
      .catch(fail);

    return () => {
      cancelled = true;
      clearTimeout(deadline);
      controller.abort();
      stopWatching?.();
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [pageKey, pageTitle, locale, attempt]);

  // Follow the site's light/dark toggle without re-initializing the widget, and
  // keep the ref current for the async init flow's "mounted" handler above.
  React.useEffect(() => {
    isDarkRef.current = isDark;
    instanceRef.current?.setDarkMode(isDark);
  }, [isDark]);

  return (
    <div className="relative">
      {/* Always mounted so the ref exists when Artalk.init runs; stays empty
          until the first comment request completes. */}
      <div ref={containerRef} hidden={status !== "ready"} />
      {status === "loading" ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">{labels.commentsLoading}</span>
          <CommentsSkeleton />
        </div>
      ) : null}
      {status === "error" ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border border-border/70 bg-card/50 p-4"
        >
          <p className="text-sm text-muted-foreground">{labels.commentsError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((current) => current + 1)}
          >
            {labels.commentsRetry}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
