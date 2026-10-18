import copy, datetime as dt, importlib.util, json, os, pathlib, shlex, stat, tempfile, time, unittest
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

if __name__=='__main__':unittest.main()
