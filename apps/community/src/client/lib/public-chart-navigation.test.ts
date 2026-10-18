import { expect, test } from "bun:test";
import { publicListHref, publicListReturnState, samePublicListScope } from "./public-chart-navigation";
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
