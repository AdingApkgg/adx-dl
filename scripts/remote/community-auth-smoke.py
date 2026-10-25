#!/usr/bin/env python3
"""SSH-owned, one-run production auth. The Mac relays TCP; Chromium runs on Linux."""
import base64, json, os, pathlib, re, secrets, socket, subprocess, sys, tempfile, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
BUILD = os.environ.get('ASTRODX_BUILD_HOST', 'i@localhost-1.tailac9c6f.ts.net')
PROD = os.environ.get('ASTRODX_PRODUCTION_HOST', 'i@arch.tailac9c6f.ts.net')
preview_chart = os.environ.get('PRODUCTION_PREVIEW_CHART', '')
preview_difficulty = os.environ.get('PRODUCTION_PREVIEW_DIFFICULTY', '')
if (preview_chart or preview_difficulty) and (not re.fullmatch('[1-9][0-9]{0,19}', preview_chart) or not re.fullmatch('[1-7]', preview_difficulty)):
    raise SystemExit('VALID_PREVIEW_TARGET_REQUIRED')
preview_env = {key: os.environ[key] for key in ['PRODUCTION_PREVIEW_CHART', 'PRODUCTION_PREVIEW_DIFFICULTY'] if os.environ.get(key)}
run_id, capability = secrets.token_hex(16), secrets.token_hex(32)
source = ROOT / 'apps/community/ops/acceptance/auth-bridge.ts'
remote = (ROOT / 'scripts/remote/community-auth-host.py').read_text()
tools = ROOT / 'apps/community/test/acceptance/production-smoke.mjs'
base_tree = subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD^{tree}'],text=True).strip()
processes = []
ready = None
proof = None
ssh_options = ['-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2']
def production(action):
    task = dict(action=action, runId=run_id, key=capability)
    if action == 'prepare': task['source'] = base64.b64encode(source.read_bytes()).decode()
    script = 'import json\ntask=json.loads(' + repr(json.dumps(task)) + ')\n' + remote
    result = subprocess.run(['ssh',*ssh_options,'-J',BUILD,PROD,'python3 -u -'],input=script,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=100)
    if result.returncode:
        raise RuntimeError('PRODUCTION_' + action.upper() + '_FAILED (private remote logs; no credentials printed)')
    return json.loads(result.stdout.strip().splitlines()[-1])
def builder(script, capture=False):
    return subprocess.run(['ssh',*ssh_options,BUILD,'python3 -u -'],input=script,text=True,stdout=subprocess.PIPE if capture else None,check=True,timeout=460)
def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); return sock.getsockname()[1]
def tunnel(arguments, errors):
    process = subprocess.Popen(['ssh',*ssh_options,'-o','ExitOnForwardFailure=yes','-N',*arguments],stdout=subprocess.DEVNULL,stderr=errors)
    processes.append(process); return process
