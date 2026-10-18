import type { ApiClient } from "@/shared/api-client";
import { okJson } from "@/shared/api-client";
import type { FollowInput, FollowingItem, FollowingPage, FollowingUpdate, FollowState } from "@/shared/following";
type Rpc=(args?:{query?:Record<string,string>;json?:unknown},options?:{init:RequestInit})=>Promise<Response>;
type Node={ [key:string]:unknown };
export function followingApi(api:ApiClient) {
 async function call<T>(method:string,path:string,body?:unknown,cursor?:string):Promise<T> {
  let node=api as unknown as Node;
  for(const part of ["api","v1","me","following",...path.split("/").filter(Boolean)])node=node[part] as Node;
  return await okJson(await (node[`$${method}`] as Rpc)({query:cursor?{cursor}:{},...(body!==undefined?{json:body}:{})},{init:{cache:"no-store",...(method!=="get"?{headers:{"content-type":"application/json"}}:{})}})) as T;
 }
 return {state:(id:string)=>call<FollowState>("get",`authors/${encodeURIComponent(id)}`),
  set:(id:string,input:FollowInput)=>call<FollowState>("put",`authors/${encodeURIComponent(id)}`,input),
  list:(cursor?:string)=>call<FollowingPage<FollowingItem>>("get","",undefined,cursor),
  feed:(cursor?:string)=>call<FollowingPage<FollowingUpdate>>("get","feed",undefined,cursor)};
}
