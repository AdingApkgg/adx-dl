import assert from "node:assert/strict";
import { join } from "node:path";
export async function exerciseGovernance({owner,other,anonymous,origin,step,evidenceDirectory}){
 const reader=await other.newPage(),staff=await owner.newPage(),errors=[];
 for(const p of [reader,staff])p.on('pageerror',e=>errors.push(e.message));
 const url=p=>new URL(p,origin).href;
 const get=async(ctx,path)=>{const r=await ctx.request.get(url(path));assert.equal(r.status(),200,path);return r.json();};
 const mutation=async(page,path,action)=>{const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST',{timeout:60000}),action()]);assert.ok(r.ok(),`${path}: ${r.status()}`);return r.json();};
 let topic,appeal;
 try{
 await step('governance_permissions_and_unified_intake',async()=>{
  for(const path of ['/api/v1/governance/me/decisions','/api/v1/governance/dash/overview'])assert.equal((await anonymous.request.get(url(path))).status(),401);
  for(const part of ['overview','tickets','appeals','audit'])assert.equal((await other.request.get(url('/api/v1/governance/dash/'+part))).status(),403);
  await staff.goto(url('/dash/governance'));await staff.getByRole('heading',{level:2,name:'治理与站务',exact:true}).waitFor();
  const queue=await get(owner,'/api/v1/governance/dash/tickets?status=all');assert.ok(queue.items.length>0);
  assert.ok(queue.items.every(t=>['chart','discussion','list'].includes(t.source)&&!('details'in t)));
  await reader.goto(url('/forum/new'));const title='Governance review '+Date.now();
  await reader.getByRole('textbox',{name:'标题',exact:true}).fill(title);await reader.getByRole('textbox',{name:'正文',exact:true}).fill('Synthetic governance body');
  topic=await mutation(reader,'/api/v1/discussions/topics',()=>reader.getByRole('button',{name:'明确提交',exact:true}).click());
  await reader.waitForURL(u=>u.pathname===`/forum/${topic.publicId}`);
  await staff.goto(url(`/dash/discussions?kind=topic&targetId=${topic.id}`));const row=staff.getByRole('article').filter({has:staff.getByText(title,{exact:true})});
  await row.getByLabel('内部管理原因（1–500 字）',{exact:true}).fill('Synthetic internal governance reason');
  await row.getByLabel('告知当事人的原因（1–500 字）',{exact:true}).fill('Synthetic public governance reason');
  await row.getByLabel('我已核对目标、版本与原因，确认执行此操作。',{exact:true}).check();
  await mutation(staff,`/api/v1/discussions/dash/topics/${topic.publicId}/moderation`,()=>row.getByRole('button',{name:'应用',exact:true}).click());
 });
 await step('governance_private_appeal_and_revision_review',async()=>{
  await reader.goto(url('/me/governance'));await reader.getByRole('heading',{name:'我的处理中心',exact:true}).waitFor();
  const card=reader.getByRole('article').filter({hasText:'Synthetic public governance reason'});assert.equal(await reader.getByText('Synthetic internal governance reason',{exact:true}).count(),0);
  await card.getByLabel('申诉理由',{exact:true}).fill('Synthetic author appeal');await card.getByRole('checkbox').check();
  appeal=await mutation(reader,'/api/v1/governance/me/appeals',()=>card.getByRole('button',{name:'提交申诉',exact:true}).click());
  assert.equal((await owner.request.post(url('/api/v1/governance/me/appeals'),{headers:{origin:origin.origin},data:{decisionKey:appeal.decisionKey,reason:'Foreign appeal'}})).status(),404);
  await staff.goto(url('/dash/appeals'));const review=staff.locator(`#appeal-${appeal.id}`);
  await review.getByLabel('复核结果',{exact:true}).selectOption('review_required');await review.getByLabel('给申诉人的反馈',{exact:true}).fill('Synthetic review requires reconsideration');await review.getByRole('checkbox').check();
  const result=await mutation(staff,`/api/v1/governance/dash/appeals/${appeal.id}/resolution`,()=>review.getByRole('button',{name:'保存复核结果',exact:true}).click());assert.equal(result.status,'review_required');
  assert.equal((await anonymous.request.get(url(`/api/v1/discussions/topics/${topic.publicId}`))).status(),404,'review must not revive hidden topic');
  await reader.goto(url('/me/governance?view=appeals'));await reader.getByText('Synthetic review requires reconsideration',{exact:true}).waitFor();
 });
 await step('governance_worker_result_notification_and_audit',async()=>{
  const deadline=Date.now()+80000;let inbox;
  for(;;){inbox=await get(other,'/api/v1/discussions/notifications');if(inbox.items.some(n=>n.href==='/me/governance'&&n.publicReason==='Synthetic review requires reconsideration'))break;assert.ok(Date.now()<deadline,'appeal result notification deadline');await new Promise(r=>setTimeout(r,1000));}
  await reader.goto(url('/me/notifications'));const notice=reader.getByRole('article').filter({hasText:'Synthetic review requires reconsideration'});await notice.locator('a[href="/me/governance"]').click();await reader.waitForURL(u=>u.pathname==='/me/governance');await reader.getByRole('heading',{name:'我的处理中心',exact:true}).waitFor();
  const audit=await get(owner,'/api/v1/governance/dash/audit?kind=appeal_resolution');assert.equal(audit.items.filter(e=>e.targetId===appeal.id).length,1);assert.ok(!JSON.stringify(audit).includes('Synthetic author appeal'));
  if(evidenceDirectory)await reader.screenshot({path:join(evidenceDirectory,'governance-private-outcome.png'),fullPage:true});
 });
 await step('governance_three_language_mobile_and_private_headers',async()=>{
  for(const prefix of ['','/en','/ja'])for(const path of ['/me/governance','/me/governance?view=appeals','/dash/governance','/dash/appeals','/dash/audit']){
   const p=path.startsWith('/dash')?staff:reader;const r=await p.goto(url(prefix+path));assert.equal(r.status(),200);assert.match(r.headers()['cache-control'],/no-store/);await p.locator('main h1').first().waitFor();
   for(const width of [320,390,1280]){await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  }
 });
 assert.deepEqual(errors,[]);
 }finally{await Promise.allSettled([reader.close(),staff.close()]);}
}
