import { expect, test } from "bun:test";
import { publicListHref, publicListReturnState, publicListBackState, samePublicListScope } from "./public-chart-navigation";
test("return links allow only local public lists with valid filters", () => {
  for (const path of ["https://evil.invalid/charts", "//evil.invalid/charts", "/api/v1/me", "/me/charts", "/charts/1", "/u/01", "/charts?sort=bad", "/charts?next=//evil.invalid"]) expect(publicListHref(path)).toBeNull();
  expect(publicListHref("/ja/u/1?cursor=abc")).toBe("/ja/u/1?cursor=abc");
  expect(publicListHref("/en/charts?q=%E6%98%9F&difficulty=4")).toBe("/en/charts?q=%E6%98%9F&difficulty=4");
});
test("previous page must belong to the same list and query scope", () => {
  expect(samePublicListScope("/charts?q=x&sort=published", "/charts?sort=published&q=x&cursor=abc")).toBe(true);
  expect(samePublicListScope("/charts?q=private", "/charts?q=public&cursor=abc")).toBe(false);
  expect(samePublicListScope("/u/2", "/u/1?cursor=abc")).toBe(false);
});

test("return state carries only same-query public page cursors", () => {
  expect(publicListReturnState({ publicListHref: "/charts?q=star&cursor=page3", publicListCursors: ["/charts?q=star", "/charts?q=star&cursor=page2", "/charts?q=other", "//evil.invalid"] })).toEqual({
    publicListHref: "/charts?q=star&cursor=page3", publicListCursors: ["/charts?q=star", "/charts?q=star&cursor=page2"],
  });
});

test("favorite list return restores its private pagination and accepts no other private route", () => {
  const state = publicListReturnState({ publicListHref: "/en/me/favorites?cursor=page3", publicListCursors: ["/en/me/favorites", "/en/me/favorites?cursor=page2"] });
  expect(publicListHref("/me/reports")).toBeNull();
  expect(state).not.toBeNull();
  expect(publicListBackState(state!)).toEqual({ socialPageScope: "/me/favorites:", socialCursors: ["", "page2"] });
});

test("tag filters are retained only within the same normalized public list scope", () => {
  expect(publicListHref("/ja/charts?tag=abc&cursor=next")).toBe("/ja/charts?tag=abc&cursor=next");
  expect(samePublicListScope("/charts?tag=abc", "/charts?tag=ABC&cursor=next")).toBe(true);
  expect(samePublicListScope("/charts?tag=abc", "/charts?tag=other&cursor=next")).toBe(false);
  expect(publicListHref("/charts?tag=a%2Fb")).toBeNull();
});

 test("search return links retain AND filters, view and scoped cursors",()=>{
 const base='/ja/search?type=charts&q=star&tag%5B%5D=one&tag%5B%5D=two&level%5B%5D=78&level%5B%5D=13%3F&preview=1&view=list';
 expect(publicListHref(base+'&cursor=abc')).toBe(base+'&cursor=abc');
 expect(samePublicListScope(base,base+'&cursor=abc')).toBe(true);
 expect(samePublicListScope(base,base.replace('two','other'))).toBe(false);
 expect(samePublicListScope(base,base.replace('view=list','view=grid'))).toBe(false);
 expect(publicListHref('/search?type=all&cursor=abc')).toBeNull();
 expect(publicListHref('/search?type=charts&view=bad')).toBeNull();
 });

test("implicit search relevance remains the same scope as explicit next-page sorting",()=>{
 expect(samePublicListScope('/search?type=charts&q=star','/search?type=charts&q=star&sort=relevance&cursor=next')).toBe(true);
 expect(samePublicListScope('/charts?q=star','/charts?q=star&sort=relevance&cursor=next')).toBe(false);
});
