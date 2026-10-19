import {expect,test} from "bun:test";
import type {ChartDto} from "@/shared/charts";
import {publicationConfirmationKey} from "./publication-review";
import {releaseNoteDraft} from "./release-note";
const chart={id:"chart",revision:1,title:"A",artist:"B",description:"",credits:"",tags:[],publication:null,publicationPending:false,versions:[{id:"v",ordinal:1,releaseNote:"",summary:{difficulties:[],warnings:[]}}]} as unknown as ChartDto;
test("publication confirmations bind all saved content and public state even at the same revision",()=>{
 const key=publicationConfirmationKey(chart,"v");
 expect(publicationConfirmationKey({...chart,description:"changed"},"v")).not.toBe(key);
 expect(publicationConfirmationKey({...chart,publicationPending:true},"v")).not.toBe(key);
 expect(publicationConfirmationKey({...chart,versions:[{...chart.versions[0],releaseNote:"note"}]},"v")).not.toBe(key);
 expect(publicationConfirmationKey(chart,"another")).not.toBe(key);
});
test("generated release notes use numeric summaries and never private filenames or source",()=>{
 const version={...chart.versions[0],summary:{...chart.versions[0].summary,title:"/private/secret",artist:"secret",difficulties:[{difficulty:4 as const,level:"/private/level",designer:"/private/designer",noteCount:5,durationMs:2000,previewSupported:true}]}};
 const note=releaseNoteDraft(undefined,version,null,null,"zh");expect(note).toContain("1");expect(note).not.toContain("/private/");expect(note).not.toContain("secret");expect([...note].length).toBeLessThanOrEqual(1000);
});
