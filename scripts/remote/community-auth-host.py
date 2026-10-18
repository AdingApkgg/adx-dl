# Executed only over authenticated SSH, with input injected by the local controller.
import os, pathlib, subprocess, json, base64, time, urllib.request, urllib.error
assert os.uname().nodename == 'arch'
os.umask(0o077)
root = pathlib.Path('/home/i/astrodx-verify/auth-smoke') / task['runId']
name = 'adxc-readonly-smoke-' + task['runId'][:16]
def docker(*args, **kwargs):
    return subprocess.check_output(['docker', *args], text=True, stderr=subprocess.PIPE, **kwargs)
def inspect(name): return json.loads(docker('inspect', name))[0]
def call(port, path, method='GET', authenticated=True):
    headers = {'Authorization': 'Bearer ' + task['key']} if authenticated else {}
    headers['User-Agent'] = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/145.0.0.0 Safari/537.36'
    request = urllib.request.Request('http://127.0.0.1:' + str(port) + path, headers=headers, method=method)
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=30) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as error: return error.code, error.read(), error.headers
web = inspect('astrodx-community-web-1')
assert web['State']['Running']
if task['action'] == 'prepare':
    assert not root.exists()
    (root / 'tools').mkdir(parents=True, mode=0o700)
    (root / '.owner').write_text(task['runId'])
    (root / 'tools/auth-bridge.ts').write_bytes(base64.b64decode(task['source']))
    state = {'webId': web['Id'], 'webStartedAt': web['State']['StartedAt'], 'image': web['Image'], 'runId': task['runId'], 'container': name}
    state['revision'] = pathlib.Path('/home/i/astrodx-dash-src/apps/community/.deploy-revision').read_text().strip()
    (root / 'state.json').write_text(json.dumps(state))
    env = dict(x.split('=', 1) for x in web['Config']['Env'])
    allowed = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'PUBLIC_ORIGIN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'COMMUNITY_ADMIN_PUBLIC_IDS', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']
    env = {k: v for k, v in env.items() if k in allowed}
    env.update(SMOKE_RUN_ID=task['runId'], SMOKE_BRIDGE_KEY=task['key'], SMOKE_USER_PUBLIC_ID='1', NODE_ENV='production')
    args = ['run', '-d', '--name', name, '--label', 'adxc.smoke.run=' + task['runId'], '--network', 'astrodx-community_default', '--user', str(os.getuid())+':'+str(os.getgid()), '--add-host', 'host.docker.internal:host-gateway', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=16m', '--cpus', '1', '--memory', '512m', '--pids-limit', '128', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--publish', '127.0.0.1::41910', '--mount', 'type=bind,src=' + str(root / 'tools') + ',dst=/repo/apps/community/ops/acceptance,readonly']
    for key in env: args.extend(['-e', key])
    args.extend(['--entrypoint', 'bun', web['Image'], './ops/acceptance/auth-bridge.ts'])
    docker(*args, env=dict(os.environ, **env))
    port = int(inspect(name)['NetworkSettings']['Ports']['41910/tcp'][0]['HostPort'])
    state['port'] = port
    (root / 'state.json').write_text(json.dumps(state))
    for attempt in range(80):
        if not inspect(name)['State']['Running']: raise RuntimeError('BRIDGE_EXITED_DURING_STARTUP')
        try:
            status, body, _ = call(port, '/_smoke/health')
            if status == 200 and json.loads(body)['active']: break
        except (OSError, ValueError): pass
        time.sleep(.25)
    else: raise RuntimeError('BRIDGE_NOT_READY')
    assert call(port, '/api/v1/me', authenticated=False)[0] == 401
    assert call(port, '/api/auth/get-session')[0] == 403
    for method in ['POST','PATCH','DELETE']:
        assert call(port, '/api/v1/discussions/topics', method=method)[0] == 405
    status, body, headers = call(port, '/api/v1/me')
    probe = {'status':status,'jsonResponse':'json' in headers.get('content-type',''),'cookieHeaderAbsent':not bool(headers.get('Set-Cookie'))}
    (root/'probe.json').write_text(json.dumps(probe))
    assert status == 200 and json.loads(body)['publicId'] == '1' and json.loads(body)['isAdmin'] is True
    assert not headers.get('Set-Cookie') and not headers.get('set-auth-token')
    print(json.dumps({'ready': True, 'port': port, 'runId': task['runId'], 'productionRevision': state['revision'], 'boundaryChecks': 'passed'}), flush=True)
