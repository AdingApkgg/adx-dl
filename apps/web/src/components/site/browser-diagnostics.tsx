"use client";

import * as React from "react";
import { getBrowserCompatibilityCopy } from "@/lib/browser-compatibility-copy";
import { collectBrowserDiagnostics } from "@/lib/browser-diagnostics";
import type { Locale } from "@/lib/i18n";
import { useDownloadsStore, type DownloadJob } from "./downloads/downloads-store";

export function BrowserDiagnostics({ locale, job }: { locale: Locale; job?: DownloadJob }) {
  const copy = getBrowserCompatibilityCopy(locale);
  const unavailable = useDownloadsStore((state) => state.checkpointsUnavailable || state.checkpointsBlocked);
  const [report, setReport] = React.useState<Awaited<ReturnType<typeof collectBrowserDiagnostics>> | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [copyStatus, setCopyStatus] = React.useState("");
  const reportId = React.useId();
  const run = async () => {
    setChecking(true);
    setCopyStatus("");
    try { setReport(await collectBrowserDiagnostics(job, unavailable)); }
    finally { setChecking(false); }
  };
  const text = report ? JSON.stringify(report, null, 2) : "";
  return (
    <div className="min-w-0 space-y-2 text-sm [overflow-wrap:anywhere]">
      <p className="text-xs leading-relaxed text-muted-foreground">{copy.diagnosticHelp}</p>
      <button type="button" disabled={checking} onClick={() => void run()} className="min-h-11 max-w-full rounded-md border border-border px-3 py-2 text-left whitespace-normal focus-visible:outline-2 focus-visible:outline-ring">
        {checking ? copy.checking : copy.diagnostics}
      </button>
      {report ? (
        <>
          {report.storage.downloadBlobRoundTrip !== "ok" || unavailable ? <p role="status" className="rounded-md border border-border p-2">{copy.fallback}</p> : null}
          {!report.capabilities.blobSaveApi ? <p role="status" className="rounded-md border border-border p-2">{copy.saveUnsupported}</p> : null}
          <label htmlFor={reportId} className="block text-xs font-medium">{copy.report}</label>
          <textarea id={reportId} readOnly value={text} rows={8} className="block w-full min-w-0 rounded-md border border-border bg-background p-2 font-mono text-xs" />
          <button type="button" className="min-h-11 max-w-full rounded-md border border-border px-3 py-2 text-left whitespace-normal focus-visible:outline-2 focus-visible:outline-ring" onClick={() => {
            void (async () => {
              try {
                if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
                await navigator.clipboard.writeText(text);
                setCopyStatus(copy.copied);
              } catch { setCopyStatus(copy.manualCopy); }
            })();
          }}>{copy.copy}</button>
          <p role="status" className="text-xs text-muted-foreground">{copyStatus}</p>
        </>
      ) : null}
    </div>
  );
}
