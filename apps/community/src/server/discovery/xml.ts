import {StorageUnavailableError} from "../storage/errors";
import {sql} from 'drizzle-orm';
import {isPublicChartId} from '@/shared/chart-public-id';
import type {StorageContext} from '../storage/contracts';
import {entityRelation} from './visibility';
import {snapshot,groupSavepoint,rows,invalid} from './query';
import type {SearchType} from '@/shared/discovery-search';
export function xmlEscape(v:string):string{return v.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');}
const types=['charts','lists','authors'] as const;
const route=(type:typeof types[number])=>type==='authors'?'u':type;
const wrap=(tag:string,rows:string)=>`<?xml version="1.0" encoding="UTF-8"?><${tag} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows}</${tag}>`;
export async function sitemapIndex(ctx:StorageContext,origin:string):Promise<string> {
 return snapshot(ctx,async(tx,deadline)=>{const links=[`${origin}/sitemaps/static.xml`];for(const type of types){const rr=await groupSavepoint(tx,type,deadline,()=>rows<{bucket:string}>(tx.db,sql`select distinct ((public_id::bigint-1)/1000)::text bucket from (${entityRelation(tx,type)}) c order by bucket`));if(!rr)throw new StorageUnavailableError();for(const r of rr)links.push(`${origin}/sitemaps/${type}-${r.bucket}.xml`);}return wrap('sitemapindex',links.map(h=>`<sitemap><loc>${xmlEscape(h)}</loc></sitemap>`).join(''));});
}
export async function sitemapPart(ctx:StorageContext,origin:string,name:string):Promise<string> {
 if(name==='static.xml')return wrap('urlset',['/','/charts','/discover','/authors','/tags','/lists','/forum','/notices','/help'].flatMap(p=>['','/en','/ja'].map(l=>`<url><loc>${xmlEscape(origin+l+(p==='/'?(l?'':'/'):p))}</loc></url>`)).join(''));
 const m=/^(charts|lists|authors)-(0|[1-9]\d{0,15})\.xml$/.exec(name);if(!m||BigInt(m[2])>9223372036854775n)throw invalid();
 const type=m[1] as typeof types[number],start=BigInt(m[2])*1000n+1n,end=start+999n;
 return snapshot(ctx,async tx=>{const rr=await rows<{public_id:string}>(tx.db,sql`select public_id from (${entityRelation(tx,type)}) c where public_id::bigint between ${start.toString()}::numeric and ${end.toString()}::numeric order by public_id::bigint limit 1000`);return wrap('urlset',rr.map(r=>`<url><loc>${xmlEscape(`${origin}/${route(type)}/${r.public_id}`)}</loc></url>`).join(''));});
}
export async function publicFeed(ctx:StorageContext,origin:string):Promise<string> {
 return snapshot(ctx,async tx=>{const rr=await rows<{public_id:string;title:string;description:string}>(tx.db,sql`select public_id,title,description from (${entityRelation(tx,'charts')}) c order by public_id::bigint desc limit 30`);
 return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>ADXC</title><link>${xmlEscape(origin)}</link><description>ADXC public charts</description>${rr.map(r=>{const url=`${origin}/charts/${r.public_id}`;return `<item><title>${xmlEscape(r.title)}</title><description>${xmlEscape(r.description)}</description><link>${xmlEscape(url)}</link><guid isPermaLink="true">${xmlEscape(url)}</guid></item>`;}).join('')}</channel></rss>`;});
}
