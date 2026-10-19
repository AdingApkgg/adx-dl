import { data, redirect, type RouterContextProvider } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import { apiContext } from "@/shared/router-context";
import type { ReportCategory, ReportStatus } from "@/shared/community-social";
import { accountErrorRedirect } from "./account-errors";
import { requireUser } from "./require-user";
import { socialApi } from "../queries/community-social";
export const socialHeaders = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
export function headers() { return socialHeaders; }
export function shouldRevalidate() { return true; }
export async function loadSocial<T>(context: Readonly<RouterContextProvider>, url: URL, read: (api: ReturnType<typeof socialApi>) => Promise<T>) {
  const me = await requireUser(context, url);
  if (me.status !== "active") throw redirect(localizeHref("/account-deletion"));
  try { return data({ page: await read(socialApi(context.get(apiContext))), userId: me.id }, { headers: socialHeaders }); }
  catch (error) {
    const target = accountErrorRedirect(error, url.pathname + url.search);
    if (target) throw redirect(target, { headers: socialHeaders });
    throw data(null, { status: error instanceof ApiError && error.status < 500 ? error.status : 503, headers: socialHeaders });
  }
}
export function socialError(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "";
  if (code === "FAVORITE_LIMIT") return m.favorite_limit();
  if (code === "REPORT_LIMIT") return m.report_limit();
  if (code === "LIBRARY_CHANGED") return m.library_changed();
  if (code === "LIBRARY_LIMIT") return m.library_limit();
  if (code === "LIBRARY_MODERATED") return m.library_moderated();
  if (code === "LIBRARY_ENTRIES_UNAVAILABLE") return m.library_unavailable();
  if (code === "REPORT_CHANGED") return m.report_changed();
  if (code === "REPORT_MODERATION_REQUIRED") return m.report_moderation_required();
  return m.social_unconfirmed();
}
export function reportCategory(category: ReportCategory): string {
  return ({ copyright: m.report_copyright, inappropriate: m.report_inappropriate, broken: m.report_broken, other: m.report_other })[category]();
}
export function reportStatus(status: ReportStatus): string {
  return ({ open: m.report_open, dismissed: m.report_dismissed, actioned: m.report_actioned })[status]();
}
