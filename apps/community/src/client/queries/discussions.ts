import {getBrowserQueryClient} from "../lib/browser";
import type { ApiClient } from "@/shared/api-client";
import { okJson } from "@/shared/api-client";
import type * as D from "@/shared/discussions";

// Reuse the request-scoped hc transport, including forwarded SSR identity and cookies.
// Concrete segments avoid coupling this adapter to Hono parameter placeholder names.
type Rpc = (args?: { query?: Record<string, string>; json?: unknown }, options?: { init: RequestInit }) => Promise<Response>;
type Node = { [key: string]: unknown };
export function discussionApi(api: ApiClient) {
  async function call<T>(method: string, path: string, body?: unknown, query: Record<string, string | undefined> = {}): Promise<T> {
    let node = api as unknown as Node;
    for (const part of ["api", "v1", "discussions", ...path.split("/").filter(Boolean)]) node = node[part] as Node;
    const params = Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const response = await (node[`$${method}`] as Rpc)({ query: params, ...(body !== undefined ? { json: body } : {}) }, { init: { cache: "no-store", ...(method !== "get" ? { headers: { "content-type": "application/json" } } : {}) } });
    return await okJson(response) as T;
  }
  const segment = (id: string) => encodeURIComponent(id);
  return {
    boards: () => call<{ items: D.DiscussionBoard[] }>("get", "boards"),
    topics: (query: Record<string, string> = {}) => call<D.ForumTopicsPage>("get", "topics", undefined, query),
    topic: (id: string, cursor?: string) => call<D.ForumTopicDetail>("get", `topics/${segment(id)}`, undefined, { cursor }),
    createTopic: (input: D.CreateTopicInput) => call<D.ForumTopic>("post", "topics", input),
    editTopic: (id: string, input: D.EditTopicInput) => call<D.ForumTopic>("patch", `topics/${segment(id)}`, input),
    deleteTopic: (id: string, expectedRevision: number) => call<{ ok: true }>("delete", `topics/${segment(id)}`, { expectedRevision }),
    reply: (id: string, input: D.CreateMessageInput) => call<D.DiscussionMessage>("post", `topics/${segment(id)}/replies`, input),
    topicFocus: (id: string, message: string) => call<D.DiscussionFocus>("get", `topics/${segment(id)}/focus/${segment(message)}`),
    subscribe: (id: string, subscribed: boolean) => call<{ subscribed: boolean }>("put", `topics/${segment(id)}/subscription`, { subscribed }),
    chart: (id: string, versionId: string, difficulty?: string, cursor?: string) => call<D.ChartDiscussion>("get", `charts/${segment(id)}`, undefined, { versionId, difficulty, cursor }),
    chartReply: (id: string, input: D.ChartMessageInput) => call<D.DiscussionMessage>("post", `charts/${segment(id)}/messages`, input),
    chartReplies: (id: string, versionId: string, root: string, cursor: string) => call<D.DiscussionPage<D.DiscussionMessage>>("get", `charts/${segment(id)}/roots/${segment(root)}/replies`, undefined, { versionId, cursor }),
    chartFocus: (id: string, versionId: string, message: string) => call<D.DiscussionFocus>("get", `charts/${segment(id)}/focus/${segment(message)}`, undefined, { versionId }),
    editMessage: (id: string, input: D.EditMessageInput) => call<D.DiscussionMessage>("patch", `messages/${segment(id)}`, input),
    deleteMessage: (id: string, expectedRevision: number) => call<{ ok: true }>("delete", `messages/${segment(id)}`, { expectedRevision }),
    mine: (kind: string, cursor?: string) => call<D.DiscussionPage<D.MyDiscussion>>("get", "me", undefined, { kind, cursor }),
    notifications: (query: Record<string, string> = {}) => call<D.DiscussionPage<D.DiscussionNotification> & { unreadCount: number }>("get", "notifications", undefined, query),
    read: async (ids: string[]) => {const result=await call<{ ok: true }>("post", "notifications/read", { ids });if(typeof window!=="undefined")await getBrowserQueryClient().invalidateQueries({queryKey:["me","notifications","count"]});return result;},
    report: (input: Pick<D.DiscussionReport, "targetType" | "targetId" | "category" | "details">) => call<D.DiscussionReport>("post", "reports", input),
    myReports: (cursor?: string) => call<D.DiscussionPage<D.DiscussionReport>>("get", "me/reports", undefined, { cursor }),
    dash: (query: Record<string, string> = {}) => call<D.DiscussionPage<D.ForumTopic | D.DiscussionMessage>>("get", "dash", undefined, query),
    reports: (query: Record<string, string> = {}) => call<D.DiscussionPage<D.DiscussionReport>>("get", "dash/reports", undefined, query),
    resolve: (id: string, status: "dismissed" | "actioned", note: string) => call<D.DiscussionReport>("post", `dash/reports/${segment(id)}/resolution`, { status, note }),
    moderateTopic: (id: string, input: D.DiscussionModerationInput) => call<{ ok: true }>("post", `dash/topics/${segment(id)}/moderation`, input),
    moderateMessage: (id: string, input: Pick<D.DiscussionModerationInput, "expectedRevision" | "reason" | "publicReason"> & { action: "hide" }) => call<{ ok: true }>("post", `dash/messages/${segment(id)}/moderation`, input),
    board: (id: string, input: Pick<D.DiscussionBoard, "name" | "description" | "order" | "readOnly"> & { expectedRevision: number; reason: string }) => call<{ ok: true }>("patch", `dash/boards/${segment(id)}`, input),
  };
}
