import { governanceQuerySchema, type GovernanceQuery } from "@/shared/governance";
import { data, redirect, type RouterContextProvider } from "react-router";
import { ApiError } from "@/shared/api-client";
import { apiContext } from "@/shared/router-context";
import { localizeHref } from "@/paraglide/runtime.js";
import { m } from "@/paraglide/messages.js";
import { requireUser, loginHref } from "./require-user";
import { dashHeaders } from "./dash";
import { governanceApi } from "../queries/governance";
export async function loadGovernance<T>(context:Readonly<RouterContextProvider>,url:URL,read:(api:ReturnType<typeof governanceApi>)=>Promise<T>){
 const me=await requireUser(context,url);if(me.status!=="active")throw redirect(localizeHref('/account-deletion'));
 try{return data({userId:me.id,page:await read(governanceApi(context.get(apiContext)))},{headers:dashHeaders});}
 catch(error){if(error instanceof ApiError&&error.status===401)throw redirect(loginHref(url.pathname+url.search),{headers:dashHeaders});throw data(null,{status:error instanceof ApiError&&error.status<500?error.status:503,headers:dashHeaders});}
}
export function governanceError(error:unknown){if(error instanceof ApiError){if(error.code==='GOVERNANCE_LIMIT')return m.governance_limit();if(error.code==='GOVERNANCE_CHANGED')return m.governance_changed();if(error.code==='REAUTH_REQUIRED')return m.dash_reauth();}return m.governance_unconfirmed();}

export function governanceFilters(url:URL,keys:(keyof GovernanceQuery)[]):GovernanceQuery{const raw=Object.fromEntries(keys.flatMap(k=>{const v=url.searchParams.get(k);return v?[[k,v]]:[];}));const parsed=governanceQuerySchema.safeParse(raw);if(!parsed.success)throw data(null,{status:400,headers:dashHeaders});return parsed.data;}
