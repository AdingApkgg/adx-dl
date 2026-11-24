import { Button } from "@astrodx/ui/components/button";
import { DownloadIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { canSaveDownloadItem, downloadJobView, formatDownloadBytes } from "../downloads/presentation";
import { useDownloads } from "../downloads/provider";
import { DownloadFailure } from "../downloads/transfer";
import { publicChartDownloadUrl } from "../queries/public-charts";

export function ChartDownloadAction({ publicId, versionId, size }: { publicId: string; versionId: string; size: number }) {
  const downloads = useDownloads();
  const snapshot = downloads?.snapshot;
  const scope = snapshot?.scope;
  const latestRequest = useRef(0);
  const [request, setRequest] = useState<{ scope: string; status: "starting" | "saving" | "saved" | "error"; message?: string }>();
  const current = request?.scope === scope ? request : undefined;
  const job = snapshot?.jobs.find(candidate => candidate.items.length === 1 &&
    candidate.items[0]?.publicId === publicId && candidate.items[0].versionId === versionId);
  const item = job?.items[0];
  const view = job ? downloadJobView(job) : undefined;
  const pending = current?.status === "starting" || current?.status === "saving";
  const needsLatest = item?.status === "changed" || item?.status === "unavailable";
  const canSave = !!(job && item && snapshot && !needsLatest &&
    canSaveDownloadItem(item, job, snapshot.persistent, typeof navigator !== "undefined" && Boolean(navigator.locks)));

  async function run(action: "starting" | "saving") {
    if (!downloads || !scope || pending || (action === "saving" && !job)) return;
    const attempt = ++latestRequest.current;
    setRequest({ scope, status: action });
    try {
      if (action === "starting") {
        const added = await downloads.store.enqueue([publicId], "files", { expectedVersion: versionId });
        if (attempt !== latestRequest.current) return;
        setRequest(added ? undefined : { scope, status: "error", message: m.download_duplicate() });
      } else if (job) {
        await downloads.store.saveItem(job.id, publicId, { preserveQueue: true });
        if (attempt === latestRequest.current) setRequest({ scope, status: "saved" });
      }
    } catch (error) {
      if (attempt !== latestRequest.current) return;
      const code = error instanceof DownloadFailure ? error.code : undefined;
      const message = code === "changed" ? m.ui_download_refresh_chart() : code === "unavailable" ? m.download_unavailable()
        : code === "busy" ? m.ui_download_wait_for_transfer() : m.download_failed();
      setRequest({ scope, status: "error", message });
    }
  }

  const status = current?.status === "starting" ? m.ui_download_starting() :
    current?.status === "saving" ? m.ui_download_saving() :
    current?.status === "saved" && !job ? m.download_save_requested() :
    item?.status === "changed" ? m.ui_download_refresh_chart() :
    item?.status === "unavailable" ? m.download_unavailable() :
    view?.allReady ? (snapshot?.busy ? m.ui_download_wait_for_transfer() : m.download_ready()) :
    view?.stage === "queued" ? m.download_queued() :
    view?.stage === "fetching" ? m.ui_download_transferring({
      received: formatDownloadBytes(view.received), total: formatDownloadBytes(view.total),
    }) : view?.stage === "paused" ? m.download_paused() : view?.needsAttention ? m.download_failed() : "";

  return <div className="min-w-0 basis-full space-y-2">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {scope && downloads ? <>
        {view?.active && job ? (
          <Button type="button" className="min-h-11" onClick={() => downloads.store.pause(job.id)}>
            <PauseIcon aria-hidden="true" />{m.download_pause()}
          </Button>
        ) : canSave && job ? (
          <Button type="button" className="min-h-11" disabled={pending || snapshot?.busy} onClick={() => void run("saving")}>
            <DownloadIcon aria-hidden="true" />{m.download_save_original()}
          </Button>
        ) : job && view?.canResume && !needsLatest ? (
          <Button type="button" className="min-h-11" onClick={() => downloads.store.resume(job.id)}>
            <PlayIcon aria-hidden="true" />{m.download_resume()}
          </Button>
        ) : !job ? (
          <Button type="button" className="min-h-11" disabled={pending} onClick={() => void run("starting")}>
            <DownloadIcon aria-hidden="true" />{m.ui_download_chart()}
          </Button>
        ) : null}
        {!job && size > 0 ? <span className="text-xs tabular-nums text-muted-foreground">ZIP · {formatDownloadBytes(size)}</span> : null}
        <Button asChild variant="ghost" className="min-h-11">
          <a href={publicChartDownloadUrl(publicId)} download>{m.public_chart_download()}</a>
        </Button>
      </> : (
        <Button asChild className="min-h-11">
          <a href={publicChartDownloadUrl(publicId)} download><DownloadIcon aria-hidden="true" />{m.public_chart_download()}</a>
        </Button>
      )}
    </div>
    {view?.active ? <progress className="community-download-progress community-download-inline-progress" aria-label={m.download_progress()} max={view.total || 1} value={view.received} /> : null}
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <span role="status" className="text-muted-foreground empty:sr-only">{status}</span>
      {job || current?.status === "error" ? <Link className="underline underline-offset-2" to={localizeHref("/downloads")}>{m.download_view_queue()}</Link> : null}
    </div>
    {current?.status === "error" ? <p role="alert" className="text-sm">{current.message}</p> : null}
  </div>;
}
