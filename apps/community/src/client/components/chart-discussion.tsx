import { Button } from "@astrodx/ui/components/button";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useRevalidator } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import type { ChartImportSummary } from "@/shared/charts";
import type { ChartDiscussion as ChartDiscussionDto, DiscussionMessage } from "@/shared/discussions";
import { getBrowserApi } from "../lib/browser";
import { discussionApi } from "../queries/discussions";
import { DiscussionComposer, DiscussionDraftBoundary, DiscussionMessageCard, DiscussionSignIn, DiscussionTopicRow, useDiscussionTask, useDiscussionUser } from "./discussion-ui";
import { publicDifficultyName } from "./public-chart-card";

export function ChartDiscussion(props: { chartId: string; versionId: string; summary: ChartImportSummary }) { return <DiscussionDraftBoundary><ChartDiscussionContent key={props.chartId} {...props} /></DiscussionDraftBoundary>; }
function ChartDiscussionContent({ chartId, versionId, summary }: { chartId: string; versionId: string; summary: ChartImportSummary }) {
  const me = useDiscussionUser(), location = useLocation(), revalidator = useRevalidator(), task = useDiscussionTask();
  const [navigation, setNavigation] = useState<{ versionId: string; scope: string; cursor: string | undefined; history: (string | undefined)[] }>({ versionId, scope: "", cursor: undefined, history: [] });
  const scope = summary.difficulties.some(row => String(row.difficulty) === navigation.scope) ? navigation.scope : "";
  const currentNavigation = navigation.versionId === versionId && navigation.scope === scope;
  // Derive a first-page request synchronously; an effect alone would briefly send the old cursor.
  const cursor = currentNavigation ? navigation.cursor : undefined, history = currentNavigation ? navigation.history : [];
  const [refresh, setRefresh] = useState(0), [page, setPage] = useState<ChartDiscussionDto | null>(null), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
  const [reply, setReply] = useState<{ root: DiscussionMessage; target: DiscussionMessage } | null>(null), [draftVersion, setDraftVersion] = useState(versionId), [focus, setFocus] = useState<DiscussionMessage[] | null>(null), [focusFailed, setFocusFailed] = useState(false);
  const [focusedVersion, setFocusedVersion] = useState(versionId), [loadedKey, setLoadedKey] = useState("");
  const focusScope = useRef({ versionId, ignoredHash: "" });
  const activeFocus = focusedVersion === versionId ? focus : null;
  const versionChanged = draftVersion !== versionId;
  const identity = me?.id ?? "anonymous", readKey = JSON.stringify([versionId, scope, cursor ?? null, identity]);
  const visible = page?.versionId === versionId && loadedKey === readKey ? page : null;
  const changed = () => { setFocus(null); setRefresh(value => value + 1); };
  useEffect(() => { if (!currentNavigation) setNavigation({ versionId, scope, cursor: undefined, history: [] }); }, [currentNavigation, versionId, scope]);
  useEffect(() => { let alive = true; setLoading(true); setFailed(false);
    discussionApi(getBrowserApi()).chart(chartId, versionId, scope || undefined, cursor).then(value => { if (alive) { setPage(value); setLoadedKey(readKey); } }).catch(error => { if (alive) { setFailed(true); if (error instanceof ApiError && [401, 403, 404].includes(error.status)) setPage(null); } }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; };
  }, [chartId, versionId, scope, cursor, refresh, identity, readKey]);
  useEffect(() => { let alive = true; setFocus(null); setFocusFailed(false);
    if (focusScope.current.versionId !== versionId) { focusScope.current = { versionId, ignoredHash: location.hash }; return; }
    if (focusScope.current.ignoredHash === location.hash) return;
    const id = location.hash.match(/^#message-([A-Za-z0-9_-]{1,100})$/)?.[1]; if (!id) return;
    discussionApi(getBrowserApi()).chartFocus(chartId, versionId, id).then(value => { if (!alive) return; const root = value.root; setFocusedVersion(versionId); setFocus(root ? [{ ...root, replies: value.messages.filter(row => row.id !== root.id), repliesCursor: null }] : value.messages); requestAnimationFrame(() => document.getElementById(`message-${value.focusId}`)?.focus()); }).catch(() => { if (alive) setFocusFailed(true); }); return () => { alive = false; };
  }, [chartId, versionId, location.hash, refresh]);
  function anchor(message: DiscussionMessage) { if (!message.locatable || message.difficulty === null || message.timestampMs === null) return; const row = summary.difficulties.find(row => row.difficulty === message.difficulty); if (!row?.previewSupported || row.durationMs === null || message.timestampMs > row.durationMs) return; window.dispatchEvent(new CustomEvent("community-preview-seek", { detail: { id: chartId, versionId, difficulty: message.difficulty, ms: message.timestampMs } })); }
  const rows = activeFocus ?? visible?.items ?? [];
  return <section id="chart-discussion" className="space-y-5"><h2 className="text-xl font-semibold">{m.discussion_comments()}{visible ? ` · ${visible.count}` : ""}</h2><p className="text-sm text-muted-foreground">{m.discussion_version_hint()}</p>
    <label className="grid max-w-xs gap-1 text-sm">{m.chart_difficulties()}<select value={scope} className="min-h-11 rounded border bg-background px-3" onChange={event => { setNavigation({ versionId, scope: event.target.value, cursor: undefined, history: [] }); focusScope.current.ignoredHash = location.hash; setFocus(null); setFocusFailed(false); }}><option value="">{m.discussion_all_difficulties()}</option>{summary.difficulties.map(row => <option key={row.difficulty} value={row.difficulty}>{publicDifficultyName(row.difficulty)}</option>)}</select></label>
    {loading ? <p role="status">{m.discussion_loading()}</p> : null}{failed ? <div role="alert" className="space-y-3"><p>{m.discussion_conflict()}</p><Button variant="outline" onClick={() => { setNavigation({ versionId, scope, cursor: undefined, history: [] }); focusScope.current.ignoredHash = location.hash; setFocusFailed(false); changed(); void revalidator.revalidate(); }}>{m.discussion_reload()}</Button></div> : null}{focusFailed ? <p role="alert">{m.discussion_focus_unavailable()}</p> : null}{activeFocus ? <Button variant="outline" onClick={() => { focusScope.current.ignoredHash = location.hash; setFocus(null); }}>{m.discussion_show_page()}</Button> : null}
    <div className="space-y-4">{rows.map(root => <ChartRoot key={`${identity}/${versionId}/${root.id}`} root={root} chartId={chartId} versionId={versionId} anchors={summary.difficulties} onChanged={changed} onReply={target => { setReply({ root, target }); requestAnimationFrame(() => document.getElementById("chart-discussion-composer")?.scrollIntoView({ block: "center" })); }} anchor={anchor} />)}{!loading && !failed && visible && !rows.length ? <p>{m.discussion_empty()}</p> : null}</div>
    {!activeFocus ? <nav aria-label={m.social_pagination()} className="flex flex-wrap gap-3">{cursor ? <Button variant="outline" onClick={() => { setNavigation({ versionId, scope, cursor: history.at(-1), history: history.slice(0, -1) }); }}>{m.chart_previous()}</Button> : null}{visible?.nextCursor ? <Button variant="outline" onClick={() => { setNavigation({ versionId, scope, cursor: visible.nextCursor!, history: [...history, cursor].slice(-100) }); }}>{m.chart_next()}</Button> : null}</nav> : null}
    {me?.status === "active" ? <div id="chart-discussion-composer" className="scroll-mt-24 space-y-3">{versionChanged ? <div role="alert" className="space-y-2 rounded-xl border p-4"><p>{m.discussion_version_changed()}</p><Button variant="outline" onClick={() => { if (window.confirm(m.discussion_version_confirm())) { setDraftVersion(versionId); setReply(null); } }}>{m.discussion_use_version()}</Button></div> : null}{reply && !versionChanged ? <p className="text-sm">{m.discussion_reply_to({ name: reply.target.author?.name ?? m.discussion_unavailable() })}<Button variant="ghost" onClick={() => setReply(null)}>{m.dash_cancel()}</Button></p> : null}
      <DiscussionComposer key={`${me.id}/${draftVersion}`} requestScope={reply?.target.id ?? "root"} anchors={summary.difficulties} chartScope={{ id: chartId, versionId: draftVersion }} fixedDifficulty={reply ? reply.root.difficulty : undefined} onSubmit={async (body, idempotencyKey, anchor) => { if (versionChanged) { await task.run(async () => { throw new ApiError(409, "VERSION_CHANGED", ""); }); return false; } const ok = await task.run(() => discussionApi(getBrowserApi()).chartReply(chartId, { versionId: draftVersion, body, idempotencyKey, ...anchor, ...(reply ? { rootId: reply.root.id, replyToId: reply.target.id } : {}) })); if (ok) { setReply(null); changed(); } return ok; }} />{task.feedback}</div> : <DiscussionSignIn />}
    <section className="space-y-3"><h3 className="font-semibold">{m.discussion_related()}</h3>{visible?.relatedTopics.map(topic => <DiscussionTopicRow key={topic.id} topic={topic} />)}<div className="flex flex-wrap gap-4"><Link className="underline" to={`${localizeHref("/forum")}?chart=${encodeURIComponent(chartId)}`}>{m.discussion_more_topics()}</Link><Link className="underline" to={`${localizeHref("/forum/new")}?chart=${encodeURIComponent(chartId)}`}>{m.discussion_expand()}</Link></div><p className="text-xs text-muted-foreground">{m.discussion_chart_link_hint()}</p></section>
  </section>;
}
function ChartRoot({ root, chartId, versionId, anchors, onChanged, onReply, anchor }: { root: DiscussionMessage; chartId: string; versionId: string; anchors: ChartImportSummary["difficulties"]; onChanged: () => void; onReply: (message: DiscussionMessage) => void; anchor: (message: DiscussionMessage) => void }) {
  const [replyPage, setReplyPage] = useState<{ root: DiscussionMessage; items: DiscussionMessage[]; cursor: string | null }>({ root, items: [], cursor: root.repliesCursor ?? null }), task = useDiscussionTask(), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const extra = replyPage.root === root ? replyPage.items : [], cursor = replyPage.root === root ? replyPage.cursor : root.repliesCursor ?? null;
  const initial = root.replies ?? [], seen = new Set(initial.map(row => row.id)), replies = [...initial, ...extra.filter(row => !seen.has(row.id))];
  return <div className="space-y-3"><DiscussionMessageCard message={root} targetType="chart_comment" onChanged={onChanged} onReply={() => onReply(root)} anchor={anchor} anchors={anchors} chartScope={{ id: chartId, versionId }} /><div className="ml-3 space-y-3 border-l pl-3 sm:ml-6">{replies.map(message => <DiscussionMessageCard key={message.id} message={message} targetType="chart_comment" onChanged={onChanged} onReply={() => onReply(message)} anchor={anchor} anchors={anchors} fixedDifficulty={root.difficulty} chartScope={{ id: chartId, versionId }} />)}{cursor ? <Button variant="outline" disabled={task.pending} onClick={() => void task.run(async () => { const next = await discussionApi(getBrowserApi()).chartReplies(chartId, versionId, root.id, cursor); if (alive.current) { setReplyPage(value => ({ root, items: [...(value.root === root ? value.items : []), ...next.items], cursor: next.nextCursor })); } })}>{m.discussion_more_replies()}</Button> : null}{task.feedback}</div></div>;
}
