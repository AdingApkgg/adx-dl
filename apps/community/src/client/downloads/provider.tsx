import {createContext,useContext,useEffect,useState,useSyncExternalStore,type ReactNode} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {meQuery} from "../queries/me";
import {getRenderApi} from "../lib/browser";
import {DownloadStore,type DownloadSnapshot} from "./store";
const Context=createContext<{store:DownloadStore;snapshot:DownloadSnapshot}|null>(null);
let currentStore:DownloadStore|null=null;
export async function clearDeviceDownloads(){await currentStore?.clear();}
export function DownloadProvider({children}:{children:ReactNode}){const [store]=useState(()=>new DownloadStore()),[suspended,setSuspended]=useState(false),queryClient=useQueryClient(),query=meQuery(getRenderApi()),{data:me}=useQuery(query),snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getServerSnapshot);const scope=suspended||me===undefined?null:me===null?'anonymous':me.status==='active'?me.id:'inactive';
 useEffect(()=>{currentStore=store;return()=>{if(currentStore===store)currentStore=null;};},[store]);
 useEffect(()=>store.connect(()=>{setSuspended(true);void queryClient.refetchQueries({queryKey:["me"],exact:true}).finally(()=>setSuspended(false));}),[store,queryClient]);
 useEffect(()=>{if(scope)void store.activate(scope);},[store,scope,snapshot.scope]);
 const safe=scope&&snapshot.scope===scope?snapshot:{scope:null,jobs:[],history:[],persistent:false,busy:false,failure:null};return <Context.Provider value={{store,snapshot:safe}}>{children}</Context.Provider>;
}
export const useDownloads=()=>useContext(Context);
