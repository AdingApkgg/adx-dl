import type { Locale } from "@/lib/i18n";

export type FriendLink = {
  /**
   * Localized site name. Half of these sites only have a Chinese name in the
   * wild, but the card's accessible name and the /links ItemList JSON-LD are
   * both built from this string — leaving it monolingual meant an English or
   * Japanese reader got a title they could not read, in the markup as well as
   * on screen. A romanized/translated form is used where no official one exists.
   */
  name: Record<Locale, string>;
  url: string;
  description: Record<Locale, string>;
};

// Display-friendly hostname for external-link cards (/links, /community, /donate).
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// The AstroDX source repository — linked from the about and community-links
// surfaces. User-facing "Get AstroDX" actions route through the Wiki instead.
export const ASTRODX_APP_REPOSITORY = "https://github.com/2394425147/astrodx";

// Curated maimai / AstroDX community sites and tools. External and unaffiliated;
// rendered on /links and surfaced in the sitemap. Order follows editorial intent.
export const friendLinks: FriendLink[] = [
  {
    name: { zh: "AstroDX", en: "AstroDX", ja: "AstroDX" },
    url: ASTRODX_APP_REPOSITORY,
    description: {
      zh: "AstroDX 模拟器本体的开源仓库，可下载最新版应用。",
      en: "The open-source repository of the AstroDX simulator itself — grab the latest release here.",
      ja: "AstroDX シミュレーター本体のオープンソースリポジトリ。最新版はこちらから。",
    },
  },
  {
    name: {
      zh: "AWMC 下载站",
      en: "AWMC Downloads",
      ja: "AWMC ダウンロードサイト",
    },
    url: "https://download.awmc.cc/",
    description: {
      zh: "AWMC 社区的谱面与资源下载站。",
      en: "Chart and resource downloads from the AWMC community.",
      ja: "AWMC コミュニティの譜面・リソース配布サイト。",
    },
  },
  {
    name: {
      zh: "OneCat 下载站",
      en: "OneCat Downloads",
      ja: "OneCat ダウンロードサイト",
    },
    url: "https://dw.moant.cn:34225/onecat/#/official",
    description: {
      zh: "OneCat 的 ADX 谱面下载站。",
      en: "OneCat's ADX chart download site.",
      ja: "OneCat の ADX 譜面ダウンロードサイト。",
    },
  },
  {
    name: { zh: "SimaiHub", en: "SimaiHub", ja: "SimaiHub" },
    url: "https://simaihub.dev/",
    description: {
      zh: "新一代 maimai 谱面下载解决方案。",
      en: "The next-gen maimai chart downloading solution.",
      ja: "次世代の maimai 譜面ダウンロードソリューション。",
    },
  },
  {
    name: { zh: "AWMC BBS", en: "AWMC BBS", ja: "AWMC BBS" },
    url: "https://awmc.cc/",
    description: {
      zh: "maimai DX 非官方社区论坛，玩家交流与资源分享。",
      en: "An unofficial maimai DX community forum for chatting and sharing.",
      ja: "maimai DX の非公式コミュニティ掲示板。",
    },
  },
  {
    name: {
      zh: "哲零网络",
      en: "Zheling Network",
      ja: "哲零ネットワーク",
    },
    url: "https://yusizhe.top/",
    description: {
      zh: "哲零网络，一个独立小工作室。",
      en: "Zheling Network — an indie micro studio.",
      ja: "哲零ネットワーク、インディーの小さなスタジオ。",
    },
  },
  {
    name: { zh: "Majdata Net", en: "Majdata Net", ja: "Majdata Net" },
    url: "https://majdata.net/",
    description: {
      zh: "maimai 饭制谱面分享平台，支持上传、下载、排行榜与社区互动。",
      en: "A platform for sharing maimai fanmade charts — uploads, downloads, and leaderboards.",
      ja: "maimai 自作譜面の共有プラットフォーム。アップロード・ダウンロード・ランキングに対応。",
    },
  },
  {
    name: {
      zh: "舞萌 DX 查分器",
      en: "Diving-Fish Score Prober",
      ja: "Diving-Fish 査分器",
    },
    url: "https://maimai.diving-fish.com/",
    description: {
      zh: "Diving-Fish 的舞萌 DX / 中二节奏查分器，记录并查询成绩。",
      en: "Diving-Fish's maimai DX / CHUNITHM score prober for tracking your scores.",
      ja: "Diving-Fish の舞萌 DX / 中二節奏 スコア確認ツール（査分器）。",
    },
  },
  {
    name: {
      zh: "落雪查分器",
      en: "Lxns Score Prober",
      ja: "落雪（Lxns）査分器",
    },
    url: "https://maimai.lxns.net/",
    description: {
      zh: "落雪 (Lxns) 的舞萌 DX / 中二节奏国服查分器，并提供开放 API。",
      en: "Lxns Network's maimai DX / CHUNITHM score prober, with an open API.",
      ja: "Lxns（落雪）の舞萌 DX / 中二節奏 スコア確認ツール。オープン API も提供。",
    },
  },
  {
    name: { zh: "MaiViewer", en: "MaiViewer", ja: "MaiViewer" },
    url: "https://maiviewer.net/",
    description: {
      zh: "maimai 谱面在线预览器，在浏览器中查看谱面。",
      en: "An online maimai chart viewer — preview charts in your browser.",
      ja: "maimai 譜面のオンラインビューア。ブラウザで譜面を確認。",
    },
  },
];
