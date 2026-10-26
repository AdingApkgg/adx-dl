import ast, copy, datetime as dt, importlib.util, json, os, pathlib, re, shlex, stat, subprocess, sys, tempfile, time, unittest
from unittest.mock import patch

SOURCE = pathlib.Path(__file__).resolve().parents[2]/'ops/release/await-acceptance.py'
spec=importlib.util.spec_from_file_location('release_gate',SOURCE)
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)

class ReleaseGateTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.root=pathlib.Path(self.temp.name);self.context=self.root/'context';self.context.mkdir(mode=0o700)
  self.run='1'*32;self.digest='a'*64;self.revision='b'*40
  (self.context/'.owner').write_text(self.run)
  self.snapshot={role:{'id':role,'image':'sha256:old','startedAt':'start'} for role in ['web','worker','media-worker']}
  self.ready=dict(releaseId=self.run,revision=self.revision,startedAt=time.time()-1,smokeSha256=self.digest,runtime=self.snapshot)
  self.receipt=dict(schema=1,releaseId=self.run,smokeRunId='2'*32,result=dict(status='passed',authenticated='passed',role='admin',headless=True,authTransport='ssh-readonly-bridge-to-public-production',productionRevision=self.revision,smokeSha256=self.digest,sessionRevoked=True,businessWrites=False,pageErrors=0,routeFailures=0,blockedBusinessWrites=0,steps=sorted(gate.REQUIRED_STEPS),startedAt=dt.datetime.now(dt.timezone.utc).isoformat()),cleanup=dict(cleanup='passed',sessionRevoked=True,webNotRestarted=True,runId='2'*32))
  self.env=dict(COMMUNITY_RELEASE_ID=self.run,COMMUNITY_RELEASE_DIR=str(self.context),COMMUNITY_SMOKE_SHA256=self.digest,COMMUNITY_RELEASE_TIMEOUT='1',COMMUNITY_RELEASE_SOURCE_REVISION=self.revision)
  self.old=os.getcwd();os.chdir(self.root);self.addCleanup(os.chdir,self.old)
  (self.root/'.deploy-revision').write_text('old\n');(self.root/'.serving-revision').write_text(self.revision+'\n')
 def write_receipt(self):gate.atomic(self.context/'acceptance.json',self.receipt)
 def invoke(self,mode,snapshot=None):
  with patch.dict(os.environ,self.env),patch('sys.argv',['gate',mode,self.revision]),patch.object(gate,'runtime_snapshot',return_value=self.snapshot if snapshot is None else snapshot):gate.main()
 def test_real_await_and_completion_only_advance_after_valid_receipt(self):
  self.write_receipt();self.invoke('--await')
  self.assertEqual((self.root/'.deploy-revision').read_text(),'old\n')
  self.invoke('--complete')
  self.assertEqual((self.root/'.deploy-revision').read_text(),self.revision+'\n')
  self.assertEqual(json.loads((self.context/'complete.json').read_text())['status'],'complete')
 def test_rejects_unauthenticated_wrong_revision_missing_cleanup_and_replay(self):
  cases=[('result','authenticated','not-configured'),('result','role','user'),('result','headless',False),('result','productionRevision','c'*40),('result','smokeSha256','d'*64),('result','sessionRevoked',False),('result','businessWrites',True),('result','pageErrors',1),('result','routeFailures',1),('result','blockedBusinessWrites',1),('result','pageErrors',False),('result','steps',[]),('cleanup','cleanup','failed'),('cleanup','sessionRevoked',False),('cleanup','webNotRestarted',False),('cleanup','runId','3'*32)]
  for section,key,value in cases:
   with self.subTest(key=key,value=value):
    receipt=copy.deepcopy(self.receipt);receipt[section][key]=value
    with self.assertRaises(ValueError):gate.validate(receipt,self.ready)
  wrong=copy.deepcopy(self.receipt);wrong['releaseId']='f'*32
  with self.assertRaises(ValueError):gate.validate(wrong,self.ready)
 def test_previous_nine_steps_cannot_complete_following_release(self):
  self.receipt['result']['steps'].remove('production_following_feed_and_alert_settings')
  self.write_receipt()
  with self.assertRaises(ValueError):self.invoke('--await')
  self.assertEqual((self.root/'.deploy-revision').read_text(),'old\n')
 def test_author_workbench_and_review_steps_are_mandatory(self):
  for step in ['production_author_workbench_and_imports','production_author_review_compare_and_denials']:
   with self.subTest(step=step):
    receipt=copy.deepcopy(self.receipt);receipt['result']['steps'].remove(step)
    with self.assertRaisesRegex(ValueError,'RECEIPT_REJECTED'):gate.validate(receipt,self.ready)
 def test_library_and_download_steps_are_mandatory(self):
  original=copy.deepcopy(self.receipt)
  for step in ['production_library_and_public_lists','production_download_center_and_list_admin']:
   self.receipt=copy.deepcopy(original);self.receipt['result']['steps'].remove(step);self.write_receipt()
   with self.assertRaises(ValueError):self.invoke('--await')
   self.assertEqual((self.root/'.deploy-revision').read_text(),'old\n')
 def test_discovery_groups_are_mandatory_even_with_previous_complete_receipt(self):
  for step in ['production_public_discovery_search','production_authenticated_discovery_library']:
   receipt=copy.deepcopy(self.receipt);receipt['result']['steps'].remove(step)
   with self.assertRaisesRegex(ValueError,'RECEIPT_REJECTED'):gate.validate(receipt,self.ready)
 def test_governance_ops_group_is_mandatory(self):
  receipt=copy.deepcopy(self.receipt);receipt['result']['steps'].remove('production_governance_ops')
  with self.assertRaisesRegex(ValueError,'RECEIPT_REJECTED'):gate.validate(receipt,self.ready)
 def test_ui_navigation_layout_group_is_mandatory(self):
  receipt=copy.deepcopy(self.receipt);receipt['result']['steps'].remove('production_ui_navigation_layout')
  with self.assertRaisesRegex(ValueError,'RECEIPT_REJECTED'):gate.validate(receipt,self.ready)
 def test_optional_preview_gate_requires_exact_target_and_complete_observations(self):
  self.ready['requiredPreview']={'chart':'1','difficulty':6}
  with self.assertRaisesRegex(ValueError,'RECEIPT_REJECTED'):gate.validate(self.receipt,self.ready)
  proof=dict(chart='1',difficulty=6,apiSupported=True,slotWarnings=0,maidataLoaded=True,maidataMatchesSummary=True,ready=True,clockAdvanced=True,pauseStable=True,seekSucceeded=True)
  self.receipt['result']['previewCoverage']=proof
  with self.assertRaisesRegex(ValueError,'RECEIPT_REJECTED'):gate.validate(self.receipt,self.ready)
  self.receipt['result']['steps'].append('production_required_chart_preview')
  gate.validate(self.receipt,self.ready)
  for key,value in [('chart','2'),('difficulty',5),('apiSupported',False),('slotWarnings',1),('slotWarnings',False),('maidataLoaded',False),('maidataMatchesSummary',False),('ready',False),('clockAdvanced',False),('pauseStable',False),('seekSucceeded',False)]:
   with self.subTest(key=key):
    receipt=copy.deepcopy(self.receipt);receipt['result']['previewCoverage'][key]=value
    with self.assertRaisesRegex(ValueError,'RECEIPT_REJECTED'):gate.validate(receipt,self.ready)
 def test_preview_requirement_is_bound_to_release_context(self):
  self.env.update(PRODUCTION_PREVIEW_CHART='1',PRODUCTION_PREVIEW_DIFFICULTY='6')
  self.write_receipt()
  with self.assertRaisesRegex(ValueError,'RECEIPT_REJECTED'):self.invoke('--await')
  self.assertEqual(json.loads((self.context/'ready.json').read_text())['requiredPreview'],dict(chart='1',difficulty=6))
  self.assertEqual((self.root/'.deploy-revision').read_text(),'old\n')
 def test_partial_or_invalid_preview_configuration_fails_preflight(self):
  for chart,difficulty in [('1',''),('','6'),('0','6'),('1','8'),('1','6.0')]:
   with self.subTest(chart=chart,difficulty=difficulty):
    self.env.update(PRODUCTION_PREVIEW_CHART=chart,PRODUCTION_PREVIEW_DIFFICULTY=difficulty)
    with self.assertRaisesRegex(ValueError,'PREVIEW_TARGET'):self.invoke('--preflight')
 def test_old_pass_cannot_complete_a_new_deployment(self):
  self.receipt['result']['startedAt']=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=1)).isoformat()
  self.write_receipt()
  with self.assertRaisesRegex(ValueError,'STALE'):self.invoke('--await')
  self.assertEqual((self.root/'.deploy-revision').read_text(),'old\n')
  self.assertFalse((self.context/'complete.json').exists())
 def test_runtime_restart_after_acceptance_rejects_completion(self):
  self.write_receipt();self.invoke('--await')
  changed=copy.deepcopy(self.snapshot);changed['worker']['id']='replacement'
  with self.assertRaisesRegex(ValueError,'RUNTIME'):self.invoke('--complete',changed)
  self.assertEqual((self.root/'.deploy-revision').read_text(),'old\n')
 def test_serving_revision_change_after_acceptance_rejects_completion(self):
  self.write_receipt();self.invoke('--await')
  (self.root/'.serving-revision').write_text('c'*40+'\n')
  with self.assertRaisesRegex(ValueError,'SERVING_REVISION_CHANGED'):self.invoke('--complete')
  self.assertEqual((self.root/'.deploy-revision').read_text(),'old\n')
  self.assertEqual(json.loads((self.root/'.release-status.json').read_text())['status'],'failed')
 def test_receipt_change_after_acceptance_rejects_completion(self):
  self.write_receipt();self.invoke('--await');self.receipt['extra']='modified';self.write_receipt()
  with self.assertRaisesRegex(ValueError,'RECEIPT_CHANGED'):self.invoke('--complete')
  self.assertEqual((self.root/'.deploy-revision').read_text(),'old\n')
 def test_headless_failure_and_timeout_preserve_old_release(self):
  (self.context/'failed.json').write_text('{}')
  with self.assertRaisesRegex(ValueError,'GATE_FAILED'):self.invoke('--await')
  (self.context/'failed.json').unlink()
  with patch.object(gate.time,'monotonic',side_effect=[0,2]):
   with self.assertRaisesRegex(ValueError,'TIMEOUT'):self.invoke('--await')
  self.assertEqual((self.root/'.deploy-revision').read_text(),'old\n')
  self.assertFalse((self.context/'complete.json').exists())
 def test_receipt_permissions_and_symlink_are_rejected(self):
  self.write_receipt();path=self.context/'acceptance.json';path.chmod(0o644)
  with self.assertRaisesRegex(ValueError,'PRIVATE'):gate.private_file(path)
  path.unlink();target=self.root/'elsewhere';target.write_text('{}');path.symlink_to(target)
  with self.assertRaisesRegex(ValueError,'PRIVATE'):gate.private_file(path)
 def test_completion_context_cannot_be_replayed(self):
  self.write_receipt();self.invoke('--await')
  self.env['COMMUNITY_RELEASE_ID']='f'*32;(self.context/'.owner').write_text('f'*32)
  with self.assertRaisesRegex(ValueError,'CONTEXT_MISMATCH'):self.invoke('--complete')
 def test_candidate_requires_exact_operator_source_revision(self):
  self.invoke('--candidate')
  for revision in ['', 'c'*40]:
   self.env['COMMUNITY_RELEASE_SOURCE_REVISION']=revision
   with self.assertRaisesRegex(ValueError,'UPDATE_OPERATOR'):self.invoke('--candidate')
   self.assertEqual((self.root/'.deploy-revision').read_text(),'old\n')
 def test_preflight_requires_owned_context_and_script_digest(self):
  self.invoke('--preflight')
  for key,value in [('COMMUNITY_RELEASE_ID',''),('COMMUNITY_SMOKE_SHA256',''),('COMMUNITY_RELEASE_TIMEOUT','0')]:
   with self.subTest(key=key):
    old=self.env[key];self.env[key]=value
    with self.assertRaises(ValueError):self.invoke('--preflight')
    self.env[key]=old

