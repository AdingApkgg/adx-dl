import { buildChartDescription, formatEntryTitle, type CatalogEntry } from "./catalog-shared";
import type { Locale } from "./i18n";

export function chartPreviewSeoTitle(entry: CatalogEntry, locale: Locale): string {
  const title = formatEntryTitle(entry, locale);
  return locale === "zh" ? `${title} AstroDX 谱面预览` : locale === "ja" ? `${title} AstroDX 譜面プレビュー` : `${title} AstroDX Chart Preview`;
}

export function chartPreviewDescription(entry: CatalogEntry, locale: Locale): string {
  const introduction = locale === "zh"
    ? "在线预览谱面，切换难度、调整播放速度并分享指定播放位置。"
    : locale === "ja"
      ? "譜面をオンラインでプレビュー。難易度と再生速度を切り替え、再生位置を共有できます。"
      : "Preview this chart online, switch difficulty, adjust playback speed and share a playback position.";
  return `${introduction} ${buildChartDescription(entry, locale)}`;
}
