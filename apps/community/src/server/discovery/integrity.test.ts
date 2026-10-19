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

test('SQL query normalization equals browser normalization for Unicode whitespace and ASCII folding',async()=>{const {normalizeSearchText}=await import('@/shared/discovery-search');for(const value of [' ＡＢＣ　日本語\t%_  ','\uFEFFABC\u2028DEF\u2029','\u0085Case','e\u0301clair']){const r=await db().execute(sql`select adxc_text_key(${value}) k`);expect(r.rows[0]?.k).toBe(normalizeSearchText(value));}});

 test('SQL strict fact guards agree with final parsers on unknown formats and malformed public snapshots',async()=>{
 const {communityContentFact}=await import('@/shared/community-content-journal');const {privateLibraryFact}=await import('@/shared/private-library-journal');
 const topic={version:1,entity:'topic',id:'01a14290-a0ba-7ba8-90fd-e167e04eb88e',revision:1,state:'visible',hash:'a'.repeat(64),authorId:'user'};
 const control={...topic,entity:'topic_control',state:'control',controls:{board:'general',locked:false,pin:1}};
 const list={version:1,entity:'list',id:topic.id,userId:'user',revision:2,publicId:'1',draft:{name:'Example',description:'',chartIds:[topic.id]},publication:{name:'Example',description:'line\nnext',chartIds:[topic.id],revision:1,publicId:'1',publishedAt:'2026-10-19T00:00:00.000Z',ownerCutoff:0},deleted:false,createdAt:'2026-10-19T00:00:00.000Z',updatedAt:'2026-10-19T00:00:00.000Z'};
 for(const f of [topic,{...topic,version:9},{...topic,extra:true},{...topic,hash:null},{...topic,revision:'1'},control,{...control,controls:{...control.controls,unknown:true}},{...control,controls:{locked:'false'}}]){
 const r=await db().execute(sql`select adxc_community_fact_valid(${JSON.stringify(f)}::jsonb) ok`);expect(r.rows[0]?.ok).toBe(communityContentFact.safeParse(f).success);
 }
 for(const f of [list,{...list,version:2},{...list,entity:'other'},{...list,unknown:true},{...list,publication:{...list.publication,revision:3}},{...list,publication:{...list.publication,publishedAt:'2026-10-19T24:00:00Z'}},{...list,publication:{...list.publication,name:' trim '}},{...list,publication:{...list.publication,name:'A\u200bB'}},{...list,draft:{...list.draft,chartIds:['bad']}}]){
 const r=await db().execute(sql`select adxc_library_public_valid(${JSON.stringify(f)}::jsonb,'1') ok`);expect(r.rows[0]?.ok).toBe(privateLibraryFact.safeParse(f).success);
 }
 });

 test('ranked live SQL compiles independently of the public error boundary',async()=>{
 const {queryGroup,queryFacets}=await import('./search');const {parsePublicChartFilters}=await import('@/shared/public-chart-search');const ctx={db:db()} as import('../storage/contracts').StorageContext;
 expect((await queryGroup(ctx,'charts',parsePublicChartFilters())).status).toBe('ready');await queryFacets(ctx,parsePublicChartFilters());
 });
