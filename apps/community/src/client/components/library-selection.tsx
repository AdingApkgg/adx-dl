import {createContext,useContext,useState,useEffect,type ReactNode} from "react";
import {useQuery} from "@tanstack/react-query";
import {getRenderApi} from "../lib/browser";
import {meQuery} from "../queries/me";
import {m} from "@/paraglide/messages.js";
type Selection={ids:string[];toggle:(id:string)=>void;clear:()=>void};
const Context=createContext<Selection|null>(null);
export function LibrarySelectionProvider({children}:{children:ReactNode}){const {data:me}=useQuery(meQuery(getRenderApi()));const scope=me?.status==='active'?me.id:'anonymous';const [selection,set]=useState<{scope:string;ids:string[]}>({scope,ids:[]});useEffect(()=>set({scope,ids:[]}),[scope]);const ids=selection.scope===scope?selection.ids:[];const toggle=(id:string)=>set(old=>{const all=old.scope===scope?old.ids:[];return {scope,ids:all.includes(id)?all.filter(x=>x!==id):all.length<200?[...all,id]:all};});return <Context.Provider value={{ids,toggle,clear:()=>set({scope,ids:[]})}}>{children}</Context.Provider>;}
export const useLibrarySelection=()=>useContext(Context);
export function ChartSelection({publicId}:{publicId:string}){const selection=useLibrarySelection();if(!selection)return null;return <label className="flex min-h-11 cursor-pointer items-center gap-2 break-all px-3 text-sm"><input type="checkbox" checked={selection.ids.includes(publicId)} disabled={selection.ids.length>=200&&!selection.ids.includes(publicId)} onChange={()=>selection.toggle(publicId)}/>{m.library_select_chart({id:publicId})}</label>;}
