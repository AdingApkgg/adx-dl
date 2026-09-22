import { notices as defaultNotices, pruneIds, type Notice } from "@/lib/notices";

// Storage access is wrapped throughout: Safari private mode and blocked
// site data both throw on access, and a visitor in that state must still get
// a working page — just without the memory.
const DISMISSED_KEY = "adx-notice-dismissed";
const READ_KEY = "adx-notice-read";

function readIdList(key: string, list: Notice[]): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return pruneIds(
      parsed.filter((value): value is string => typeof value === "string"),
      list
    );
  } catch {
    // Blocked storage or corrupt JSON — behave as if nothing was stored.
    return [];
  }
}

function writeIdList(key: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Ignore blocked storage — the choice simply won't persist.
  }
}

export function readDismissedIds(list: Notice[] = defaultNotices): string[] {
  return readIdList(DISMISSED_KEY, list);
}

export function addDismissedId(id: string, list: Notice[] = defaultNotices): void {
  const current = readDismissedIds(list);
  if (current.includes(id)) return;
  writeIdList(DISMISSED_KEY, [...current, id]);
}

export function readReadIds(list: Notice[] = defaultNotices): string[] {
  return readIdList(READ_KEY, list);
}

export function markRead(ids: string[], list: Notice[] = defaultNotices): void {
  const current = readReadIds(list);
  const merged = [...new Set([...current, ...ids])];
  if (merged.length === current.length) return;
  writeIdList(READ_KEY, merged);
}

/**
 * Whether this browser will actually remember anything.
 *
 * `readReadIds()` cannot answer this: it returns `[]` both when nothing has
 * been read and when storage threw. The unread dot needs to tell those apart —
 * a dot that can never be cleared would show on every visit forever.
 */
export function isStorageAvailable(): boolean {
  try {
    const probe = "__adx-storage-probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
