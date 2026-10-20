import {describe,expect,test} from "bun:test";
import {primarySection,workspaceSection} from "./site-navigation";

describe("site navigation context",()=>{
 test("chart detail and filtered search remain in the chart section",()=>{
  expect(primarySection("/charts/1")).toBe("charts");
  expect(primarySection("/search")).toBe("charts");
  expect(primarySection("/discover/")).toBe("discover");
  expect(primarySection("/lists/1")).toBe("lists");
  expect(primarySection("/forum/1")).toBe("forum");
 });
 test("private editor routes do not become public chart navigation",()=>{
  expect(primarySection("/me/charts/new")).toBeNull();
  expect(workspaceSection("/me/charts/abc/compare")).toBe("create");
  expect(workspaceSection("/me/imports")).toBe("create");
  expect(workspaceSection("/me/lists/new")).toBe("library");
  expect(workspaceSection("/me/governance")).toBe("community");
  expect(workspaceSection("/settings/account")).toBe("account");
 });
 test("segment boundaries do not match unrelated public pages or admin",()=>{
  expect(primarySection("/charts-extra")).toBeNull();
  expect(workspaceSection("/dash/users")).toBeNull();
  expect(workspaceSection("/u/1")).toBeNull();
 });
});
