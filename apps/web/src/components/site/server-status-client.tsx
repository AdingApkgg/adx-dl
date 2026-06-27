"use client";

import { useState } from "react";
import useSWR from "swr";

import { StatusPageView } from "@/components/site/status-page-view";
import { getDictionary, type Locale } from "@/lib/i18n";
import { appendHistoryPoint, type ServerStatusHistoryPoint } from "@/lib/server-status-history";
import {
  fetchServerStatus,
  ServerStatusParseError,
  type ServerStatusSnapshot,
} from "@/lib/server-status";

const REFRESH_INTERVAL_MS = 60_000;
const MAX_HISTORY_POINTS = 24;

export function ServerStatusClient({ locale = "zh" }: { locale?: Locale }) {
  const labels = getDictionary(locale).statusPage;
  // SWR owns the snapshot/loading/error lifecycle; we only keep the rolling
  // history locally since SWR replaces (rather than accumulates) data.
  const [history, setHistory] = useState<ServerStatusHistoryPoint[]>([]);

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
