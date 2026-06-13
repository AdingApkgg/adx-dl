"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { StatusPageView } from "@/components/site/status-page-view";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  fetchServerStatus,
  ServerStatusParseError,
  type ServerStatusSnapshot,
} from "@/lib/server-status";

const REFRESH_INTERVAL_MS = 60_000;

export function ServerStatusClient({ locale = "zh" }: { locale?: Locale }) {
  const labels = getDictionary(locale).statusPage;
  const [snapshot, setSnapshot] = useState<ServerStatusSnapshot | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const snapshotRef = useRef<ServerStatusSnapshot | null>(null);

  const load = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const nextSnapshot = await fetchServerStatus();
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setErrorMessage(null);
    } catch (error) {
      if (snapshotRef.current) {
        setErrorMessage(labels.refreshFailed);
      } else if (error instanceof ServerStatusParseError) {
        setErrorMessage(labels.parseFailed);
      } else {
        setErrorMessage(labels.networkUnavailable);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [labels.networkUnavailable, labels.parseFailed, labels.refreshFailed]);

  useEffect(() => {
    const initialLoadId = window.setTimeout(() => {
      void load();
    }, 0);

    const intervalId = window.setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [load]);

  return (
    <StatusPageView
      locale={locale}
      snapshot={snapshot}
      isRefreshing={isRefreshing}
      errorMessage={errorMessage}
      onRefresh={() => void load()}
    />
  );
}
