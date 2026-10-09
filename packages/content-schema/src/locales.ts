// The three locales every piece of editable copy must carry. This is the one
// place the list is written down for content purposes: apps/web's i18n module
// has its own `locales` for routing and dictionaries, and a test over there
// asserts the two stay equal (see apps/web/src/lib/content-json.test.ts).
export const CONTENT_LOCALES = ["zh", "en", "ja"] as const;

export type ContentLocale = (typeof CONTENT_LOCALES)[number];
