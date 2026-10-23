import {useState,type FormEvent} from "react";
import {Link,data,useLocation,useRevalidator} from "react-router";
import {Button} from "@astrodx/ui/components/button";
import {m} from "@/paraglide/messages.js";
import {ApiError} from "@/shared/api-client";
import {apiContext} from "@/shared/router-context";
import {siteApi} from "../queries/community-site";
import {getBrowserApi} from "../lib/browser";
import {requireUser,loginHref} from "../lib/require-user";
import {headers as privateHeaders} from "../lib/dash";
import { DashError, DashViewHeading, DashEmpty } from "../components/dash-ui";
import {PrivateDiscussionGuard} from "../components/discussion-ui";
import type {Route} from "./+types/dash-featured";
export {headers,shouldRevalidate} from "../lib/dash";
export async function loader({context,url}:Route.LoaderArgs){const me=await requireUser(context,url);try{return data({userId:me.id,page:await siteApi(context.get(apiContext)).adminFeatured()},{headers:privateHeaders()});}catch(e){throw data(null,{status:e instanceof ApiError?e.status:503,headers:privateHeaders()});}}
export default function Featured({loaderData}:Route.ComponentProps){return <PrivateDiscussionGuard userId={loaderData.userId} admin><FeaturedContent key={loaderData.userId} page={loaderData.page}/></PrivateDiscussionGuard>;}
function FeaturedContent({page}:{page:Route.ComponentProps["loaderData"]["page"]}){
 const [ids,setIds]=useState(page.ids.join("\n")),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState<unknown>();
 const revalidator=useRevalidator(),location=useLocation();
 async function submit(event:FormEvent){event.preventDefault();if(!confirmed||pending)return;setPending(true);setError(undefined);try{
  const selected=ids.split(/[\s,，]+/).filter(Boolean);await siteApi(getBrowserApi()).saveFeatured({expectedRevision:page.revision,ids:selected,confirm:true});setConfirmed(false);await revalidator.revalidate();
 }catch(failure){setConfirmed(false);setError(failure);await revalidator.revalidate();}finally{setPending(false);}}
 return <section className="space-y-4"><DashViewHeading title={m.site_featured()} description={m.site_featured_hint()} /><form className="space-y-3" onSubmit={submit}>
 <label className="block">{m.site_featured_ids()}<textarea className="mt-1 block min-h-36 w-full rounded border bg-background p-2" value={ids} onChange={e=>{setIds(e.target.value);setConfirmed(false);}} disabled={pending} maxLength={150}/></label>
 <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={pending}/>{m.site_confirm()}</label>
 <Button disabled={!confirmed||pending} type="submit">{m.site_save()}</Button></form>
 <ul>{page.ids.map(id=><li key={id} className="py-2">#{id} · {page.items.find(row=>row.publicId===id)?.title??m.site_unavailable()}</li>)}</ul>{!page.ids.length?<DashEmpty/>:null}
 {error?<div role="alert"><p>{error instanceof ApiError&&error.code==="SITE_CHANGED"?m.site_changed():m.site_error()}</p>{error instanceof ApiError&&error.code==="REAUTH_REQUIRED"?<Link className="underline" to={loginHref(location.pathname+location.search,{reauth:"1"})}>{m.site_reauth()}</Link>:null}</div>:null}</section>;
}
export const ErrorBoundary=DashError;
