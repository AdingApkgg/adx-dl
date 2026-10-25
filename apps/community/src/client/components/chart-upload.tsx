import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import type { ChartDto } from "@/shared/charts";
import type { SingleSaveTarget, SingleCommit } from "../imports/store";
import { ApiError } from "@/shared/api-client";
import { useImports } from "../imports/provider";
import { ImportStore } from "../imports/store";
import type { ImportSelection } from "../imports/model";
import { accountErrorRedirect } from "../lib/account-errors";
import { chartErrorMessage } from "../lib/chart-errors";
import type { ChartParts } from "../lib/chart-input";
import { readUploadRecords, type UploadRecord, type UploadSnapshot } from "../lib/file-upload";
import { ChartSummary } from "./chart-summary";

export function ChartUpload({ userId, target = {kind:"new"}, onSaved }: { userId: string; target?: SingleSaveTarget; onSaved: (chart: ChartDto, operation: SingleCommit) => Promise<void> }) {
  const id = useId();
  const location = useLocation();
  const lifecycle = useRef(0);
  const fallbackReady = useRef<Promise<void>>(Promise.resolve());
  const imports = useImports();
  const [fallback] = useState(() => new ImportStore());
  const fallbackSnapshot = useSyncExternalStore(fallback.subscribe, fallback.getSnapshot, fallback.getServerSnapshot);
  const sharedStore = imports?.store;
  const store = sharedStore ?? fallback, snapshot = imports?.snapshot ?? fallbackSnapshot;
  const origin = `${location.pathname}${location.search}`;
  const state: UploadSnapshot = snapshot.single?.origin === origin ? snapshot.single.state : {phase:"idle",progress:0};
  const [parts, setParts] = useState<ChartParts>({});
  const [pending, setPending] = useState(false);
  const [records, setRecords] = useState<UploadRecord[]>([]);
  const [resume, setResume] = useState<UploadRecord | null>(null);
  const [error, setError] = useState<unknown>();
  const handleError = (failure: unknown) => {
    const target = accountErrorRedirect(failure, origin);
    if (target) window.location.assign(target); else setError(failure);
  };
  useEffect(() => {
    if(!sharedStore) fallbackReady.current=fallback.activate(userId);
    return () => { if(!sharedStore) fallback.halt(); };
  }, [fallback, sharedStore, userId]);
  useEffect(() => { lifecycle.current++; return () => { lifecycle.current++; }; }, [userId, origin]);
  useEffect(() => { try { setRecords(readUploadRecords(localStorage,userId,"chart-source")); } catch {} }, [userId,state.phase,snapshot.busy]);
  const packing = false;
  const singleConflict=state.error instanceof ApiError&&state.error.code==="CHART_CHANGED";
  const busy = snapshot.scope !== userId || snapshot.busy || pending || Boolean(snapshot.single && snapshot.single.origin !== origin);
  async function choose(selection: ImportSelection) {
    setError(undefined); const owner=lifecycle.current; const record=resume;setResume(null);
    try { if(!sharedStore)await fallbackReady.current;if(owner!==lifecycle.current)return;await store.runSingle(origin,selection,record??undefined); }
    catch(failure) { if(owner===lifecycle.current)handleError(failure); }
  }
  async function discard() {
    const owner=lifecycle.current;setPending(true);setError(undefined);
    try { await store.cancelSingle(origin);if(owner===lifecycle.current){setParts({});setResume(null);} }
    catch(failure) { if(owner===lifecycle.current)handleError(failure); }
    finally { if(owner===lifecycle.current)setPending(false); }
  }
  async function save() {
    const owner=lifecycle.current;setPending(true);setError(undefined);
    try { await store.saveSingle(origin,target,onSaved);if(owner===lifecycle.current)setParts({}); }
    catch(failure) { if(owner===lifecycle.current)handleError(failure); }
    finally { if(owner===lifecycle.current)setPending(false); }
  }
  const status = packing ? m.chart_packing() : state.phase === "processing" ? m.chart_processing() :
    state.phase === "hashing" ? m.avatar_hashing() : state.phase === "uploading" ? m.avatar_uploading() :
    state.phase === "ready" ? m.chart_ready() : null;
  return <section aria-label={m.chart_upload_title()} className="community-panel community-upload-panel space-y-5">
    <h2 className="community-section-title">{m.chart_upload_title()}</h2>
    <p className="text-sm text-muted-foreground">{m.chart_upload_hint()}</p>
    <div className="community-upload-options">
      <div><label htmlFor={`${id}-zip`} className="block text-sm">{resume ? m.avatar_resume({ name: resume.name }) : m.chart_choose_zip()}</label>
        <input id={`${id}-zip`} type="file" accept=".adx,.zip,application/zip" disabled={busy} onChange={(event) => {
          const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files[0]) void choose({ file: files[0] });
        }} /></div>
      <div><label htmlFor={`${id}-folder`} className="block text-sm">{m.chart_choose_folder()}</label>
        <input id={`${id}-folder`} type="file" {...{ webkitdirectory: "", directory: "" }} multiple disabled={busy} onChange={(event) => {
          const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void choose({ folder: files });
        }} /></div>
    </div>
    <fieldset disabled={busy} className="min-w-0 space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{m.chart_parts_title()}</legend>
      <p className="text-sm text-muted-foreground">{m.chart_parts_hint()}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          ["maidata", m.chart_part_maidata(), ".txt"],
          ["audio", m.chart_part_audio(), ".mp3,.ogg,.wav"],
          ["cover", m.chart_part_cover(), ".jpg,.jpeg,.png,.webp"],
          ["video", m.chart_part_video(), ".mp4,.webm"],
        ] as const).map(([role, label, accept]) => <div key={role} className="min-w-0">
          <label htmlFor={`${id}-${role}`} className="block text-sm">{label}</label>
          <input id={`${id}-${role}`} type="file" accept={accept} className="max-w-full" onChange={(event) => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (file) { setParts((current) => ({ ...current, [role]: file })); setError(undefined); }
          }} />
          {parts[role] ? <div className="mt-1 flex items-start gap-2">
            <p className="min-w-0 flex-1 break-all text-sm text-muted-foreground">{parts[role].name}</p>
            <Button variant="outline" aria-label={`${m.chart_part_remove()} ${label}`} onClick={() => {
              setParts((current) => { const next = { ...current }; delete next[role]; return next; }); setError(undefined);
            }}>{m.chart_part_remove()}</Button>
          </div> : null}
        </div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !parts.maidata} onClick={() => void choose({ parts })}>{resume ? m.chart_parts_resume() : m.chart_parts_upload()}</Button>
        <Button variant="outline" disabled={busy || !Object.keys(parts).length} onClick={() => { setParts({}); setError(undefined); }}>{m.chart_parts_clear()}</Button>
      </div>
    </fieldset>
    {records.length && !busy ? <div className="flex flex-wrap gap-2">{records.map((record) => <Button key={record.uploadId} variant="outline" onClick={() => setResume(record)}>
      {m.avatar_resume({ name: record.name })}
    </Button>)}</div> : null}
    {status ? <p role="status">{status}</p> : null}
    {["hashing", "uploading"].includes(state.phase) ? <progress max={1} value={state.progress} className="w-full" aria-label={status ?? m.avatar_uploading()} /> : null}
    {state.file?.chart ? <ChartSummary summary={state.file.chart} /> : null}
    {error || state.error ? <Alert role="alert" variant="destructive">{chartErrorMessage(error ?? state.error)}</Alert> : null}
    {snapshot.single?.target?.kind==="append"?<p>r{snapshot.single.target.expectedRevision}</p>:null}
    {singleConflict?<Button variant="outline" disabled={busy} onClick={()=>{setError(undefined);void store.reconfirmSingle(origin).catch(handleError);}}>{m.author_reconfirm()}</Button>:null}
    <div className="flex gap-2">
      {state.phase === "ready" ? <Button disabled={busy || singleConflict} onClick={() => void save()}>{m.chart_save_private()}</Button> : null}
      {packing || state.phase !== "idle" ? <Button variant="outline" disabled={pending} onClick={() => void discard()}>{m.avatar_cancel()}</Button> : null}
    </div>
  </section>;
}
