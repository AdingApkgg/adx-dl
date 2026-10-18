import { expect, test } from "bun:test";
import { sameNoticeDraft, noticeDraftSchema, noticeText, type NoticeDraft } from "./community-site";
import { communityContentFact } from "./community-content-journal";
const draft = (): NoticeDraft => ({title:{zh:"公告"},body:{zh:"正文"},level:"normal",startsAt:null,expiresAt:null,href:null,linkLabel:null,order:0});
test("notice times normalize before snapshots and reject inverted schedules", () => {
  const value=noticeDraftSchema.parse({...draft(),startsAt:"2026-10-18T00:00:00Z",expiresAt:"2026-10-18T00:00:00.1Z"});
  expect(value.startsAt).toBe("2026-10-18T00:00:00.000Z");
  expect(value.expiresAt).toBe("2026-10-18T00:00:00.100Z");
  expect(noticeDraftSchema.safeParse({...value,startsAt:value.expiresAt,expiresAt:value.startsAt}).success).toBe(false);
});
test("notice links remain internal and translations retain explicit fallback", () => {
  for(const href of ["https://example.com", "//example.com", "/\\example.com", "/path with space", "javascript:alert(1)"])
    expect(noticeDraftSchema.safeParse({...draft(),href,linkLabel:{zh:"详情"}}).success).toBe(false);
  expect(noticeDraftSchema.parse({...draft(),href:"/charts/1",linkLabel:{zh:"详情",en:"View"}}).href).toBe("/charts/1");
  expect(noticeDraftSchema.safeParse({...draft(),href:"/help"}).success).toBe(false);
  expect(noticeText({zh:"中文",en:" "},"en")).toEqual({text:"中文",fallback:true});
  expect(noticeText({zh:"中文",ja:"日本語"},"ja")).toEqual({text:"日本語",fallback:false});
});
test("notice limits count Unicode and reject text PostgreSQL cannot store", () => {
  expect(noticeDraftSchema.safeParse({...draft(),title:{zh:"😀".repeat(80)}}).success).toBe(true);
  for(const title of ["😀".repeat(81),"\0","\ud800","\udfff"])
    expect(noticeDraftSchema.safeParse({...draft(),title:{zh:title}}).success).toBe(false);
});
test("durable numeric identities fit signed bigint and content facts contain no body", () => {
  const fact={version:1,entity:"forum_id",id:"00000000-0000-4000-8000-000000000001",revision:1,state:"allocated",publicId:"1"};
  expect(communityContentFact.safeParse(fact).success).toBe(true);
  for(const publicId of ["0","01","9223372036854775808","9999999999999999999"])
    expect(communityContentFact.safeParse({...fact,publicId}).success).toBe(false);
  expect(communityContentFact.safeParse({...fact,publicId:"9223372036854775807"}).success).toBe(true);
  expect(communityContentFact.safeParse({...fact,body:"private content"}).success).toBe(false);
  expect(communityContentFact.safeParse({version:1,entity:"notice",id:"notice1",revision:1,state:"visible"}).success).toBe(false);
});


test("saved notice equality ignores JSONB key order but keeps all publication fields", () => {
  const value: NoticeDraft = { ...draft(), title: { zh: "公告", en: "Notice" }, href: "/help", linkLabel: { zh: "帮助", ja: "ヘルプ" } };
  const reordered: NoticeDraft = { order: value.order, linkLabel: { ja: "ヘルプ", zh: "帮助" }, href: value.href, expiresAt: null, startsAt: null, level: value.level, body: value.body, title: { en: "Notice", zh: "公告" } };
  expect(JSON.stringify(value)).not.toBe(JSON.stringify(reordered));
  expect(sameNoticeDraft(value, reordered)).toBe(true);
  for (const change of [{title:{zh:"新标题"}}, {body:{zh:"新正文"}}, {level:"important" as const}, {startsAt:"2026-10-18T00:00:00Z"}, {expiresAt:"2026-10-19T00:00:00Z"}, {href:"/charts"}, {linkLabel:{zh:"新标签"}}, {order:1}]) expect(sameNoticeDraft(value, {...reordered,...change})).toBe(false);
});
