import {useQuery} from "@tanstack/react-query";
import {Link} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import {okJson} from "@/shared/api-client";
import {getRenderApi} from "../lib/browser";
import {meQuery} from "../queries/me";
export function NotificationIndicator(){
 const api=getRenderApi(),{data:me}=useQuery(meQuery(api));
 const {data:count}=useQuery({queryKey:["me","notifications","count",me?.id],enabled:Boolean(me&&me.status==="active"),staleTime:60000,
  queryFn:async()=>{const result=await okJson(await api.api.v1.discussions.notifications.$get({query:{unread:"true"}}));return result.unreadCount;}});
 return me?.status==="active"?<Link className="inline-flex min-h-11 shrink-0 items-center gap-1 underline-offset-4 hover:underline" to={localizeHref("/me/notifications")}>{m.site_notifications()}{count?<span aria-label={m.site_unread({count:String(count)})} className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">{count>99?"99+":count}</span>:null}</Link>:null;
}
