import { z } from "zod";
import type { PublicChartDto } from "./charts";
// biome-ignore lint/suspicious/noControlCharactersInRegex: Deliberately reject control characters before storing untrusted text.
const text = (min: number,max: number) => z.string().refine(s=>[...s.trim()].length>=min && [...s].length<=max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(s));
const translated = (max:number) => z.object({zh:text(1,max),en:text(0,max).optional(),ja:text(0,max).optional()}).strict();
const date = z.string().datetime().transform(value => new Date(value).toISOString()).nullable();
export const noticeDraftSchema = z.object({title:translated(80),body:translated(2000),level:z.enum(["normal","important"]),
  startsAt:date,expiresAt:date,href:z.string().max(300).nullable(),linkLabel:translated(80).nullable(),order:z.number().int().min(0).max(1000),
}).strict().superRefine((d,c)=>{
  if(d.startsAt&&d.expiresAt&&Date.parse(d.startsAt)>=Date.parse(d.expiresAt))c.addIssue({code:"custom",message:"Invalid time range"});
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Deliberately reject control characters before storing untrusted text.
  if(d.href && (!/^\/(?![\/\\])/.test(d.href)||/[\\\u0000-\u0020]/u.test(d.href)))c.addIssue({code:"custom",message:"Internal link required"});
  if(Boolean(d.href)!==Boolean(d.linkLabel))c.addIssue({code:"custom",message:"Link label required"});
});
export type NoticeDraft=z.infer<typeof noticeDraftSchema>;
export type NoticePublication=NoticeDraft&{publishedAt:string};
export type SiteNotice={id:string;revision:number;draft:NoticeDraft;publication:NoticePublication|null;withdrawn:boolean;publicationPending?:boolean};
export type PublicNotice={id:string;publication:NoticePublication};
export type NoticePage<T>={items:T[];nextCursor:string|null};
export type FeaturedState={revision:number;ids:string[];items:PublicChartDto[]};
export function noticeText(value:{zh:string;en?:string;ja?:string},locale:string){const translated=locale==="en"?value.en:locale==="ja"?value.ja:value.zh;return {text:translated?.trim()?translated:value.zh,fallback:locale!=="zh"&&!translated?.trim()};}
