#!/usr/bin/env python3
"""Formal community release: switch -> authenticated headless gate -> complete."""
import argparse, base64, hashlib, json, os, pathlib, secrets, subprocess, sys, tempfile, time
ROOT=pathlib.Path(__file__).resolve().parents[2]
BUILD=os.environ.get('ASTRODX_BUILD_HOST','i@localhost-1.tailac9c6f.ts.net')
PROD=os.environ.get('ASTRODX_PRODUCTION_HOST','i@arch.tailac9c6f.ts.net')
OPTIONS=['-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-J',BUILD,PROD,'python3 -u -']
parser=argparse.ArgumentParser(description=__doc__)
modes=parser.add_mutually_exclusive_group()
modes.add_argument('--verify-current',action='store_true',help='accept the currently serving revision without build/migration/restart')
modes.add_argument('--no-pull',action='store_true',help='deploy the explicit production checkout without pulling')
args=parser.parse_args()
release_id=secrets.token_hex(16)
files={name:base64.b64encode((ROOT/name).read_bytes()).decode() for name in ['apps/community/deploy.sh','apps/community/ops/release/await-acceptance.py']}
digest=hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest()
smoke_digest=hashlib.sha256((ROOT/'apps/community/test/acceptance/production-smoke.mjs').read_bytes()).hexdigest()
base_commit=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
remote=(ROOT/'scripts/remote/community-release-host.py').read_text()
base=dict(releaseId=release_id,toolsDigest=digest,smokeSha256=smoke_digest,baseCommit=base_commit)
def program(action,**extra):
    task=dict(base,action=action,**extra)
    return 'import json\ntask=json.loads('+repr(json.dumps(task))+')\n'+remote

def call(action,**extra):
    result=subprocess.run(['ssh',*OPTIONS],input=program(action,**extra),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=35)
    if result.returncode:raise RuntimeError('RELEASE_'+action.upper()+'_FAILED')
    return json.loads(result.stdout.strip().splitlines()[-1])

process=None
prepared=False
complete=False
try:
    call('prepare',files=files);prepared=True
    print('RELEASE_STARTED '+release_id,flush=True)
    mode='--verify-current' if args.verify_current else '--no-pull' if args.no_pull else ''
    process=subprocess.Popen(['ssh',*OPTIONS],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    process.stdin.write(program('start',mode=mode));process.stdin.close();process.stdin=None
    deadline=time.monotonic()+1800
    ready=None
    while time.monotonic()<deadline:
        ready=call('ready')['proof']
        if ready:break
        if process.poll() is not None:raise RuntimeError('DEPLOYMENT_FAILED_BEFORE_ACCEPTANCE')
        time.sleep(2)
    if not ready:raise RuntimeError('DEPLOYMENT_READINESS_TIMEOUT')
    print('RELEASE_AWAITING_HEADLESS '+ready['revision'],flush=True)
    with tempfile.TemporaryDirectory(prefix='adxc-release-') as temporary:
        receipt=pathlib.Path(temporary)/'receipt.json'
        env=dict(os.environ,PRODUCTION_EXPECT_REVISION=ready['revision'],PRODUCTION_RELEASE_RECEIPT=str(receipt),COMMUNITY_RELEASE_ID=release_id)
        outcome=subprocess.run(['bash',str(ROOT/'scripts/remote/community-smoke.sh'),'--authenticated'],env=env,timeout=450)
        if outcome.returncode!=0 or not receipt.is_file():raise RuntimeError('AUTHENTICATED_HEADLESS_GATE_FAILED')
        call('receipt',receipt=json.loads(receipt.read_text()))
    process.wait(timeout=40)
    if process.returncode!=0:raise RuntimeError('RELEASE_COMPLETION_REJECTED')
    final=call('complete')['proof']
    if not final or final['revision']!=ready['revision'] or final['status']!='complete':raise RuntimeError('RELEASE_COMPLETION_UNCONFIRMED')
    complete=True
    print('RELEASE_COMPLETE '+json.dumps({'releaseId':release_id,'revision':final['revision'],'receiptSha256':final['receiptSha256']}),flush=True)
except Exception as error:
    print('RELEASE_NOT_COMPLETE '+type(error).__name__+': '+str(error).split('\n')[0],file=sys.stderr)
finally:
    if prepared and not complete:
        try:call('fail')
        except Exception:print('RELEASE_FAILURE_SIGNAL_UNCONFIRMED '+release_id,file=sys.stderr)
    if process is not None and process.poll() is None:
        try:process.wait(timeout=15)
        except subprocess.TimeoutExpired:process.terminate()
raise SystemExit(0 if complete else 1)
