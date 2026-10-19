import {data,Form,Link} from "react-router";
import {Button} from "@astrodx/ui/components/button";
import {Input} from "@astrodx/ui/components/input";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import {apiContext} from "@/shared/router-context";
import {ApiError} from "@/shared/api-client";
import {libraryApi} from "../queries/library";
import {PageTitle} from "../components/page-title";
import {PublicListCard,LibraryPager} from "../components/library-ui";
import {ErrorCard} from "../components/error-card";
import {canonicalLink,localeAlternates,originFrom} from "../lib/seo";
import type {Route} from "./+types/public-lists";
export {headers,shouldRevalidate} from "./public-charts";
export async function loader({context,url}:Route.LoaderArgs){try{return data(await libraryApi(context.get(apiContext)).publicLists(Object.fromEntries(url.searchParams)),{headers:{'Cache-Control':'private, no-store'}});}catch(e){throw data(null,{status:e instanceof ApiError&&e.status<500?e.status:503});}}
export function meta({matches,location}:Route.MetaArgs){return [{title:m.library_public_title()},canonicalLink(originFrom(matches),location.pathname),...localeAlternates(originFrom(matches),location.pathname),...(location.search?[{name:'robots',content:'noindex'}]:[])];}
export default function PublicLists({loaderData}:Route.ComponentProps){return <main className="space-y-6"><PageTitle description={m.library_public_hint()}>{m.library_public_title()}</PageTitle><Link className="underline" to={localizeHref('/me/library')}>{m.library_title()}</Link><Form method="get" className="flex flex-wrap items-end gap-3"><label className="grid min-w-0 flex-1 gap-1">{m.library_find()}<Input name="q" maxLength={120}/></label><label className="grid gap-1">{m.library_author_number()}<Input name="author" inputMode="numeric"/></label><Button>{m.library_search()}</Button></Form>{loaderData.items.length?<ul className="grid gap-4 sm:grid-cols-2">{loaderData.items.map(list=><li key={list.publicId}><PublicListCard list={list}/></li>)}</ul>:<p>{m.library_public_empty()}</p>}<LibraryPager nextCursor={loaderData.nextCursor}/></main>;}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <ErrorCard error={error}/>;}
