export type BannerKind = "connection" | "notice" | "locale";

/**
 * Which of the three top-of-page bars to show. At most one, ever.
 *
 * Stacking them pushes the header below the fold on a phone. The order is by
 * how immediate each fact is: being offline stops you working right now, a
 * notice is something you need to know, a language suggestion is a comfort.
 * All three tolerate being delayed — the two dismissible ones remember their
 * state, so a suppressed bar still gets its turn later.
 */
export function pickBanner(present: {
  connection: boolean;
  notice: boolean;
  locale: boolean;
}): BannerKind | null {
  if (present.connection) return "connection";
  if (present.notice) return "notice";
  if (present.locale) return "locale";
  return null;
}
