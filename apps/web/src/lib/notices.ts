import noticesData from "@/data/notices.json";
import { defaultLocale, type Locale } from "@/lib/i18n";

/**
 * How loudly a notice announces itself.
 *
 * - `urgent`: top-of-page banner until dismissed, even after it has been read.
 * - `featured`: the same banner slot, but only once — read or dismissed, it is gone.
 * - `normal`: list, unread badge and the home strip only.
 */
export const NOTICE_LEVELS = ["urgent", "featured", "normal"] as const;
export type NoticeLevel = (typeof NOTICE_LEVELS)[number];
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

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalizedText(value: unknown): value is LocalizedText {
  if (!isRecord(value)) return false;
  const own = value[defaultLocale];
  if (typeof own !== "string" || own === "") return false;
  return Object.values(value).every((text) => text === null || typeof text === "string");
}

function noticeProblem(value: unknown): string | null {
  if (!isRecord(value)) return "not an object";
  const { id, level, publishedAt, expiresAt, title, body, link } = value;
  // Ids end up in a URL fragment and in localStorage — a strict slug keeps
  // both unambiguous.
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return "id must be a lowercase slug";
  if (!NOTICE_LEVELS.includes(level as NoticeLevel)) return `unknown level ${String(level)}`;
  if (typeof publishedAt !== "string" || !DAY_PATTERN.test(publishedAt)) {
    return "publishedAt must be YYYY-MM-DD";
  }
  if (expiresAt !== null && (typeof expiresAt !== "string" || !DAY_PATTERN.test(expiresAt))) {
    return "expiresAt must be YYYY-MM-DD or null";
  }
  if (!isLocalizedText(title)) return `title needs a non-empty ${defaultLocale} text`;
  if (!isLocalizedText(body)) return `body needs a non-empty ${defaultLocale} text`;
  if (link !== null) {
    if (!isRecord(link) || typeof link.href !== "string" || !isLocalizedText(link.label)) {
      return "link must be null or { href, label }";
    }
  }
  return null;
}

/**
 * Checks the notice file's shape and throws on the first bad entry.
 *
 * Throwing rather than skipping: the file is build-time data, so a bad entry
 * fails CI before it ships instead of silently vanishing from the site.
 */
export function parseNotices(raw: unknown): Notice[] {
  const list = isRecord(raw) ? raw.notices : undefined;
  if (!Array.isArray(list)) throw new Error("notices.json: expected { notices: [...] }");
  const seen = new Set<string>();
  for (const [index, entry] of list.entries()) {
    const problem = noticeProblem(entry);
    if (problem) throw new Error(`notices.json: entry ${index}: ${problem}`);
    const { id } = entry as Notice;
    if (seen.has(id)) throw new Error(`notices.json: duplicate id ${id}`);
    seen.add(id);
  }
  return list as Notice[];
}

/** Build-time data. The JSON is the single source; dash edits it via a form. */
export const notices: Notice[] = parseNotices(noticesData);

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

/**
 * The one notice the top-of-page banner should show, if any.
 *
 * Urgent beats featured. An urgent notice stays until dismissed; a featured
 * one is also gone once read — it only exists to get a notice seen once.
 */
export function pickBannerNotice(
  list: Notice[],
  today: string,
  dismissedIds: string[],
  readIds: string[]
): Notice | null {
  const live = sortNotices(
    list.filter((notice) => isActive(notice, today) && !dismissedIds.includes(notice.id)),
    today
  );
  return (
    live.find((notice) => notice.level === "urgent") ??
    live.find((notice) => notice.level === "featured" && !readIds.includes(notice.id)) ??
    null
  );
}

/** The newest active notice, for the home page strip. */
export function latestNotice(list: Notice[], today: string): Notice | null {
  const [first] = sortNotices(list, today);
  return first && isActive(first, today) ? first : null;
}

/**
 * How old a notice may be before a first-time visitor is spared it.
 *
 * Without this, a new visitor sees every active notice as unread, so the badge
 * is lit on every first visit and stops meaning "something new".
 */
export const FIRST_VISIT_GRACE_DAYS = 14;

/** Active notices a first-time visitor should treat as already read. */
export function staleNoticeIds(list: Notice[], today: string): string[] {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - FIRST_VISIT_GRACE_DAYS);
  const cutoffDay = todayUtc(cutoff);
  return list.filter((notice) => notice.publishedAt < cutoffDay).map((notice) => notice.id);
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

/**
 * Whether an (already safe) href stays on this site.
 *
 * `//host/...` starts with a slash but is another site: it must not be handed
 * to `<Link>` or prefixed with a locale.
 */
export function isInternalNoticeHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}