class BeforeAcceptanceHookTests(unittest.TestCase):
 def test_hook_gets_release_environment_and_failure_stops_acceptance(self):
  source=(pathlib.Path(__file__).resolve().parents[4]/'scripts/remote/community-deploy.py').read_text()
  functions=[node for node in ast.parse(source).body if isinstance(node,ast.FunctionDef) and node.name=='run_before_acceptance']
  self.assertEqual(len(functions),1)
  namespace=dict(subprocess=subprocess,sys=sys)
  exec(compile(ast.Module(body=functions,type_ignores=[]),'community-deploy.py','exec'),namespace)
  run=namespace['run_before_acceptance']
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);hook=root/'hook with spaces.py';output=root/'proof.json'
   hook.write_text('import json,os,pathlib\npathlib.Path(os.environ["HOOK_PROOF"]).write_text(json.dumps({key:os.environ[key] for key in ["PRODUCTION_EXPECT_REVISION","COMMUNITY_RELEASE_ID"]}))\n')
   env=dict(os.environ,HOOK_PROOF=str(output),PRODUCTION_EXPECT_REVISION='a'*40,COMMUNITY_RELEASE_ID='b'*32)
   run(hook,env)
   self.assertEqual(json.loads(output.read_text()),dict(PRODUCTION_EXPECT_REVISION='a'*40,COMMUNITY_RELEASE_ID='b'*32))
   hook.write_text('raise SystemExit(9)\n')
   with self.assertRaises(subprocess.CalledProcessError):run(hook,env)
 def test_no_hook_does_not_run_subprocess(self):
  source=(pathlib.Path(__file__).resolve().parents[4]/'scripts/remote/community-deploy.py').read_text()
  functions=[node for node in ast.parse(source).body if isinstance(node,ast.FunctionDef) and node.name=='run_before_acceptance']
  self.assertEqual(len(functions),1)
  namespace=dict(subprocess=subprocess,sys=sys)
  exec(compile(ast.Module(body=functions,type_ignores=[]),'community-deploy.py','exec'),namespace)
  with patch('subprocess.run') as invoke:
   namespace['run_before_acceptance'](None,{})
   invoke.assert_not_called()