else:
    if not root.exists(): print(json.dumps({'cleanup': 'nothing-created'})); raise SystemExit(0)
    assert (root / '.owner').read_text() == task['runId']
    state = json.loads((root / 'state.json').read_text())
    containers = docker('ps', '-aq', '--filter', 'name=^/' + name + '$').strip()
    logs = ''
    if containers:
        container = inspect(name)
        assert container['Config']['Labels']['adxc.smoke.run'] == task['runId']
        if container['State']['Running']: docker('stop', '--time', '15', name)
        logs = docker('logs', name)
    events = []
    for line in logs.splitlines():
        try:
            item = json.loads(line)
            if item.get('runId') == task['runId'] and item.get('event') in ['session_issued','session_revoked','run_sessions_revoked','local_auth_verified']:
                safe = {k:v for k,v in item.items() if k in ['event','runId','publicId','expiresAt','verified','originalSessionsPreserved','rejectedWrites','reads','count','valid'] and isinstance(v,(str,bool,int))}
                events.append(safe)
        except ValueError: pass
    if not any(x.get('event') == 'session_revoked' and x.get('verified') for x in events):
        # Crash/timeout fallback revokes ONLY this run's own marked operator session.
        env = dict(x.split('=', 1) for x in web['Config']['Env'])
        allowed = ['DATABASE_URL','BETTER_AUTH_SECRET','PUBLIC_ORIGIN','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','COMMUNITY_ADMIN_PUBLIC_IDS','HTTPS_PROXY','https_proxy']
        env = {k:v for k,v in env.items() if k in allowed}
        env.update(SMOKE_RUN_ID=task['runId'], SMOKE_BRIDGE_KEY=task['key'], SMOKE_USER_PUBLIC_ID='1', NODE_ENV='production')
        args = ['run', '--rm', '--network', 'astrodx-community_default', '--user', str(os.getuid())+':'+str(os.getgid()), '--add-host', 'host.docker.internal:host-gateway', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=16m', '--cpus','1','--memory','512m','--pids-limit','128','--cap-drop=ALL','--security-opt=no-new-privileges','--mount','type=bind,src='+str(root/'tools')+',dst=/repo/apps/community/ops/acceptance,readonly']
        for key in env: args.extend(['-e',key])
        args.extend(['--entrypoint','bun',state['image'],'./ops/acceptance/auth-bridge.ts','--cleanup-only'])
        safe = docker(*args, env=dict(os.environ,**env))
        for line in safe.splitlines():
            try:
                item=json.loads(line)
                if item.get('runId')==task['runId'] and item.get('event')=='run_sessions_revoked':
                    events.append({k:v for k,v in item.items() if k in ['event','runId','verified','count'] and isinstance(v,(str,bool,int))})
            except ValueError: pass
    assert any(x.get('event') in ['session_revoked','run_sessions_revoked'] and x.get('verified') for x in events), 'SESSION_CLEANUP_UNCONFIRMED'
    if containers: docker('rm', name)
    current = inspect('astrodx-community-web-1')
    assert current['Id'] == state['webId'] and current['State']['StartedAt'] == state['webStartedAt'] and current['State']['Running'], 'PRODUCTION_WEB_CHANGED'
    proof = {'cleanup': 'passed', 'runId': task['runId'], 'sessionRevoked': True, 'webNotRestarted': True, 'events': events}
    (root / 'cleanup.json').write_text(json.dumps(proof, indent=2)+'\n')
    print(json.dumps(proof), flush=True)
