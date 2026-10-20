import { useRef } from "react";
import { Link, useNavigate } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { DiscussionDraftBoundary, PrivateDiscussionGuard, loadDiscussion, useDiscussionTask } from "../components/discussion-ui";
import { DiscussionTopicEditor } from "../components/discussion-topic-editor";
import { DiscussionError } from "../components/discussion-ui";
import { PageTitle, textLinkClass } from "../components/page-title";
import { getBrowserApi } from "../lib/browser";
import { discussionApi } from "../queries/discussions";
import type { Route } from "./+types/forum-new";
export { headers, shouldRevalidate } from "../components/discussion-ui";
export function loader({ context, url }: Route.LoaderArgs) { return loadDiscussion(context, url, async api => ({ boards: (await api.boards()).items, chart: /^[1-9]\d{0,18}$/.test(url.searchParams.get("chart") ?? "") ? url.searchParams.get("chart")! : "" }), true); }
export function meta() { return [{ title: `${m.discussion_new()} - ${m.site_name()}` }, { name: "robots", content: "noindex, nofollow" }]; }
export default function ForumNew({ loaderData }: Route.ComponentProps) { const navigate = useNavigate(), task = useDiscussionTask(), created = useRef<string | null>(null); return <PrivateDiscussionGuard userId={loaderData.userId}><DiscussionDraftBoundary><main className="community-reading space-y-6"><Link className={textLinkClass} to={localizeHref("/forum")}>{m.discussion_forum()}</Link><PageTitle description={m.ui_forum_write_hint()}>{m.discussion_new()}</PageTitle><DiscussionTopicEditor boards={loaderData.page.boards} chart={loaderData.page.chart} onSaved={() => { const id = created.current; created.current = null; if (id) void navigate(localizeHref(`/forum/${id}`)); }} onSave={input => task.run(async () => { const saved = await discussionApi(getBrowserApi()).createTopic({ boardId: input.boardId, title: input.title, body: input.body, chartIds: input.chartIds, idempotencyKey: input.idempotencyKey }); created.current = saved.publicId; })} />{task.feedback}</main></DiscussionDraftBoundary></PrivateDiscussionGuard>; }
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DiscussionError error={error} />; }
