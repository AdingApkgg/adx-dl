import noticesData from "@/data/notices.json";
import { defaultLocale, type Locale } from "@/lib/i18n";

export type NoticeLevel = "urgent" | "normal";
export type LocalizedText = Record<Locale, string | null>;
export type NoticeLink = { href: string; label: LocalizedText };

export type Notice = {
  id: string;
  level: NoticeLevel;
  /** UTC calendar day. Sorting key and the basis of the unread mark. */
  publishedAt: string;
  /** UTC calendar day, inclusive. `null` never expires. */
  expiresAt: string | null;
  title: LocalizedText;
  body: LocalizedText;
  link: NoticeLink | null;
};

export type ResolvedText = { value: string; translated: boolean };

/** Build-time data. The JSON is the single source; dash edits it via a form. */
export const notices: Notice[] = (noticesData as { notices: Notice[] }).notices;

/**
 * The current UTC calendar day.
 *
 * Every date in this module is a `YYYY-MM-DD` string compared lexicographically.
 * Using the local day instead would let the static build and the visitor's
 * browser disagree about whether a notice has expired.
 */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * A notice's text in one locale, plus whether it was actually translated.
 *
 * Translations are allowed to be missing: requiring three languages before an
 * urgent notice can go out would delay exactly the notices that must not wait.
 */
export function resolveText(text: LocalizedText, locale: Locale): ResolvedText {
  const own = text[locale];
  if (own !== null && own !== undefined && own !== "") {
    return { value: own, translated: true };
  }
  return { value: text[defaultLocale] ?? "", translated: false };
}

export function isActive(notice: Notice, today: string): boolean {
  return notice.expiresAt === null || notice.expiresAt >= today;
}

/** Active notices first, each group newest-first. Expired ones keep their archive value. */
export function sortNotices(list: Notice[], today: string): Notice[] {
  return [...list].sort((left, right) => {
    const leftActive = isActive(left, today);
    const rightActive = isActive(right, today);
    if (leftActive !== rightActive) {
      return leftActive ? -1 : 1;
    }
    return right.publishedAt.localeCompare(left.publishedAt);
  });
}

/** The one urgent notice the top-of-page banner should show, if any. */
export function pickUrgentNotice(
  list: Notice[],
  today: string,
  dismissedIds: string[]
): Notice | null {
  const candidates = sortNotices(
    list.filter(
      (notice) =>
        notice.level === "urgent" && isActive(notice, today) && !dismissedIds.includes(notice.id)
    ),
    today
  );
  return candidates[0] ?? null;
}

export function unreadCount(list: Notice[], readIds: string[], today: string): number {
  return list.filter((notice) => isActive(notice, today) && !readIds.includes(notice.id)).length;
}

/** Drop stored ids whose notice is gone, so the two lists cannot grow forever. */
export function pruneIds(stored: string[], list: Notice[]): string[] {
  const known = new Set(list.map((notice) => notice.id));
  return stored.filter((id) => known.has(id));
}

/**
 * Whether a notice link's href is safe to render as a clickable anchor.
 *
 * Allowlisted, not blocklisted: today the only writer is hand-committed JSON,
 * but the spec calls for an admin form later, so every href is treated as
 * untrusted input rather than trusted because of where it currently comes
 * from. Absolute http(s), protocol-relative (`//host/...`) and site-relative
 * (`/path`) all pass; anything else — notably `javascript:` — does not.
 */
export function isSafeNoticeHref(href: string): boolean {
  return (
    href.startsWith("https:") ||
    href.startsWith("http:") ||
    href.startsWith("//") ||
    href.startsWith("/")
  );
}
