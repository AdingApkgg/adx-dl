import { localizeHref } from "@/paraglide/runtime.js";
import { data, redirect, type RouterContextProvider } from "react-router";
import { ApiError } from "@/shared/api-client";
import { apiContext } from "@/shared/router-context";
import { accountErrorRedirect } from "./account-errors";
import { requireUser } from "./require-user";
import { followingApi } from "../queries/following";
export const followingHeaders={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow"};
export const headers=()=>followingHeaders;
export const shouldRevalidate=()=>true;
export async function loadFollowing<T>(context:Readonly<RouterContextProvider>,url:URL,read:(api:ReturnType<typeof followingApi>)=>Promise<T>) {
 try {
  const me=await requireUser(context,url);
  if(me.status!=="active")throw redirect(localizeHref("/account-deletion"),{headers:followingHeaders});
  return data({userId:me.id,page:await read(followingApi(context.get(apiContext)))},{headers:followingHeaders});
 } catch(error) {
  if(error instanceof Response)throw error;
  const target=accountErrorRedirect(error,url.pathname+url.search);if(target)throw redirect(target,{headers:followingHeaders});
  throw data(null,{status:error instanceof ApiError&&error.status<500?error.status:503,headers:followingHeaders});
 }
}
