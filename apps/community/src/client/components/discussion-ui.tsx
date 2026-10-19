import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { Textarea } from "@astrodx/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { data, isRouteErrorResponse, Link, redirect, type RouterContextProvider, useBlocker, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import { apiContext, queryClientContext } from "@/shared/router-context";
import type { ChartDifficulty } from "@/shared/charts";
import type { DiscussionAuthor, DiscussionMessage, DiscussionReport, ForumTopic } from "@/shared/discussions";
import { accountErrorRedirect } from "../lib/account-errors";
import { getBrowserApi, getRenderApi } from "../lib/browser";
import { dashDate } from "../lib/dash";
import { loginHref, requireUser } from "../lib/require-user";
import { discussionApi } from "../queries/discussions";
import { meQuery } from "../queries/me";
import { Avatar } from "./avatar";
import { ErrorCard } from "./error-card";
import { publicDifficultyName } from "./public-chart-card";
import { textLinkClass } from "./page-title";

export const discussionHeaders = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
export function headers() { return discussionHeaders; }
export function shouldRevalidate() { return true; }
export async function loadDiscussion<T>(context: Readonly<RouterContextProvider>, url: URL, read: (api: ReturnType<typeof discussionApi>) => Promise<T>, privatePage = false, admin = false) {
  let userId: string | null = null;
  if (!privatePage) { const me = await context.get(queryClientContext).query(meQuery(context.get(apiContext))); userId = me?.id ?? null; }
  if (privatePage) { const me = await requireUser(context, url); if (me.status !== "active") throw redirect(localizeHref("/account-deletion"), { headers: discussionHeaders }); if (admin && !me.isAdmin) throw data(null, { status: 403, headers: discussionHeaders }); userId = me.id; }
  try { return data({ page: await read(discussionApi(context.get(apiContext))), userId }, { headers: discussionHeaders }); }
  catch (error) { const target = accountErrorRedirect(error, url.pathname + url.search); if (target) throw redirect(target, { headers: discussionHeaders }); throw data(null, { status: error instanceof ApiError && error.status < 500 ? error.status : 503, headers: discussionHeaders }); }
}
export function queryParams(url: URL, keys: string[]) { return Object.fromEntries(keys.flatMap(key => url.searchParams.has(key) && url.searchParams.get(key) !== "" ? [[key, url.searchParams.get(key)!]] : [])); }
export const codepoints = (value: string) => Array.from(value.trim()).length;
export function useDiscussionUser() { return useQuery(meQuery(getRenderApi())).data; }
export function PrivateDiscussionGuard({ userId, children, admin = false }: { userId: string | null; children: ReactNode; admin?: boolean }) { const me = useDiscussionUser(); return me && me.id === userId && me.status === "active" && (!admin || me.isAdmin) ? children : null; }
export function useDiscussionTask() {
  const [pending, setPending] = useState(false), [failure, setFailure] = useState<string | null>(null), [reauth, setReauth] = useState(false);
  const location = useLocation(), alive = useRef(true), busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(action: () => Promise<unknown>) {
    if (busy.current) return false; busy.current = true; setPending(true); setFailure(null); setReauth(false);
    try { await action(); return alive.current; }
    catch (error) { if (!alive.current) return false; const target = accountErrorRedirect(error, location.pathname + location.search); if (target) { window.location.assign(target); return false; }
      const status = error instanceof ApiError ? error.status : 0, code = error instanceof ApiError ? error.code : "";
      const fresh = ["REAUTH_REQUIRED", "SESSION_NOT_FRESH"].includes(code); setReauth(fresh);
      setFailure(fresh ? m.dash_reauth() : code === "REPORT_MODERATION_REQUIRED" ? m.discussion_actioned_hint() : status === 409 ? m.discussion_conflict() : status === 429 ? m.discussion_limit() : status === 404 ? m.discussion_unavailable() : status === 400 ? m.discussion_invalid() : status === 403 ? m.discussion_readonly() : m.discussion_unconfirmed()); return false;
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  return { run, pending, failure, feedback: failure ? <Alert variant="destructive">{failure}{reauth ? <> <a href={loginHref(location.pathname + location.search, { reauth: "1" })} className={textLinkClass}>{m.settings_reauth()}</a></> : null}</Alert> : null };
}
const DraftContext = createContext<((token: object, dirty: boolean) => void) | null>(null);
const DraftMemoryContext = createContext<Map<string, unknown> | null>(null);
type ComposerDraft = { body: string; difficulty: string; time: string; subscribed: boolean; key: string | null };
type MessageEditDraft = { revision: number; body: string; difficulty: number | null; timestampMs: number | null };
export function DiscussionDraftBoundary({ children }: { children: ReactNode }) {
  const [, renderDrafts] = useState(0);
  const identity = useDiscussionUser()?.id ?? null, drafts = useRef(new Set<object>()), memory = useRef({ identity, values: new Map<string, unknown>() });
  // Drafts live only on this page and are synchronously isolated on account changes.
  if (memory.current.identity !== identity) { memory.current = { identity, values: new Map() }; drafts.current.clear(); }
  const update = useRef((token: object, active: boolean) => { const previous = drafts.current.has(token); if (active) drafts.current.add(token); else drafts.current.delete(token); if (previous !== active) renderDrafts(value => value + 1); }).current;
  const dirty = useCallback(() => drafts.current.size > 0 || [...memory.current.values.keys()].some(key => (key.startsWith("composer:") || key.startsWith("local:"))), []);
  const blocker = useBlocker(dirty);
  useEffect(() => { if (blocker.state === "blocked") { if (window.confirm(m.discussion_leave())) blocker.proceed(); else blocker.reset(); } }, [blocker]);
  useEffect(() => { const stop = (event: BeforeUnloadEvent) => { if (dirty()) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", stop); return () => window.removeEventListener("beforeunload", stop); }, [dirty]);
  return <DraftContext.Provider value={update}><DraftMemoryContext.Provider value={memory.current.values}>{[...memory.current.values.keys()].some(key => (key.startsWith("composer:") || key.startsWith("local:"))) ? <p role="status" className="text-sm text-muted-foreground">{m.discussion_drafts_retained()}</p> : null}{children}</DraftMemoryContext.Provider></DraftContext.Provider>;
}
export function useUnsavedDiscussion(dirty: boolean) {
  const update = useContext(DraftContext), token = useRef({});
  useEffect(() => { update?.(token.current, dirty); return () => update?.(token.current, false); }, [dirty, update]);
  useEffect(() => { if (!dirty) return; const stop = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", stop); return () => window.removeEventListener("beforeunload", stop); }, [dirty]);
}
export function useDiscussionLocalDraft<T>(key: string, initial: () => T, isDirty: (value: T) => boolean) {
  const memory = useContext(DraftMemoryContext), memoryKey = `local:${key}`;
  const [value, setValue] = useState<T>(() => memory?.has(memoryKey) ? memory.get(memoryKey) as T : initial());
  const dirty = isDirty(value); useUnsavedDiscussion(dirty);
  useEffect(() => { if (!memory) return; if (dirty) memory.set(memoryKey, value); else memory.delete(memoryKey); }, [memory, memoryKey, value, dirty]);
  return [value, setValue] as const;
}
export function DiscussionPager({ nextCursor }: { nextCursor: string | null }) {
  const location = useLocation(), params = new URLSearchParams(location.search), current = params.get("cursor"); params.delete("cursor"); const scope = `${location.pathname}?${params}`;
  const history: string[] = location.state?.discussionScope === scope && Array.isArray(location.state.discussionCursors) ? location.state.discussionCursors.filter((x: unknown) => typeof x === "string" && x.length <= 2048).slice(-100) : [];
  const href = (cursor?: string) => { const p = new URLSearchParams(params); if (cursor) p.set("cursor", cursor); return `${location.pathname}${p.size ? `?${p}` : ""}`; };
  return <nav aria-label={m.social_pagination()} className="flex flex-wrap gap-3">{current ? <Button asChild variant="outline"><Link to={href(history.at(-1))} state={{ discussionScope: scope, discussionCursors: history.slice(0, -1) }}>{m.chart_previous()}</Link></Button> : null}{nextCursor ? <Button asChild variant="outline"><Link to={href(nextCursor)} state={{ discussionScope: scope, discussionCursors: [...history, current ?? ""] }}>{m.chart_next()}</Link></Button> : null}</nav>;
}
export function DiscussionIdentity({ author, publisher = false }: { author: DiscussionAuthor | null; publisher?: boolean }) {
  return author ? <span className="inline-flex min-w-0 flex-wrap items-center gap-2 text-sm"><Avatar id={author.id} name={author.name} image={author.image} size={24} /><Link className="break-words underline" to={localizeHref(`/u/${author.publicId ?? author.id}`)}>{author.name}</Link>{publisher ? <span className="rounded bg-muted px-2 py-1 text-xs">{m.discussion_publisher()}</span> : null}</span> : <span className="text-sm text-muted-foreground">{m.discussion_unavailable()}</span>;
}
export function DiscussionTopicRow({ topic }: { topic: ForumTopic }) {
  return <article className="space-y-2 rounded-xl border p-4"><h2 className="break-words font-semibold"><Link className={textLinkClass} to={localizeHref(`/forum/${topic.publicId}`)}>{topic.state === "visible" ? topic.title : m.discussion_removed()}</Link></h2><div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span>#{topic.publicId}</span>{topic.pin !== null ? <span>{m.discussion_pinned()}</span> : null}{topic.locked ? <span>{m.discussion_locked()}</span> : null}<span>{m.discussion_reply_count({ count: String(topic.replyCount) })}</span><time dateTime={topic.activityAt}>{dashDate(topic.activityAt)}</time></div>{topic.state === "visible" ? <DiscussionIdentity author={topic.author} /> : null}</article>;
}
function discussionDifficultyName(value: number) { return Number.isInteger(value) && value >= 1 && value <= 7 ? publicDifficultyName(value as ChartDifficulty) : m.chart_unsupported(); }
export type Anchor = { difficulty?: number; timestampMs?: number };
export type AnchorRow = { difficulty: number; durationMs: number | null; previewSupported: boolean };
export function DiscussionComposer({ label = m.discussion_reply(), onSubmit, initial = "", initialAnchor = {}, anchors, fixedDifficulty, subscribe = false, onCancel, chartScope, requestScope, draftKey }: { label?: string; onSubmit: (body: string, key: string, anchor: Anchor, subscribe: boolean) => Promise<boolean>; initial?: string; initialAnchor?: Anchor; anchors?: AnchorRow[]; fixedDifficulty?: number | null; subscribe?: boolean; onCancel?: () => void; chartScope?: { id: string; versionId: string }; requestScope?: string; draftKey?: string }) {
  const memory = useContext(DraftMemoryContext), memoryKey = draftKey ? `composer:${draftKey}` : null, retained = memoryKey ? memory?.get(memoryKey) as ComposerDraft | undefined : undefined;
  const [body, setBody] = useState(retained?.body ?? initial), [difficulty, setDifficulty] = useState(retained?.difficulty ?? (initialAnchor.difficulty === undefined ? "" : String(initialAnchor.difficulty))), [time, setTime] = useState(retained?.time ?? (initialAnchor.timestampMs === undefined ? "" : String(initialAnchor.timestampMs))), [subscribed, setSubscribed] = useState(retained?.subscribed ?? false), [pending, setPending] = useState(false);
  const requestId = useId(), previousScope = useRef(requestScope), key = useRef<string | null>(retained?.key ?? null), submitted = useRef(false); const selected = fixedDifficulty !== undefined ? fixedDifficulty : difficulty === "" ? null : Number(difficulty);
  useEffect(() => { if (previousScope.current !== requestScope) { previousScope.current = requestScope; key.current = null; setTime(""); } }, [requestScope]);
  const row = anchors?.find(row => row.difficulty === selected), timeAllowed = !!row?.previewSupported && row.durationMs !== null, count = codepoints(body);
  useEffect(() => {
    if (!chartScope || !timeAllowed) return;
    const received = (event: Event) => { const detail = (event as CustomEvent<{ id: string; versionId: string; difficulty: number; ms: number; requestId: string }>).detail; if (detail?.requestId === requestId && detail.id === chartScope.id && detail.versionId === chartScope.versionId && detail.difficulty === selected && Number.isSafeInteger(detail.ms) && detail.ms >= 0 && detail.ms <= row!.durationMs!) { setTime(String(detail.ms)); key.current = null; submitted.current = false; } };
    window.addEventListener("community-preview-position", received); return () => window.removeEventListener("community-preview-position", received);
  }, [chartScope, selected, timeAllowed, row, requestId]);
  const validTime = time === "" || timeAllowed && /^\d+$/.test(time) && Number.isSafeInteger(Number(time)) && Number(time) <= row!.durationMs!;
  const dirtyInput = !submitted.current && (body !== initial || time !== (initialAnchor.timestampMs === undefined ? "" : String(initialAnchor.timestampMs)) || fixedDifficulty === undefined && difficulty !== (initialAnchor.difficulty === undefined ? "" : String(initialAnchor.difficulty)) || subscribed);
  useUnsavedDiscussion(dirtyInput);
  useEffect(() => { if (!memoryKey || !memory) return; if (dirtyInput) memory.set(memoryKey, { body, difficulty, time, subscribed, key: key.current } satisfies ComposerDraft); else memory.delete(memoryKey); }, [memory, memoryKey, dirtyInput, body, difficulty, time, subscribed, pending]);
  async function submit(event: FormEvent) { event.preventDefault(); if (pending || count < 1 || count > 2000 || !validTime) return; setPending(true); key.current ??= crypto.randomUUID();
    try { if (await onSubmit(body.trim(), key.current, { ...(selected !== null ? { difficulty: selected } : {}), ...(time !== "" ? { timestampMs: Number(time) } : {}) }, subscribed)) { submitted.current = true; if (memoryKey) memory?.delete(memoryKey); setBody(""); setTime(""); key.current = null; } } finally { setPending(false); } }
  function changed() { key.current = null; submitted.current = false; }
  return <form onSubmit={submit} className="space-y-3 rounded-xl border p-4"><label className="grid gap-2 text-sm">{label}<Textarea value={body} onChange={event => { setBody(event.target.value); changed(); }} disabled={pending} required maxLength={4000} rows={4} /></label><p className="text-xs text-muted-foreground">{count}/2000 · {m.discussion_plain()}</p><p className="text-xs text-muted-foreground">{m.discussion_post_limits()}</p>
    {anchors ? <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm">{m.chart_difficulties()}<select className="min-h-11 rounded border bg-background px-2" disabled={pending || fixedDifficulty !== undefined} value={selected ?? ""} onChange={event => { setDifficulty(event.target.value); setTime(""); changed(); }}><option value="">{m.discussion_no_difficulty()}</option>{anchors.map(row => <option value={row.difficulty} key={row.difficulty}>{discussionDifficultyName(row.difficulty)}</option>)}</select></label><label className="grid gap-1 text-sm">{m.discussion_timestamp()}<input className="min-h-11 w-40 rounded border bg-background px-2" type="number" min={0} max={row?.durationMs ?? 0} step={1} value={time} disabled={pending || !timeAllowed} onChange={event => { setTime(event.target.value); changed(); }} /></label><Button type="button" variant="outline" disabled={pending || !timeAllowed || !chartScope} onClick={() => window.dispatchEvent(new CustomEvent("community-preview-position-request", { detail: { ...chartScope, difficulty: selected, requestId } }))}>{m.discussion_current_time()}</Button>{!timeAllowed ? <p className="text-xs text-muted-foreground">{m.discussion_timestamp_disabled()}</p> : null}</div> : null}
    {subscribe ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={subscribed} disabled={pending} onChange={event => { setSubscribed(event.target.checked); changed(); }} />{m.discussion_subscribe_reply()}</label> : null}
    <div className="flex flex-wrap gap-2"><Button disabled={pending || count < 1 || count > 2000 || !validTime}>{pending ? m.dash_submitting() : m.discussion_submit()}</Button>{onCancel ? <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>{m.dash_cancel()}</Button> : null}</div></form>;
}
export function DiscussionReportForm({ targetType, targetId }: { targetType: DiscussionReport["targetType"]; targetId: string }) {
  const [open, setOpen] = useState(false), [done, setDone] = useState(false), [category, setCategory] = useState<DiscussionReport["category"]>("other"), [details, setDetails] = useState(""); const task = useDiscussionTask(), count = codepoints(details);
  if (done) return <p role="status" className="text-sm">{m.report_received()}</p>;
  return <div className="space-y-3"><Button variant="ghost" onClick={() => setOpen(!open)}>{m.discussion_report()}</Button>{open ? <form className="space-y-3 rounded border p-3" onSubmit={async event => { event.preventDefault(); if (count < 1 || count > 500) return; if (await task.run(() => discussionApi(getBrowserApi()).report({ targetType, targetId, category, details: details.trim() }))) { setDone(true); setDetails(""); } }}><p className="text-xs text-muted-foreground">{m.discussion_evidence()}</p><p className="text-xs text-muted-foreground">{m.discussion_report_limits()}</p><label className="grid gap-1 text-sm">{m.report_category()}<select className="min-h-11 rounded border bg-background px-2" disabled={task.pending} value={category} onChange={event => setCategory(event.target.value as typeof category)}>{(["copyright", "inappropriate", "broken", "other"] as const).map(value => <option key={value} value={value}>{({ copyright: m.report_copyright, inappropriate: m.report_inappropriate, broken: m.report_broken, other: m.report_other })[value]()}</option>)}</select></label><label className="grid gap-1 text-sm">{m.report_details()}<Textarea value={details} required maxLength={1000} disabled={task.pending} onChange={event => setDetails(event.target.value)} /></label><p className="text-xs">{count}/500</p><Button disabled={task.pending || count < 1 || count > 500}>{m.report_submit()}</Button>{task.feedback}</form> : null}</div>;
}
export function DiscussionMessageCard({ message, targetType, onChanged, onReply, anchor, anchors, fixedDifficulty, chartScope, editable = true }: { message: DiscussionMessage; targetType: "chart_comment" | "forum_reply"; onChanged: () => void; onReply?: () => void; anchor?: (message: DiscussionMessage) => void; anchors?: AnchorRow[]; fixedDifficulty?: number | null; chartScope?: { id: string; versionId: string }; editable?: boolean }) {
  const memory = useContext(DraftMemoryContext), editKey = `message-edit:${message.id}`, composerKey = `message:${message.id}`, retainedEdit = memory?.get(editKey) as MessageEditDraft | undefined;
  const me = useDiscussionUser(), [editing, setEditing] = useState(!!retainedEdit), [snapshot, setSnapshot] = useState<MessageEditDraft | null>(retainedEdit ?? null), [comparison, setComparison] = useState(false), [confirm, setConfirm] = useState(false), task = useDiscussionTask(); const mine = me?.status === "active" && me.id === message.author?.id;
  function closeEdit() { memory?.delete(editKey); memory?.delete(`composer:${composerKey}`); setEditing(false); setComparison(false); }
  function openEdit() { const value = { revision: message.revision, body: message.body ?? "", difficulty: message.difficulty, timestampMs: message.timestampMs }; memory?.set(editKey, value); setSnapshot(value); setEditing(true); setComparison(false); }
  return <article id={`message-${message.id}`} tabIndex={-1} className="scroll-mt-24 space-y-3 rounded-xl border bg-background p-4 target:ring-2 target:ring-primary">
    {message.state === "visible" ? <><DiscussionIdentity author={message.author} publisher={message.publisher} /><p className="text-xs text-muted-foreground"><time dateTime={message.createdAt}>{dashDate(message.createdAt)}</time>{message.editedAt ? ` · ${m.discussion_edited()}` : ""}</p>{message.quote ? <blockquote className="break-words border-l-2 pl-3 text-xs text-muted-foreground">{message.quote.author.name}: {message.quote.text}</blockquote> : message.replyToId ? <p className="text-xs text-muted-foreground">{m.discussion_reply_unavailable()}</p> : null}
    {message.difficulty !== null ? <p className="text-sm">{discussionDifficultyName(message.difficulty)}{message.timestampMs !== null ? <> · {message.locatable && anchor ? <Button variant="link" onClick={() => anchor(message)}>{formatTimestamp(message.timestampMs)}</Button> : <span>{formatTimestamp(message.timestampMs)} · {m.discussion_unlocatable()}</span>}</> : null}</p> : null}
    {editing && snapshot ? <div className="space-y-3"><DiscussionComposer draftKey={composerKey} initial={snapshot.body} initialAnchor={{ ...(snapshot.difficulty !== null ? { difficulty: snapshot.difficulty } : {}), ...(snapshot.timestampMs !== null ? { timestampMs: snapshot.timestampMs } : {}) }} anchors={anchors} fixedDifficulty={fixedDifficulty} chartScope={chartScope} label={m.discussion_edit()} onCancel={closeEdit} onSubmit={async (body, _key, anchor) => { const ok = await task.run(() => discussionApi(getBrowserApi()).editMessage(message.id, { expectedRevision: snapshot.revision, body, ...(anchors ? { difficulty: anchor.difficulty ?? null, timestampMs: anchor.timestampMs ?? null } : {}) })); if (ok) { closeEdit(); onChanged(); } else setComparison(true); return ok; }} />
      <Button type="button" variant="outline" disabled={task.pending} onClick={() => { setComparison(true); onChanged(); }}>{m.discussion_compare_latest()}</Button>
      {comparison ? <section className="space-y-3 rounded border p-3"><p className="text-sm">{m.discussion_revision_compare({ expected: String(snapshot.revision), latest: String(message.revision) })}</p><p className="whitespace-pre-wrap break-words text-sm">{message.body}</p><Button type="button" variant="outline" disabled={task.pending || message.revision <= snapshot.revision} onClick={() => { const next = { ...snapshot, revision: message.revision }; memory?.set(editKey, next); setSnapshot(next); setComparison(false); }}>{m.discussion_keep_draft_revision()}</Button></section> : null}
    </div> : <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>}

    <div className="flex flex-wrap items-start gap-2">{onReply && me?.status === "active" ? <Button variant="outline" onClick={onReply}>{m.discussion_reply()}</Button> : null}{mine ? <><Button variant="ghost" disabled={!editable} onClick={() => editing ? closeEdit() : openEdit()}>{m.discussion_edit()}</Button><Button variant="ghost" onClick={() => setConfirm(!confirm)}>{m.discussion_delete()}</Button></> : null}{me?.status === "active" ? <DiscussionReportForm targetType={targetType} targetId={message.id} /> : null}<a className="inline-flex min-h-11 items-center text-sm underline" href={`#message-${message.id}`}>{m.discussion_permalink()}</a></div>
    {confirm ? <div className="space-y-2 rounded border p-3"><p className="text-sm">{m.discussion_delete_confirm()}</p><Button variant="destructive" disabled={task.pending} onClick={async () => { if (await task.run(() => discussionApi(getBrowserApi()).deleteMessage(message.id, message.revision))) { setConfirm(false); onChanged(); } }}>{m.discussion_delete()}</Button></div> : null}</> : <p className="text-sm text-muted-foreground">{m.discussion_unavailable()}</p>}{task.feedback}</article>;
}
export function formatTimestamp(ms: number) { return `${Math.floor(ms / 60000).toString().padStart(2, "0")}:${Math.floor(ms / 1000 % 60).toString().padStart(2, "0")}.${Math.floor(ms % 1000).toString().padStart(3, "0")}`; }
export function DiscussionSignIn() { const location = useLocation(); return <Link className={textLinkClass} to={loginHref(location.pathname + location.search)}>{m.social_login()}</Link>; }

export function safeDiscussionHref(href: string | null): string | null {
  if (href === "/me/library?view=reports") return `${localizeHref("/me/library")}?view=reports`;
  if (href === "/me/reports") return localizeHref("/me/reports");
  if (href === "/me/discussions?kind=reports") return `${localizeHref("/me/discussions")}?kind=reports`;
  if (!href || !/^\/(?:forum\/[1-9]\d{0,18}|charts\/[1-9]\d{0,18})(?:#message-[A-Za-z0-9_-]{1,100})?$/.test(href)) return null;
  return localizeHref(href);
}

export function DiscussionError({ error }: { error: unknown }) {
  const location = useLocation();
  if (isRouteErrorResponse(error) && error.status === 409) { const params = new URLSearchParams(location.search); params.delete("cursor"); return <main className="space-y-4"><Alert variant="destructive">{m.discussion_conflict()}</Alert><Button asChild variant="outline"><Link to={`${location.pathname}${params.size ? `?${params}` : ""}`} replace>{m.discussion_reload()}</Link></Button></main>; }
  return <ErrorCard error={error} />;
}
