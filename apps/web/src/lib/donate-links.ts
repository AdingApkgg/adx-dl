import content from "@content/donate.json";

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
export const donateMethods = content.methods satisfies DonateMethod[];
