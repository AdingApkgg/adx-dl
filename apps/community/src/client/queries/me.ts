import { type QueryClient, queryOptions } from "@tanstack/react-query";

import { type ApiClient, expectOk } from "@/shared/api-client";

// 当前用户；未登录时是 null（不当成错误，页面据此显示"登录"）。
async function readMe(api: ApiClient) {
  const res = await api.api.v1.me.$get();
  if (res.status === 401) return null;
  return (await expectOk(res)).json();
}
export function meQuery(api: ApiClient) {
  return queryOptions({queryKey:["me"] as const,queryFn:()=>readMe(api)});
}
type Identity=Awaited<ReturnType<typeof readMe>>;
const refreshing=new WeakMap<QueryClient,{requested:number;promise:Promise<Identity>|null}>();
/** Both device queues await the newest identity read; invalidation never accepts an earlier in-flight response. */
export function refreshMe(client:QueryClient,api:ApiClient):Promise<Identity>{
 let state=refreshing.get(client);if(!state){state={requested:0,promise:null};refreshing.set(client,state);}const round=state;++round.requested;
 if(!round.promise)round.promise=(async()=>{try{for(;;){const expected=round.requested;await client.cancelQueries({queryKey:["me"],exact:true});try{const me=await client.fetchQuery({...meQuery(api),staleTime:0});if(expected===round.requested)return me;}catch(error){if(expected===round.requested)throw error;}}}finally{round.promise=null;}})();
 return round.promise;
}
