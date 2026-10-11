import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import type { FileDto } from "@/shared/storage";
import { getBrowserApi } from "../lib/browser";
import { accountErrorRedirect } from "../lib/account-errors";
import { chartErrorMessage } from "../lib/chart-errors";
import { packChartFolder } from "../lib/chart-input";
import { createUploadController, readUploadRecords, type UploadController, type UploadRecord, type UploadSnapshot } from "../lib/file-upload";
import { storageApi } from "../queries/storage";
import { ChartSummary } from "./chart-summary";

export function ChartUpload({ userId, onSave }: { userId: string; onSave: (file: FileDto) => Promise<void> }) {
  const id = useId();
  const location = useLocation();
  const controller = useRef<UploadController | null>(null);
  const packaging = useRef<AbortController | null>(null);
  const lifecycle = useRef(0);
  const [state, setState] = useState<UploadSnapshot>({ phase: "idle", progress: 0 });
  const [packing, setPacking] = useState(false);
  const [pending, setPending] = useState(false);
  const [records, setRecords] = useState<UploadRecord[]>([]);
  const [resume, setResume] = useState<UploadRecord | null>(null);
  const [error, setError] = useState<unknown>();
  const handleError = (failure: unknown) => {
    const target = accountErrorRedirect(failure, `${location.pathname}${location.search}`);
    if (target) window.location.assign(target); else setError(failure);
  };
  useEffect(() => {
    lifecycle.current++;
    let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    try { storage = localStorage; } catch { storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }; }
    setRecords(readUploadRecords(storage, userId, "chart-source"));
    const upload = createUploadController({ purpose: "chart-source", api: storageApi(getBrowserApi()), userId, storage,
      onState: (next) => {
        setState(next); setRecords(readUploadRecords(storage, userId, "chart-source"));
        if (next.error) {
          const target = accountErrorRedirect(next.error, `${location.pathname}${location.search}`);
          if (target) window.location.assign(target);
        }
      },
    });
    controller.current = upload;
    return () => { lifecycle.current++; packaging.current?.abort(); upload.dispose(); controller.current = null; };
  }, [userId, location.pathname, location.search]);
  const busy = packing || pending || ["hashing", "uploading", "processing"].includes(state.phase);
  async function choose(files: File[], folder: boolean) {
    if (!files.length) return;
    setError(undefined);
    const owner = lifecycle.current;
    const aborter = new AbortController();
    packaging.current?.abort(); packaging.current = aborter;
    try {
      setPacking(folder);
      const file = folder ? await packChartFolder(files, aborter.signal) : files[0]!;
      if (aborter.signal.aborted || owner !== lifecycle.current) return;
      setPacking(false);
      const record = resume; setResume(null);
      if (record) await controller.current?.resume(file, record);
      else await controller.current?.start(file);
    } catch (failure) {
      if (!aborter.signal.aborted && owner === lifecycle.current) handleError(failure);
    } finally { if (owner === lifecycle.current) setPacking(false); }
  }
  async function discard() {
    const owner = lifecycle.current;
    packaging.current?.abort(); setPacking(false); setResume(null); setError(undefined);
    setPending(true);
    try {
      if (state.file) {
        await storageApi(getBrowserApi()).deleteFile(state.file.id);
        if (state.uploadId) controller.current?.forget(state.uploadId);
        setRecords((rows) => rows.filter((row) => row.uploadId !== state.uploadId));
        if (owner === lifecycle.current) setState({ phase: "idle", progress: 0 });
      } else await controller.current?.cancel();
    } catch (failure) { if (owner === lifecycle.current) handleError(failure); }
    finally { if (owner === lifecycle.current) setPending(false); }
  }
  async function save() {
    if (!state.file || state.phase !== "ready") return;
    const owner = lifecycle.current; setPending(true); setError(undefined);
    try {
      await onSave(state.file);
      if (owner !== lifecycle.current) return;
      if (state.uploadId) controller.current?.forget(state.uploadId);
      setRecords((rows) => rows.filter((row) => row.uploadId !== state.uploadId));
      setState({ phase: "idle", progress: 0 });
    } catch (failure) { if (owner === lifecycle.current) handleError(failure); }
    finally { if (owner === lifecycle.current) setPending(false); }
  }
  const status = packing ? m.chart_packing() : state.phase === "processing" ? m.chart_processing() :
    state.phase === "hashing" ? m.avatar_hashing() : state.phase === "uploading" ? m.avatar_uploading() :
    state.phase === "ready" ? m.chart_ready() : null;
  return <section aria-label={m.chart_upload_title()} className="space-y-4 rounded-lg border p-4">
    <h2 className="font-semibold">{m.chart_upload_title()}</h2>
    <p className="text-sm text-muted-foreground">{m.chart_upload_hint()}</p>
    <div className="space-y-3">
      <div><label htmlFor={`${id}-zip`} className="block text-sm">{resume ? m.avatar_resume({ name: resume.name }) : m.chart_choose_zip()}</label>
        <input id={`${id}-zip`} type="file" accept=".zip,application/zip" disabled={busy} onChange={(event) => {
          const files = Array.from(event.target.files ?? []); event.target.value = ""; void choose(files, false);
        }} /></div>
      <div><label htmlFor={`${id}-folder`} className="block text-sm">{m.chart_choose_folder()}</label>
        <input id={`${id}-folder`} type="file" {...{ webkitdirectory: "", directory: "" }} multiple disabled={busy} onChange={(event) => {
          const files = Array.from(event.target.files ?? []); event.target.value = ""; void choose(files, true);
        }} /></div>
    </div>
    {records.length && !busy ? <div className="flex flex-wrap gap-2">{records.map((record) => <Button key={record.uploadId} variant="outline" onClick={() => setResume(record)}>
      {m.avatar_resume({ name: record.name })}
    </Button>)}</div> : null}
    {status ? <p role="status">{status}</p> : null}
    {["hashing", "uploading"].includes(state.phase) ? <progress max={1} value={state.progress} className="w-full" aria-label={status ?? m.avatar_uploading()} /> : null}
    {state.file?.chart ? <ChartSummary summary={state.file.chart} /> : null}
    {error || state.error ? <Alert role="alert" variant="destructive">{chartErrorMessage(error ?? state.error)}</Alert> : null}
    <div className="flex gap-2">
      {state.phase === "ready" ? <Button disabled={busy} onClick={() => void save()}>{m.chart_save_private()}</Button> : null}
      {packing || state.phase !== "idle" ? <Button variant="outline" disabled={pending} onClick={() => void discard()}>{m.avatar_cancel()}</Button> : null}
    </div>
  </section>;
}
