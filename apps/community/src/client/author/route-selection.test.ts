import {expect,test} from "bun:test";
import type {ChartDto} from "@/shared/charts";
import {reviewSelection,compareSelection} from "./route-selection";
const chart={currentVersionId:"b",publication:{versionId:"a"},versions:[{id:"b",summary:{difficulties:[{difficulty:4}]}},{id:"a",summary:{difficulties:[{difficulty:4}]}}]} as unknown as ChartDto;
test("review and compare choose existing versions without modifying current selection",()=>{
 expect(reviewSelection(chart,new URLSearchParams("version=a")).version.id).toBe("a");expect(chart.currentVersionId).toBe("b");
 const pair=compareSelection(chart,new URLSearchParams());expect([pair.left.id,pair.right.id]).toEqual(["a","b"]);
 expect(()=>compareSelection(chart,new URLSearchParams("left=missing"))).toThrow("NOT_FOUND");expect(()=>reviewSelection(chart,new URLSearchParams("difficulty=9"))).toThrow("NOT_FOUND");
});
