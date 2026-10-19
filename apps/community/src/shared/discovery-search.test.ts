import {expect,test} from "bun:test";
import {normalizeSearchText,parseDiscoveryInput,parsePreviewShare,previewShareParams} from "./discovery-search";
import {parsePublicChartFilters,publicChartFiltersFromParams,publicChartSearchParams} from "./public-chart-search";
import {normalizeChartAliases} from "./chart-metadata";
import {permissionFact,retentionFact} from "./chart-journal";
test("NFKC ASCII fold and literal terms remain bounded and preserve other scripts",()=>{
 expect(normalizeSearchText("  ＡＢＣ　日本語\t%_  ")).toBe("abc 日本語 %_");
 expect(parseDiscoveryInput(new URLSearchParams('q=星&type=charts')).type).toBe('charts');
 for(const q of ['a b c d e f g','x'.repeat(121),'\ud800','x\u0000'])expect(()=>parseDiscoveryInput(new URLSearchParams({q}))).toThrow();
 expect(()=>parseDiscoveryInput(new URLSearchParams('type=private'))).toThrow();
});
test("advanced filters preserve exact custom level and bigint IDs with URL roundtrip",()=>{
 const f=parsePublicChartFilters({author:'9223372036854775807',tags:JSON.stringify(['ＡＢＣ','日本語']),levels:JSON.stringify(['78','13?','13+']),designer:'Acid',difficulty:'6',minSeconds:'0',maxSeconds:'3600',preview:'1',sort:'collected'});
 expect(f.tags).toEqual(['abc','日本語']);expect(f.levels).toEqual(['78','13?','13+']);
 expect(publicChartFiltersFromParams(publicChartSearchParams(f))).toEqual(f);
 for(const bad of [{tag:'a',tags:'["b"]'},{tags:'["a","b","c","d","e","f"]'},{minSeconds:'2',maxSeconds:'1'},{preview:'true'},{levels:'null'}])expect(()=>parsePublicChartFilters(bad)).toThrow();
});
test("preview shares never imply autoplay and reject ambiguous/invalid numbers",()=>{
 expect(parsePreviewShare(new URLSearchParams('difficulty=6&t=14.625'))).toEqual({difficulty:6,seconds:14.625});
 expect(previewShareParams({difficulty:6,seconds:14.625}).toString()).toBe('difficulty=6&t=14.625');
 for(const q of ['difficulty=8','difficulty=6&t=NaN','difficulty=6&t=1e2','t=2','difficulty=6&t=3601','difficulty=6&t=0.0001','difficulty=6&difficulty=5'])expect(()=>parsePreviewShare(new URLSearchParams(q))).toThrow();
});
test("aliases stay canonical bounded text; strict v1 facts reject new fields; v2 retention survives",()=>{
 expect(normalizeChartAliases(['  ＡＢＣ  ','abc','日本語','😀'.repeat(60)])).toEqual(['ＡＢＣ','日本語','😀'.repeat(60)]);
 for(const values of [Array.from({length:9},(_,i)=>`alias${i}`),['x'.repeat(61)],['\ud800'],['a\nb']])expect(()=>normalizeChartAliases(values)).toThrow();
 const p={versionId:crypto.randomUUID(),title:'title',artist:'',publishedAt:'2026-10-19T00:00:00.000Z',updatedAt:'2026-10-19T00:00:00.000Z',aliases:['日本語']};
 const f={version:2,chartId:crypto.randomUUID(),publicId:'1',revision:2,publication:p};
 expect(permissionFact.parse(f).publication?.aliases).toEqual(['日本語']);expect(permissionFact.safeParse({...f,version:1}).success).toBe(false);
 expect(retentionFact.parse({version:2,retained:[f]}).retained[0]?.publication.aliases).toEqual(['日本語']);
 expect(retentionFact.safeParse({version:1,retained:[f]}).success).toBe(false);
});
