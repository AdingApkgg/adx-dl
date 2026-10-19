import {data,type RouterContextProvider} from "react-router";
import {dehydrate} from "@tanstack/react-query";
import {ApiError} from "@/shared/api-client";
import {apiContext,queryClientContext} from "@/shared/router-context";
import {requireUser} from "../lib/require-user";
import {authorChartQuery} from "../queries/charts";
import {reviewSelection,compareSelection} from "./route-selection";
export async function loadAuthorChart(context:Readonly<RouterContextProvider>,url:URL,id:string,mode:"review"|"compare"){
 const me=await requireUser(context,url),client=context.get(queryClientContext);
 try{const chart=await client.query(authorChartQuery(context.get(apiContext),me.id,id));try{if(mode==="review")reviewSelection(chart,url.searchParams);else compareSelection(chart,url.searchParams);}catch{throw data(null,{status:404});}}
 catch(error){if(error instanceof ApiError&&error.status===404)throw data(null,{status:404});throw error;}
 return {actor:me.id,dehydratedState:dehydrate(client)};
}
