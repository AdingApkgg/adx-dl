import {BellIcon} from "lucide-react";
import {useQuery} from "@tanstack/react-query";
import {Link} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import {okJson} from "@/shared/api-client";
import {getRenderApi} from "../lib/browser";
import {meQuery} from "../queries/me";
export function NotificationIndicator({compact=false}:{compact?:boolean}){
 const api=getRenderApi(),{data:me}=useQuery(meQuery(api));
 const {data:count}=useQuery({queryKey:["me","notifications","count",me?.id],enabled:Boolean(me&&me.status==="active"),staleTime:60000,
  queryFn:async()=>{const result=await okJson(await api.api.v1.discussions.notifications.$get({query:{unread:"true"}}));return result.unreadCount;}});
 return me?.status==="active"?<Link aria-label={m.site_notifications()} title={m.site_notifications()} className={`relative inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-lg hover:bg-muted ${compact?"w-11":"px-2"}`} to={localizeHref("/me/notifications")}>{compact?<BellIcon aria-hidden="true" className="size-4"/>:m.site_notifications()}{count?<span role="status" aria-label={m.site_unread({count:String(count)})} className={compact?"absolute right-0.5 top-0.5 rounded-full bg-primary px-1 text-[10px] text-primary-foreground":"rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground"}>{count>99?"99+":count}</span>:null}</Link>:null;
}
