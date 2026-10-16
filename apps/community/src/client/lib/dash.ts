import type { RouterContextProvider } from "react-router";
import { data } from "react-router";
import { ApiError } from "@/shared/api-client";
import { apiContext } from "@/shared/router-context";
import { m } from "@/paraglide/messages.js";
import { requireUser } from "./require-user";
import { dashApi } from "../queries/dash";

export const dashHeaders = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
export function headers() { return dashHeaders; }
export function shouldRevalidate() { return true; }
export async function loadDash<T>(context: Readonly<RouterContextProvider>, url: URL, read: (api: ReturnType<typeof dashApi>) => Promise<T>) {
  await requireUser(context, url);
  try { return data(await read(dashApi(context.get(apiContext))), { headers: dashHeaders }); }
  catch (error) {
    throw data(null, { status: error instanceof ApiError && error.status < 500 ? error.status : 503, headers: dashHeaders });
  }
}
export function dashDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return m.dash_unknown();
  return `${new Date(value).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}
export function dashBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return m.dash_unknown();
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}
