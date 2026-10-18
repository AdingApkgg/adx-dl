import {type ApiClient,okJson} from "@/shared/api-client";
import type {FeaturedState,NoticeDraft,NoticePage,PublicNotice,SiteNotice} from "@/shared/community-site";
export function siteApi(api:ApiClient){
 const site=api.api.v1.site;
 return {
  notices:async(cursor?:string)=>okJson(await site.notices.$get({query:{...(cursor?{cursor}:{})}})) as Promise<NoticePage<PublicNotice>>,
  featured:async()=>okJson(await site.featured.$get()) as Promise<FeaturedState>,
  adminNotices:async(cursor?:string)=>okJson(await site.dash.notices.$get({query:{...(cursor?{cursor}:{})}})) as Promise<NoticePage<SiteNotice>>,
  getNotice:async(id:string)=>okJson(await site.dash.notices[":id"].$get({param:{id}})) as Promise<SiteNotice>,
  adminFeatured:async()=>okJson(await site.dash.featured.$get()) as Promise<FeaturedState>,
  saveNotice:async(id:string,input:{expectedRevision:number;action:"save"|"publish"|"withdraw";draft?:NoticeDraft;confirm:true})=>okJson(await site.dash.notices[":id"].$put({param:{id},json:input})) as Promise<SiteNotice>,
  saveFeatured:async(input:{expectedRevision:number;ids:string[];confirm:true})=>okJson(await site.dash.featured.$put({json:input})) as Promise<FeaturedState>,
 };
}
