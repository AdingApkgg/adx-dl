import {beforeAll,expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {getDb} from '../db/client';
import {testDatabaseUrl} from '../testing/services';
import {resetTestDatabase} from '../testing/test-db';
import {chartArtifactDataStart,validateChartPreviewManifest} from '../charts/artifact';
import {communityHash} from '../community/content-journal';
const db=()=>getDb(testDatabaseUrl()).db;
beforeAll(resetTestDatabase);
const base=()=>({format:1,assets:[{role:'maidata',path:'音符😀/maidata.txt',mime:'text/plain; charset=utf-8',size:10,sha256:'a'.repeat(64),offset:0}],summary:{title:'\u2028😀',artist:'',maidataMd5Base64:'A'.repeat(22)+'==',difficulties:[{difficulty:6,level:'78',designer:'Acid',noteCount:138,durationMs:32550,previewSupported:true}],warnings:[],audio:null,hasCover:false}});
test('SQL canonical bytes equal TS canonical bytes for known manifest and topic shapes',async()=>{
 const values=[base(),{title:'é😀\n\t"\\',body:'日本語\u2028',chartIds:['9223372036854775807']},[1,1.0,0,null,true,{'z':'\b','a':'😀'}]];
 for(const value of values){const r=await db().execute(sql`select encode(sha256(convert_to(adxc_canonical_jsonb(${JSON.stringify(value)}::jsonb),'UTF8')),'hex') h`);expect(r.rows[0]?.h).toBe(communityHash(value));}
});
test('SQL rejects the same adversarial manifests as final TS resolver before query limits',async()=>{
 const valid=base();const size=chartArtifactDataStart(valid as never)+10;
 const variants=[valid,{...valid,unknown:true},{...valid,format:2},{...valid,assets:[{...valid.assets[0],path:'../x'}]},{...valid,assets:[{...valid.assets[0],path:'e\u0301'}]},{...valid,assets:[{...valid.assets[0],offset:1}]},{...valid,summary:{...valid.summary,title:'😀'.repeat(61)}},{...valid,summary:{...valid.summary,difficulties:[{...valid.summary.difficulties[0],noteCount:null}]}},{...valid,summary:{...valid.summary,hasCover:true}},null,[],{...valid,summary:{...valid.summary,difficulties:[valid.summary.difficulties[0],valid.summary.difficulties[0]]}}];
 for(const m of variants){let expected=true;try{validateChartPreviewManifest(m,size);}catch{expected=false;}
 const r=await db().execute(sql`select adxc_manifest_valid(${JSON.stringify(m)}::jsonb,${size}::bigint,${valid.summary.maidataMd5Base64}) ok`);expect(r.rows[0]?.ok).toBe(expected);}
});
