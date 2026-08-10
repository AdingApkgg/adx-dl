import { buildLocalePath, getDictionary, getHtmlLang, type Locale } from "@/lib/i18n";

export type WebManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  lang: string;
  dir: "ltr";
  display: "standalone";
  orientation: "any";
  categories: string[];
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

/**
 * Per-locale copy for the install prompt. The installed app's `name` comes
 * from the shared dictionary instead of a fourth spelling of the brand — only
 * the short name and description are manifest-specific.
 */
const manifestCopy: Record<Locale, { shortName: string; description: string }> = {
  zh: {
    shortName: "ADX 谱面",
    description:
      "AstroDX 谱面资源归档与下载入口：搜索、试听、预览并下载 maimai 风格谱面，一键导入 AstroDX。",
  },
  en: {
    shortName: "ADX Charts",
    description:
      "Chart archive and download portal for AstroDX: search, preview and download maimai-style charts, then import them in one tap.",
  },
  ja: {
    shortName: "ADX 譜面",
    description:
      "AstroDX 譜面のアーカイブとダウンロード入口。maimai 系譜面の検索・試聴・プレビュー・ダウンロードに対応しています。",
  },
};

// Kept in step with the theme-color meta in root-layout-shell.tsx.
const THEME_COLOR = "#081a4d";
const BACKGROUND_COLOR = "#020617";

const ICONS: WebManifest["icons"] = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

/**
 * One manifest per locale.
 *
 * `id` and `start_url` are locale-scoped so installing from /ja gives a
 * Japanese app that launches into the Japanese home page — a single shared
 * manifest made every install a Chinese one, whichever tree it was triggered
 * from. `scope` stays "/" regardless: the trees cross-link (a chart page links
 * its own translations, the language switcher jumps between them), and a
 * per-locale scope would eject those navigations from the installed window.
 */
export function buildWebManifest(locale: Locale): WebManifest {
  const copy = manifestCopy[locale];
  const start = buildLocalePath("/", locale);

  return {
    id: start,
    name: getDictionary(locale).siteName,
    short_name: copy.shortName,
    description: copy.description,
    start_url: start,
    scope: "/",
    lang: getHtmlLang(locale),
    dir: "ltr",
    display: "standalone",
    orientation: "any",
    categories: ["music", "entertainment", "utilities"],
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    icons: ICONS,
  };
}

/** Path of the manifest a locale's layout should link. */
export function webManifestPath(locale: Locale): string {
  return `${buildLocalePath("/", locale).replace(/\/$/, "")}/site.webmanifest`;
}