class SmokeParameterTests(unittest.TestCase):
 def test_anonymous_remote_payload_forwards_only_the_explicit_preview_target(self):
  repository=pathlib.Path(__file__).resolve().parents[4]
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);ssh=root/'ssh';payload=root/'payload.py'
   git=root/'git';git.write_text('#!'+sys.executable+'\nprint("'+ 'a'*40 +'")\n');git.chmod(0o700)
   ssh.write_text('#!'+sys.executable+'\nimport os,pathlib,sys\npathlib.Path(os.environ["PAYLOAD_FILE"]).write_text(sys.stdin.read())\n');ssh.chmod(0o700)
   env=dict(os.environ,PATH=str(root)+os.pathsep+os.environ['PATH'],PAYLOAD_FILE=str(payload),PRODUCTION_PREVIEW_CHART='1',PRODUCTION_PREVIEW_DIFFICULTY='6')
   subprocess.run(['bash',str(repository/'scripts/remote/community-smoke.sh'),'--anonymous'],env=env,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   tree=ast.parse(payload.read_text())
   values={node.targets[0].id:node.value.value for node in tree.body if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name) and isinstance(node.value,ast.Constant)}
   self.assertEqual(values['preview_chart'],'1');self.assertEqual(values['preview_difficulty'],'6')
   self.assertNotIn('bridgeKey',values)
 def test_partial_preview_parameters_fail_before_any_ssh_or_session(self):
  repository=pathlib.Path(__file__).resolve().parents[4]
  env=dict(os.environ,PRODUCTION_PREVIEW_CHART='1',PRODUCTION_PREVIEW_DIFFICULTY='')
  for command in [[sys.executable,str(repository/'scripts/remote/community-auth-smoke.py')],['bash',str(repository/'scripts/remote/community-smoke.sh'),'--anonymous']]:
   with self.subTest(command=command):
    result=subprocess.run(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    self.assertNotEqual(result.returncode,0);self.assertIn('VALID_PREVIEW_TARGET_REQUIRED',result.stderr)

class AcceptanceProxyTests(unittest.TestCase):
 def proxy_function(self):
  source=(pathlib.Path(__file__).resolve().parents[4]/'scripts/remote/community-auth-host.py').read_text()
  nodes=[node for node in ast.parse(source).body if isinstance(node,ast.FunctionDef) and node.name=='acceptance_proxy']
  import urllib.parse
  namespace=dict(os=os,stat=stat,json=json,urllib=urllib)
  exec(compile(ast.Module(body=nodes,type_ignores=[]),'community-auth-host.py','exec'),namespace)
  return namespace['acceptance_proxy']
 def test_default_and_private_local_proxy_override(self):
  choose=self.proxy_function()
  with tempfile.TemporaryDirectory() as directory:
   path=pathlib.Path(directory)/'proxy.json'
   self.assertEqual(choose(path,'inherited'),'inherited')
   path.write_text(json.dumps({'httpsProxy':'http://host.docker.internal:20172'}));path.chmod(0o600)
   self.assertEqual(choose(path,'inherited'),'http://host.docker.internal:20172')
 def test_rejects_credentials_remote_destinations_and_exposed_settings(self):
  choose=self.proxy_function()
  with tempfile.TemporaryDirectory() as directory:
   path=pathlib.Path(directory)/'proxy.json'
   for value in ['http://user:secret@host.docker.internal:20172','http://example.com:20172','https://host.docker.internal:20172','http://host.docker.internal:20172/forward?url=x']:
    with self.subTest(proxy=value):
     path.write_text(json.dumps({'httpsProxy':value}));path.chmod(0o600)
     with self.assertRaises(AssertionError):choose(path,'inherited')
   path.write_text(json.dumps({'httpsProxy':'http://host.docker.internal:20172'}));path.chmod(0o644)
   with self.assertRaisesRegex(AssertionError,'PRIVATE_OWNED'):choose(path,'inherited')
   path.unlink();target=pathlib.Path(directory)/'target';target.write_text('{}');target.chmod(0o600);path.symlink_to(target)
   with self.assertRaisesRegex(AssertionError,'PRIVATE_OWNED'):choose(path,'inherited')

class ReleaseSourcePermissionsTests(unittest.TestCase):
 def test_public_checkout_is_readable_while_release_context_and_env_stay_private(self):
  with tempfile.TemporaryDirectory() as directory:
   parent=pathlib.Path(directory);releases=parent/'releases';deployment=parent/'deployment';tools=parent/'tools'
   run='a'*32;context=releases/run;context.mkdir(parents=True,mode=0o700);deployment.mkdir();(tools/'apps/community').mkdir(parents=True)
   (context/'.owner').write_text(run);(context/'tools.json').write_text(json.dumps({'path':str(tools)}))
   (deployment/'.env').write_text('FIXTURE_ONLY=value\n');(deployment/'.env').chmod(0o600)
   (tools/'apps/community/deploy.sh').write_text('cd '+shlex.quote(str(deployment))+'\nprintf source > public.ts\nmkdir public-module\n')
   source=(pathlib.Path(__file__).resolve().parents[4]/'scripts/remote/community-release-host.py').read_text().replace('/home/i/astrodx-community-releases',str(releases)).replace('/home/i/astrodx-dash-src/apps/community',str(deployment))
   previous=os.umask(0o077)
   try:
    with patch('os.uname',return_value=os.uname_result(('Linux','arch','','',''))),patch('subprocess.check_output',return_value=''):
     with self.assertRaises(SystemExit) as outcome:exec(compile(source,'community-release-host.py','exec'),{'task':dict(action='start',releaseId=run,mode='--no-pull',smokeSha256='b'*64,baseCommit='c'*40)})
    self.assertEqual(outcome.exception.code,0)
   finally:os.umask(previous)
   self.assertEqual(stat.S_IMODE((deployment/'public.ts').stat().st_mode),0o644)
   self.assertEqual(stat.S_IMODE((deployment/'public-module').stat().st_mode),0o755)
   self.assertEqual(stat.S_IMODE((context/'deploy.log').stat().st_mode),0o600)
   self.assertEqual(stat.S_IMODE(context.stat().st_mode),0o700)
   self.assertEqual(stat.S_IMODE((deployment/'.env').stat().st_mode),0o600)
   self.assertEqual((deployment/'.env').read_text(),'FIXTURE_ONLY=value\n')

class SmokeDeadlineTests(unittest.TestCase):
 def test_nested_deadlines_leave_shutdown_and_cleanup_inside_the_existing_lease(self):
  root=pathlib.Path(__file__).resolve().parents[4]
  auth=(root/'scripts/remote/community-auth-smoke.py').read_text();anonymous=(root/'scripts/remote/community-smoke.sh').read_text()
  browser=int(re.search(r"'(\d+)s',\s*(?:'node'|task\['node'\])",auth).group(1));anonymous_browser=int(re.search(r"'(\d+)s',\s*(?:'node'|task\['node'\])",anonymous).group(1))
  builder=next(n for n in ast.parse(auth).body if isinstance(n,ast.FunctionDef) and n.name=='builder')
  ssh=next(k.value.value for n in ast.walk(builder) if isinstance(n,ast.Call) for k in n.keywords if k.arg=='timeout')
  controller=ast.parse((root/'scripts/remote/community-deploy.py').read_text())
  outer=next(k.value.value for n in ast.walk(controller) if isinstance(n,ast.Call) and 'community-smoke.sh' in ast.unparse(n) for k in n.keywords if k.arg=='timeout')
  host=(root/'scripts/remote/community-release-host.py').read_text();gate_seconds=int(re.search(r"COMMUNITY_RELEASE_TIMEOUT='(\d+)'",host).group(1))
  bridge=(root/'apps/community/ops/acceptance/auth-bridge.ts').read_text();lease=re.search(r"\}, (\d+) \* ([\d_]+)\)\.unref",bridge);lease_seconds=int(lease.group(1))*int(lease.group(2).replace('_',''))//1000
  self.assertEqual(browser,anonymous_browser);self.assertLess(browser+10,ssh);self.assertLess(ssh,outer)
  self.assertLessEqual(outer+30,gate_seconds);self.assertLessEqual(gate_seconds,lease_seconds);self.assertLessEqual(lease_seconds,600)

class BuildHostParameterTests(unittest.TestCase):
 def test_invalid_hostname_jump_and_node_path_fail_before_any_ssh(self):
  repository=pathlib.Path(__file__).resolve().parents[4]
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);marker=root/'ssh-called'
   ssh=root/'ssh';ssh.write_text(chr(10).join([ '#!'+sys.executable, 'import os,pathlib', 'pathlib.Path(os.environ["SSH_MARKER"]).write_text("1")', 'raise SystemExit(1)' ])+chr(10));ssh.chmod(0o700)
   base=dict(os.environ,PATH=str(root)+os.pathsep+os.environ['PATH'],SSH_MARKER=str(marker))
   cases=[({'ASTRODX_BUILD_HOSTNAME':'bad host'},'INVALID_BUILD_HOSTNAME'),({'ASTRODX_BUILD_HOSTNAME':''},'INVALID_BUILD_HOSTNAME'),({'ACCEPTANCE_NODE_PATH':'node --x'},'INVALID_ACCEPTANCE_NODE_PATH'),({'ACCEPTANCE_NODE_PATH':'rel/node'},'INVALID_ACCEPTANCE_NODE_PATH'),({'ASTRODX_PRODUCTION_JUMP_HOST':'a b'},'INVALID_PRODUCTION_JUMP_HOST')]
   for overrides,code in cases:
    with self.subTest(code=code,overrides=overrides):
     marker.unlink(missing_ok=True)
     env=dict(base);env.update(overrides)
     result=subprocess.run([sys.executable,str(repository/'scripts/remote/community-auth-smoke.py')],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
     self.assertNotEqual(result.returncode,0);self.assertIn(code,result.stderr);self.assertFalse(marker.exists())

if __name__=='__main__':unittest.main()