status, cleanup = 1, None
with tempfile.TemporaryDirectory(prefix='adxc-smoke-ssh-') as scratch:
    try:
        ready = production('prepare')
        if os.environ.get('PRODUCTION_EXPECT_REVISION') and ready['productionRevision'] != os.environ['PRODUCTION_EXPECT_REVISION']:
            raise RuntimeError('EXPECTED_PRODUCTION_REVISION_MISMATCH')
        print('PRODUCTION_AUTH_BRIDGE_READY revision=' + ready['productionRevision'], flush=True)
        local_port = free_port()
        with open(pathlib.Path(scratch)/'tunnels.log','w') as errors:
            forward = tunnel(['-J',BUILD,'-L',f'127.0.0.1:{local_port}:127.0.0.1:{ready["port"]}',PROD], errors)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for attempt in range(80):
                if forward.poll() is not None: raise RuntimeError('PRODUCTION_FORWARD_FAILED')
                try:
                    request = urllib.request.Request(f'http://127.0.0.1:{local_port}/_smoke/health',headers={'Authorization':'Bearer '+capability})
                    with opener.open(request,timeout=1) as response:
                        assert json.loads(response.read())['active']; break
                except OSError: time.sleep(.2)
            else: raise RuntimeError('PRODUCTION_FORWARD_NOT_READY')
            choose = "import socket,os\nassert os.uname().nodename=='localhost'\nwith socket.socket() as s:\n s.bind(('127.0.0.1',0));print(s.getsockname()[1])\n"
            remote_port = int(builder(choose,capture=True).stdout.strip())
            reverse = tunnel(['-R',f'127.0.0.1:{remote_port}:127.0.0.1:{local_port}',BUILD],errors)
            payload = dict(previewEnv=preview_env,runId=run_id,key=capability,port=remote_port,source=base64.b64encode(tools.read_bytes()).decode(),tree=base_tree,revision=ready['productionRevision'],module=os.environ.get('ACCEPTANCE_PLAYWRIGHT_PATH','/home/i/astrodx-verify/public-browser-20261016/node_modules/playwright/index.mjs'))
            script = 'import json\ntask=json.loads(' + repr(json.dumps(payload)) + ')\n' + r'''
import base64, hashlib, os, pathlib, subprocess, time, urllib.request
assert os.uname().nodename == 'localhost'
os.umask(0o077)
root = pathlib.Path('/home/i/astrodx-verify/production-smoke') / ('auth-' + task['runId'])
root.mkdir(mode=0o700, parents=True)
script = base64.b64decode(task['source'])
(root/'smoke.mjs').write_bytes(script)
key_file=root/'bridge-key'; key_file.write_text(task['key'])
bridge='http://127.0.0.1:'+str(task['port'])
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
 for attempt in range(50):
  try:
   with opener.open(urllib.request.Request(bridge+'/_smoke/health',headers={'Authorization':'Bearer '+task['key']}),timeout=2) as response:
    assert json.loads(response.read())['active']; break
  except OSError: time.sleep(.2)
 else: raise RuntimeError('BUILDER_AUTH_TUNNEL_NOT_READY')
 env=dict(os.environ,PRODUCTION_AUTH_BRIDGE=bridge,PRODUCTION_BRIDGE_KEY_FILE=str(key_file),PRODUCTION_AUTH_ROLE='admin',PRODUCTION_EXPECT_USER_ID='1',PRODUCTION_EXPECT_REVISION=task['revision'],PRODUCTION_EVIDENCE_DIR=str(root/'evidence'),PRODUCTION_TOOL_BASE_TREE=task['tree'],PRODUCTION_SMOKE_SHA256=hashlib.sha256(script).hexdigest(),ACCEPTANCE_PLAYWRIGHT_PATH=task['module'])
 env.pop('PRODUCTION_STORAGE_STATE',None)
 for key in ['PRODUCTION_PREVIEW_CHART','PRODUCTION_PREVIEW_DIFFICULTY']: env.pop(key,None)
 env.update(task['previewEnv'])
 print('REMOTE_AUTH_HEADLESS_EVIDENCE '+str(root),flush=True)
 result=subprocess.run(['timeout','--signal=TERM','--kill-after=10s','420s','node',str(root/'smoke.mjs')],env=env)
 proof=root/'evidence/result.json'
 if proof.is_file(): print(proof.read_text(),flush=True)
 if result.returncode != 0: raise SystemExit(result.returncode)
 assert proof.is_file() and json.loads(proof.read_text())['authenticated']=='passed'
finally: key_file.unlink(missing_ok=True)
'''
            builder(script)
            read_proof = "import json,pathlib\np=pathlib.Path('/home/i/astrodx-verify/production-smoke/auth-" + run_id + "/evidence/result.json')\nprint(p.read_text())\n"
            proof = json.loads(builder(read_proof, capture=True).stdout)
            if reverse.poll() is not None: raise RuntimeError('REVERSE_TUNNEL_EXITED')
            status = 0
    except Exception as error:
        print('AUTH_SMOKE_FAILED '+type(error).__name__+': '+str(error).split('\n')[0],file=sys.stderr)
    finally:
        try:
            cleanup = production('cleanup')
            print('PRODUCTION_AUTH_CLEANUP '+json.dumps(cleanup),flush=True)
            if cleanup.get('cleanup')!='passed': status=1
        except Exception:
            print('PRODUCTION_AUTH_CLEANUP_UNCONFIRMED run='+run_id,file=sys.stderr);status=1
        for process in reversed(processes):
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill();process.wait()
if status == 0 and os.environ.get('PRODUCTION_RELEASE_RECEIPT'):
    receipt = dict(schema=1, releaseId=os.environ['COMMUNITY_RELEASE_ID'], smokeRunId=run_id, result=proof, cleanup=cleanup)
    target=pathlib.Path(os.environ['PRODUCTION_RELEASE_RECEIPT'])
    with open(target, 'x') as file:
        os.chmod(target,0o600);json.dump(receipt,file)
raise SystemExit(status)
