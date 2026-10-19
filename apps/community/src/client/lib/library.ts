import {data,redirect,type RouterContextProvider} from "react-router";
import {localizeHref} from "@/paraglide/runtime.js";
import {apiContext} from "@/shared/router-context";
import {ApiError} from "@/shared/api-client";
import {requireUser} from "./require-user";
import {accountErrorRedirect} from "./account-errors";
import {libraryApi} from "../queries/library";
export const libraryHeaders={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow"};
export const headers=()=>libraryHeaders,shouldRevalidate=()=>true;
export async function loadLibrary<T>(context:Readonly<RouterContextProvider>,url:URL,read:(api:ReturnType<typeof libraryApi>)=>Promise<T>){try{const me=await requireUser(context,url);if(me.status!=="active")throw redirect(localizeHref("/account-deletion"),{headers:libraryHeaders});return data({userId:me.id,page:await read(libraryApi(context.get(apiContext)))},{headers:libraryHeaders});}catch(error){if(error instanceof Response)throw error;const target=accountErrorRedirect(error,url.pathname+url.search);if(target)throw redirect(target,{headers:libraryHeaders});throw data(null,{status:error instanceof ApiError&&error.status<500?error.status:503,headers:libraryHeaders});}}
