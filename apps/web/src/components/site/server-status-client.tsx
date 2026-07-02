"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";

import { StatusPageView } from "@/components/site/status-page-view";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  appendHistoryPoint,
  mergeHistory,
  parseStoredHistory,
  type ServerStatusHistoryPoint,
} from "@/lib/server-status-history";
import {
  fetchServerStatus,
  ServerStatusParseError,
  type ServerStatusSnapshot,
} from "@/lib/server-status";

const REFRESH_INTERVAL_MS = 60_000;
const MAX_HISTORY_POINTS = 24;
const HISTORY_STORAGE_KEY = "astrodx-server-status-history";
// The chart window is MAX_HISTORY_POINTS polls (~24 min); stored samples much
// older than that would draw a misleading gap, so cap the seed at twice that.
const HISTORY_MAX_AGE_MS = REFRESH_INTERVAL_MS * MAX_HISTORY_POINTS * 2;

function readStoredHistory(): ServerStatusHistoryPoint[] {
  try {
    return parseStoredHistory(
      window.sessionStorage.getItem(HISTORY_STORAGE_KEY),
      MAX_HISTORY_POINTS,
      HISTORY_MAX_AGE_MS
    );
  } catch {
    // Storage may be blocked (privacy mode); charts fall back to in-memory only.
    return [];
  }
}

export function ServerStatusClient({ locale = "zh" }: { locale?: Locale }) {
  const labels = getDictionary(locale).statusPage;
  // SWR owns the snapshot/loading/error lifecycle; we only keep the rolling
  // history locally since SWR replaces (rather than accumulates) data.
  const [history, setHistory] = useState<ServerStatusHistoryPoint[]>([]);

  // Seed from the previous session so returning visitors see charts right away
  // instead of waiting a full poll interval for a second point. Must run after
  // mount: sessionStorage is unavailable during the static prerender, and
  // seeding in the useState initializer would mismatch the hydrated markup.
  useEffect(() => {
    const stored = readStoredHistory();
    if (stored.length === 0) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory((current) => mergeHistory(stored, current, MAX_HISTORY_POINTS));
  }, []);

  useEffect(() => {
    if (history.length === 0) {
      return;
    }
    try {
      window.sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Quota/privacy failures just lose persistence, never the live charts.
    }
  }, [history]);

  const { data, error, isValidating, mutate } = useSWR<ServerStatusSnapshot>(
    "server-status",
    () => fetchServerStatus(),
    {
      refreshInterval: REFRESH_INTERVAL_MS,
      revalidateOnFocus: true,
      // Keep the last good snapshot on screen while the next poll runs (or
      // fails), so the dashboard never flashes empty on a transient error.
      keepPreviousData: true,
      onSuccess: (next) =>
        setHistory((current) => appendHistoryPoint(current, next, MAX_HISTORY_POINTS)),
    }
  );

  const snapshot = data ?? null;
  const errorMessage = error
    ? snapshot
      ? labels.refreshFailed
      : error instanceof ServerStatusParseError
        ? labels.parseFailed
        : labels.networkUnavailable
    : null;

  return (
    <StatusPageView
      locale={locale}
      snapshot={snapshot}
      history={history}
      isRefreshing={isValidating}
      errorMessage={errorMessage}
      onRefresh={() => void mutate()}
    />
  );
}
