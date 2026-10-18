import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import type { FollowState } from "@/shared/following";
import { getBrowserApi, getBrowserQueryClient, getRenderApi } from "../lib/browser";
import { loginHref } from "../lib/require-user";
import { followingApi } from "../queries/following";
import { meQuery } from "../queries/me";
import { useDiscussionTask } from "./discussion-ui";
export function FollowAuthor({publicId}:{publicId:string}) {
 const {data:me}=useQuery(meQuery(getRenderApi())),location=useLocation();
 const active=me?.status==="active"&&me.publicId!==publicId;
 const relation=useQuery({queryKey:["following","state",me?.id,publicId],enabled:active,staleTime:0,gcTime:0,queryFn:()=>followingApi(getRenderApi()).state(publicId)});
 if(me===undefined)return null;
 if(!me)return <Button variant="outline" size="sm" asChild><Link to={loginHref(location.pathname+location.search)}>{m.following_follow()}</Link></Button>;
 if(me.status!=="active")return null;
 if(me.publicId===publicId)return <Button variant="outline" size="sm" asChild><Link to={localizeHref("/me/following")}>{m.following_manage()}</Link></Button>;
 if(relation.isError)return <div className="space-y-2"><Alert variant="destructive">{m.following_load_failed()}</Alert><Button size="sm" variant="outline" onClick={()=>{void relation.refetch();}}>{m.following_retry()}</Button></div>;
 if(!relation.data)return <Button size="sm" variant="outline" disabled aria-busy>{m.following_loading()}</Button>;
 return <FollowControls key={`${me.id}/${publicId}`} publicId={publicId} state={relation.data} onChanged={()=>{void relation.refetch();}}/>;
}
export function FollowControls({publicId,state,onChanged}:{publicId:string;state:FollowState;onChanged:()=>void}) {
 const task=useDiscussionTask();
 async function save(following:boolean,notify:boolean) {
  if(await task.run(()=>followingApi(getBrowserApi()).set(publicId,{expectedRevision:state.revision,following,notify}))) {
   await getBrowserQueryClient().invalidateQueries({queryKey:["following"]});
   onChanged();
  }
 }
 return <div className="space-y-2"><div className="flex flex-wrap items-center gap-3"><Button size="sm" variant={state.following?"outline":"default"} disabled={task.pending} onClick={()=>{void save(!state.following,false);}}>{state.following?m.following_unfollow():m.following_follow()}</Button>
  {state.following?<label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={state.notify} disabled={task.pending} onChange={event=>{void save(true,event.target.checked);}}/>{m.following_notify()}</label>:null}</div>{task.feedback}</div>;
}
