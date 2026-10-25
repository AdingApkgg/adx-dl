import {createContext,useContext,useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {Link} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import {meQuery,refreshMe} from "../queries/me";
import {getRenderApi} from "../lib/browser";
import {ImportStore,type ImportSnapshot} from "./store";
const Context=createContext<{store:ImportStore;snapshot:ImportSnapshot;actor:string|null}|null>(null);
let current:ImportStore|null=null;
export async function clearDeviceImports(){await current?.clear();}
export function ImportProvider({children}:{children:ReactNode}){
 const [store]=useState(()=>new ImportStore()),[suspended,setSuspended]=useState(false),client=useQueryClient(),{data:me}=useQuery(meQuery(getRenderApi()));
 const identityAttempt=useRef(0);
 const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getServerSnapshot),scope=!suspended&&me?.status==="active"?me.id:null;
 useEffect(()=>{current=store;return()=>{if(current===store)current=null;};},[store]);
 useEffect(()=>{const disconnect=store.connect(()=>{const attempt=++identityAttempt.current;setSuspended(true);void refreshMe(client,getRenderApi()).then(()=>{if(attempt===identityAttempt.current)setSuspended(false);}).catch(()=>{});});return()=>{++identityAttempt.current;disconnect();};},[store,client]);
 useEffect(()=>{void store.activate(scope);},[store,scope,snapshot.scope]);
 const safe=scope&&scope===snapshot.scope?snapshot:store.getServerSnapshot();
 return <Context.Provider value={{store,snapshot:safe,actor:scope}}>{children}{safe.scope&&(safe.rows.some(r=>!["saved","cancelled"].includes(r.phase))||safe.single)?<aside aria-label={m.author_dock()} className="fixed bottom-20 right-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-lg border bg-background p-3 shadow-lg"><Link className="underline" to={safe.single?.origin??localizeHref("/me/imports")}>{m.author_dock()} · {safe.single?1:safe.rows.filter(r=>!["saved","cancelled"].includes(r.phase)).length}</Link>{safe.busy?<button type="button" className="ml-3 underline" onClick={()=>store.pause()}>{m.author_pause()}</button>:null}</aside>:null}</Context.Provider>;
}
export const useImports=()=>useContext(Context);
