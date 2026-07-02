import type { Locale } from "@/lib/i18n";

export type FriendLink = {
  name: string;
  url: string;
  description: Record<Locale, string>;
};

// The AstroDX app itself — linked from the home hero, the footer, and /links.
// Official repo (README: "the ONLY official source"); formerly named MaipadDX.
export const ASTRODX_APP_REPOSITORY = "https://github.com/2394425147/astrodx";

// Curated maimai / AstroDX community sites and tools. External and unaffiliated;
// rendered on /links and surfaced in the sitemap. Order follows editorial intent.
export const friendLinks: FriendLink[] = [
  {
    name: "AstroDX",
    url: ASTRODX_APP_REPOSITORY,
    description: {
      zh: "AstroDX 模拟器本体的开源仓库，可下载最新版应用。",
      en: "The open-source repository of the AstroDX simulator itself — grab the latest release here.",
      ja: "AstroDX シミュレーター本体のオープンソースリポジトリ。最新版はこちらから。",
    },
  },
  {
    name: "AWMC 下载站",
    url: "https://download.awmc.cc/",
    description: {
      zh: "AWMC 社区的谱面与资源下载站。",
      en: "Chart and resource downloads from the AWMC community.",
      ja: "AWMC コミュニティの譜面・リソース配布サイト。",
    },
  },
  {
    name: "AWMC BBS",
    url: "https://awmc.cc/",
    description: {
      zh: "maimai DX 非官方社区论坛，玩家交流与资源分享。",
      en: "An unofficial maimai DX community forum for chatting and sharing.",
      ja: "maimai DX の非公式コミュニティ掲示板。",
    },
  },
  {
    name: "哲零网络",
    url: "https://yusizhe.top/",
    description: {
      zh: "哲零网络，一个独立小工作室。",
      en: "Zhel零 Network — an indie micro studio.",
      ja: "哲零ネットワーク、インディーの小さなスタジオ。",
    },
  },
  {
    name: "Majdata Net",
    url: "https://majdata.net/",
    description: {
      zh: "maimai 饭制谱面分享平台，支持上传、下载、排行榜与社区互动。",
      en: "A platform for sharing maimai fanmade charts — uploads, downloads, and leaderboards.",
      ja: "maimai 自作譜面の共有プラットフォーム。アップロード・ダウンロード・ランキングに対応。",
    },
  },
  {
    name: "舞萌 DX 查分器",
    url: "https://maimai.diving-fish.com/",
    description: {
      zh: "Diving-Fish 的舞萌 DX / 中二节奏查分器，记录并查询成绩。",
      en: "Diving-Fish's maimai DX / CHUNITHM score prober for tracking your scores.",
      ja: "Diving-Fish の舞萌 DX / 中二節奏 スコア確認ツール（査分器）。",
    },
  },
  {
    name: "落雪查分器",
    url: "https://maimai.lxns.net/",
    description: {
      zh: "落雪 (Lxns) 的舞萌 DX / 中二节奏国服查分器，并提供开放 API。",
      en: "Lxns Network's maimai DX / CHUNITHM score prober, with an open API.",
      ja: "Lxns（落雪）の舞萌 DX / 中二節奏 スコア確認ツール。オープン API も提供。",
    },
  },
  {
    name: "MaiViewer",
    url: "https://maiviewer.net/",
    description: {
      zh: "maimai 谱面在线预览器，在浏览器中查看谱面。",
      en: "An online maimai chart viewer — preview charts in your browser.",
      ja: "maimai 譜面のオンラインビューア。ブラウザで譜面を確認。",
    },
  },
];
