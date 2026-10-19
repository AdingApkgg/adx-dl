import {test,expect} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {sql} from 'drizzle-orm';
import {createHash} from 'node:crypto';
import {resetTestDatabase,assertTestDatabaseUrl} from '../testing/test-db';
import {testDatabaseUrl} from '../testing/services';
import {readyContext} from '../../../test/storage/ready-file';
import {blobs,derivedObjects,blobDerivatives} from '../db/schema';
import {chartManifestBytes} from '../charts/artifact';
import {CHART_PREVIEW_MIME} from '../charts/recipe';
import {searchPublic,groupStatement} from './search';
import {parseDiscoveryInput} from '@/shared/discovery-search';
import type {StorageContext} from '../storage/contracts';
/** Opt-in only: a dedicated _test database, rollback-scoped synthetic metadata, no media/object-store writes. */
test.skipIf(process.env.DISCOVERY_PERF!=='1')('controlled live search workload: 5000 charts,1000 authors,1000 lists,2000 topics',async()=>{
 expect(process.platform).toBe('linux');assertTestDatabaseUrl(testDatabaseUrl());await resetTestDatabase();
 const f=await readyContext(),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 const summary={title:'Perf original',artist:'Perf artist',maidataMd5Base64:'A'.repeat(22)+'==',difficulties:[{difficulty:4,level:'13+',designer:'Perf designer',noteCount:2,durationMs:3000,previewSupported:true}],warnings:[],audio:null,hasCover:false};
 const manifest={format:1,summary,assets:[{role:'maidata',path:'maidata.txt',mime:'text/plain; charset=utf-8',size:4,sha256:'a'.repeat(64),offset:0}]} as const;
 const rollback={},samples:number[]=[],byCase:Record<string,number[]>={};let report:Record<string,unknown>|undefined;
 try{await f.ctx.db.transaction(async tx=>{
  await tx.execute(sql`set local statement_timeout='0'`);
  const ctx={...f.ctx,db:tx as unknown as StorageContext['db']};
  const [blob]=await tx.insert(blobs).values({policyId:f.policy.id,sha256:hash(crypto.randomUUID()),key:crypto.randomUUID(),size:10,state:'ready',verifiedAt:new Date(),detectedMime:'application/zip'}).returning();
  const [output]=await tx.insert(derivedObjects).values({policyId:f.policy.id,outputSha256:hash(crypto.randomUUID()),key:crypto.randomUUID(),size:12+chartManifestBytes(manifest as never).length+4,mime:CHART_PREVIEW_MIME,state:'ready',properties:{chartPreview:manifest}}).returning();
  const [recipe]=await tx.insert(blobDerivatives).values({sourceBlobId:blob.id,recipe:'chart-preview-v1',recipeBuild:'discovery-perf-fixture',derivedObjectId:output.id,state:'ready'}).returning();
  await tx.execute(sql`create temp table adxc_perf_users on commit drop as select uuidv7()::text id,g i from generate_series(1,1000) g`);
  await tx.execute(sql`insert into "user"(id,name,email) select id,'Perf creator '||i,id||'@placeholder.invalid' from adxc_perf_users`);
  await tx.execute(sql`create temp table adxc_perf_charts on commit drop as select uuidv7() id,uuidv7() version,uuidv7() file,u.id owner,g i from generate_series(1,5000) g join adxc_perf_users u on u.i=(g-1)%1000+1`);
  await tx.execute(sql`insert into files(id,owner_id,blob_id,original_name,purpose,size,state) select file,owner,${blob.id}::uuid,'synthetic.zip','chart-source',10,'ready' from adxc_perf_charts`);
  await tx.execute(sql`insert into charts(id,owner_id,title,artist,aliases,tags,publication_sequence) select id,owner,'Perf chart '||i,'Perf artist','["perf alias"]'::jsonb,'[{"key":"perf","label":"Perf"}]'::jsonb,1 from adxc_perf_charts`);
  await tx.execute(sql`insert into chart_versions(id,chart_id,ordinal,source_file_id,preview_derivative_id,maidata_md5_base64,summary) select version,id,1,file,${recipe.id}::uuid,${summary.maidataMd5Base64},${JSON.stringify(summary)}::jsonb from adxc_perf_charts`);
  await tx.execute(sql`insert into chart_public_ids(chart_id) select id from adxc_perf_charts`);
  await tx.execute(sql`update charts c set current_version_id=p.version from adxc_perf_charts p where c.id=p.id`);
  await tx.execute(sql`insert into chart_publications(chart_id,version_id,title,artist,aliases,tags,published_at,updated_at) select id,version,'Perf chart '||i,'Perf artist','["perf alias"]'::jsonb,'[{"key":"perf","label":"Perf"}]'::jsonb,clock_timestamp(),clock_timestamp() from adxc_perf_charts`);
  await tx.execute(sql`create temp table adxc_perf_lists on commit drop as select uuidv7() id,nextval('chart_list_public_id_seq') number,u.id owner,u.i,jsonb_build_object('name','Perf list '||u.i,'description','Perf collection','chartIds',jsonb_build_array((select id from adxc_perf_charts limit 1)::text)) draft from adxc_perf_users u`);
  await tx.execute(sql`insert into chart_lists(id,owner_id,revision,public_id,fact,journal_sequence,updated_at,published_at) select id,owner,1,number,jsonb_build_object('version',1,'entity','list','id',id::text,'userId',owner,'revision',1,'publicId',number::text,'draft',draft,'publication',draft||jsonb_build_object('revision',1,'publicId',number::text,'publishedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'ownerCutoff',0),'deleted',false,'createdAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),1,now(),now() from adxc_perf_lists`);
  await tx.execute(sql`insert into chart_library_states(key,revision,fact,journal_sequence) select 'list:'||id::text,1,fact,1 from chart_lists where id in(select id from adxc_perf_lists)`);
  await tx.execute(sql`insert into chart_list_public_ids(list_id,public_id) select id,number from adxc_perf_lists`);
  await tx.execute(sql`insert into discussion_topics(author_id,board_id,title,body,content_hash) select u.id,'general','Perf topic '||g,'Perf topic body',adxc_topic_hash('Perf topic '||g,'Perf topic body','[]'::jsonb) from generate_series(1,2000) g join adxc_perf_users u on u.i=(g-1)%1000+1`);
  await tx.execute(sql`insert into forum_public_ids(topic_id,journal_sequence) select id,1 from discussion_topics where author_id in(select id from adxc_perf_users)`);
  await tx.execute(sql`insert into community_content_states(key,entity,entity_id,revision,fact,journal_sequence) select 'topic:'||id::text,'topic',id::text,1,jsonb_build_object('version',1,'entity','topic','id',id::text,'revision',1,'state','visible','hash',content_hash),1 from discussion_topics where author_id in(select id from adxc_perf_users)`);
  await tx.execute(sql`insert into community_content_states(key,entity,entity_id,revision,fact,journal_sequence) select 'topic_control:'||id::text,'topic_control',id::text,1,jsonb_build_object('version',1,'entity','topic_control','id',id::text,'revision',1,'state','control','controls',jsonb_build_object('board','general','locked',false)),1 from discussion_topics where author_id in(select id from adxc_perf_users)`);
  // Synthetic visibility watermark only, rolled back with this workload; real chain export is covered by native restore.
  await tx.execute(sql`update storage_journal_progress set exported_sequence=(select max(sequence) from storage_tombstones),chain_hash=repeat('a',64),exported_at=clock_timestamp() where id='global'`);
  await tx.execute(sql`analyze charts;analyze chart_versions;analyze chart_publications;analyze files;analyze discussion_topics;analyze chart_lists;analyze community_content_states`);
  const cases=[{q:'perf',type:'charts'},{q:'perf',type:'all'},{q:'perf',type:'authors'},{q:'perf',type:'lists'},{q:'perf',type:'topics'},{q:'perf',type:'charts',difficulty:'4',levels:'["13+"]',preview:'1'}];
  if(process.env.DISCOVERY_PERF_PROFILE==='1'&&process.env.DISCOVERY_PERF_REPORT){const plans:Record<string,unknown>={};for(const type of ['charts','authors','lists','topics'] as const){const f=parseDiscoveryInput(new URLSearchParams({q:'perf',type})).filters;plans[type]=(await tx.execute(sql`explain(analyze,buffers,format json) ${groupStatement(ctx,type,f,null,20)}`)).rows;}await writeFile(process.env.DISCOVERY_PERF_REPORT+'.plans.json',JSON.stringify(plans),{mode:0o600});}
  for(let round=0;round<5;round++)for(const c of cases){const input=parseDiscoveryInput(new URLSearchParams(c as Record<string,string>)),start=performance.now();const r=await searchPublic(ctx,input);const elapsed=performance.now()-start;
    expect(Object.values(r.groups).some(g=>g.status==='unavailable')).toBe(false);if(c.type==='charts')expect(r.groups.charts.total).toBe(5000);if(c.type==='authors')expect(r.groups.authors.total).toBe(1000);if(c.type==='lists')expect(r.groups.lists.total).toBe(1000);if(c.type==='topics')expect(r.groups.topics.total).toBe(2000);if(round>0){samples.push(elapsed);(byCase[JSON.stringify(c)]??=[]).push(Math.round(elapsed));}}
  console.log('DISCOVERY_CASE_TIMES '+JSON.stringify(byCase));
  samples.sort((a,b)=>a-b);const p95=Math.ceil(samples[Math.ceil(samples.length*.95)-1]);expect(p95).toBeLessThan(1500);
  report={status:'passed',checkedAt:new Date().toISOString(),p95Ms:p95,samples:samples.length,fixtures:{charts:5000,authors:1000,lists:1000,topics:2000},sourceBytes:'shared immutable synthetic fixture',algorithm:1};throw rollback;
 });}catch(e){if(e!==rollback)throw e;}
 expect(report?.status).toBe('passed');if(process.env.DISCOVERY_PERF_REPORT){const p=process.env.DISCOVERY_PERF_REPORT;if(!p.startsWith('/')||p.includes('..'))throw Error('ABSOLUTE_PERF_EVIDENCE_PATH_REQUIRED');await writeFile(p,JSON.stringify(report,null,2)+'\n',{mode:0o600});}
 console.log(JSON.stringify(report));
},180000);
