import type { Locale } from "@/lib/i18n";

export type CommunityChannel = {
  name: Record<Locale, string>;
  url: string;
  description: Record<Locale, string>;
};

// Shared community entry points — also used by the site header's Telegram
// button and the footer, so the URLs live here rather than per-component.
export const QQ_COMMUNITY = "https://qm.qq.com/q/xltNzTdL1u";
export const TELEGRAM_COMMUNITY = "https://t.me/FullDiveSAO";

// Rendered on /community. Order follows editorial intent.
export const communityChannels: CommunityChannel[] = [
  {
    name: {
      zh: "QQ 交流群",
      en: "QQ Group",
      ja: "QQ グループ",
    },
    url: QQ_COMMUNITY,
    description: {
      zh: "国内玩家的主要交流群，谱面讨论、问题反馈与站点动态。",
      en: "The main group for players in China — chart chat, feedback and site news.",
      ja: "中国プレイヤー向けのメイングループ。譜面の話題、フィードバック、サイトの最新情報。",
    },
  },
  {
    name: {
      zh: "Telegram 群组",
      en: "Telegram Group",
      ja: "Telegram グループ",
    },
    url: TELEGRAM_COMMUNITY,
    description: {
      zh: "Telegram 社区群组，国际玩家交流与本站更新通知。",
      en: "Our Telegram community — international players and update announcements.",
      ja: "Telegram コミュニティ。海外プレイヤーとの交流や更新のお知らせ。",
    },
  },
];
