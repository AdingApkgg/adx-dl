import type { Locale } from "@/lib/i18n";

export type DonateMethod = {
  name: Record<Locale, string>;
  url: string;
  description: Record<Locale, string>;
};

// USDT (TRC20) wallet address, rendered on /donate with a copy button.
export const DONATE_TRC20_ADDRESS = "TGXpGgXBrFGjQLX8WuS3QAswCGzFyrnp1r";

// Public block-explorer page for the address above, linked from the TRC20 card.
export const DONATE_TRC20_EXPLORER_URL = `https://tronscan.org/address/${DONATE_TRC20_ADDRESS}`;

// Link-based donation methods rendered on /donate. Order follows editorial
// intent: domestic platform first, then international.
export const donateMethods: DonateMethod[] = [
  {
    name: {
      zh: "爱发电",
      en: "Afdian (爱发电)",
      ja: "爱发电 (Afdian)",
    },
    url: "https://afdian.com/a/scale",
    description: {
      zh: "适合国内用户，支持支付宝与微信支付。",
      en: "Best for supporters in China — Alipay and WeChat Pay.",
      ja: "中国のユーザー向け。Alipay・WeChat Pay に対応。",
    },
  },
  {
    name: {
      zh: "Patreon",
      en: "Patreon",
      ja: "Patreon",
    },
    url: "https://patreon.com/KirigayaAsuna",
    description: {
      zh: "适合国际用户，支持信用卡等支付方式。",
      en: "Best for international supporters — card payments and more.",
      ja: "海外ユーザー向け。クレジットカードなどに対応。",
    },
  },
];
