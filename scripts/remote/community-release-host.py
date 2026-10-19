# This module is sent over the existing authenticated production SSH connection.
import base64, hashlib, json, os, pathlib, re, subprocess
assert os.uname().nodename == 'arch'
os.umask(0o077)
assert re.fullmatch('[a-f0-9]{32}', task['releaseId'])
root = pathlib.Path('/home/i/astrodx-community-releases') / task['releaseId']
deployment = pathlib.Path('/home/i/astrodx-dash-src/apps/community')
if task['action'] == 'prepare':
    assert re.fullmatch('[a-f0-9]{64}',task['toolsDigest'])
    assert not root.exists()
    root.mkdir(mode=0o700, parents=True)
    (root/'.owner').write_text(task['releaseId'])
    tools = pathlib.Path('/home/i/astrodx-release-tools') / task['toolsDigest']
    tools.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name, encoded in task['files'].items():
        assert name in ['apps/community/deploy.sh','apps/community/ops/release/await-acceptance.py']
        content = base64.b64decode(encoded)
        path = tools/name
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if path.exists(): assert path.read_bytes() == content
        else: path.write_bytes(content); path.chmod(0o700)
    (root/'tools.json').write_text(json.dumps({'path':str(tools),'digest':task['toolsDigest'],'baseCommit':task['baseCommit']}))
    print(json.dumps({'prepared':True,'releaseId':task['releaseId']}))
else:
    assert (root/'.owner').read_text() == task['releaseId'] and root.stat().st_uid == os.getuid()
    action = task['action']
    if action == 'start':
        tools = pathlib.Path(json.loads((root/'tools.json').read_text())['path'])
        if task['mode'] != '--verify-current':
            assert not subprocess.check_output(['git','-C',str(deployment),'status','--porcelain','--untracked-files=no'],text=True).strip(), 'PRODUCTION_TRACKED_CHANGES_PRESENT'
        env = dict(os.environ)
        # Compose must use its existing .env rather than ambient shadow variables.
        for line in (deployment/'.env').read_text().splitlines():
            if line.strip() and not line.lstrip().startswith('#'):
                key = line.split('=',1)[0]
                assert re.fullmatch('[A-Z][A-Z0-9_]*',key)
                env.pop(key,None)
        overlay = deployment/'.superpowers/napcat-reuse.compose.yaml'
        env.update(COMMUNITY_DEPLOY_DIR=str(deployment),COMMUNITY_RELEASE_ID=task['releaseId'],COMMUNITY_RELEASE_DIR=str(root),COMMUNITY_SMOKE_SHA256=task['smokeSha256'],COMMUNITY_RELEASE_TIMEOUT='600',COMMUNITY_RELEASE_SOURCE_REVISION=task['baseCommit'])
        for key in ['PRODUCTION_PREVIEW_CHART','PRODUCTION_PREVIEW_DIFFICULTY']:
            env.pop(key,None)
        preview_env=task.get('previewEnv',{})
        assert set(preview_env).issubset({'PRODUCTION_PREVIEW_CHART','PRODUCTION_PREVIEW_DIFFICULTY'})
        env.update(preview_env)
        if overlay.is_file():env['COMPOSE_FILE']='compose.yaml:.superpowers/napcat-reuse.compose.yaml'
        args=['bash',str(tools/'apps/community/deploy.sh')]
        if task['mode']:args.append(task['mode'])
        with open(root/'deploy.log','w') as log:
            # Git/Docker public source must remain readable by the non-root smoke tool.
            # Private release files stay under this parent's 077 umask and 0700 context.
            result=subprocess.run(args,env=env,stdout=log,stderr=subprocess.STDOUT,umask=0o022)
        print(json.dumps({'deployExitCode':result.returncode}))
        raise SystemExit(result.returncode)
    elif action in ['receipt','fail']:
        name='acceptance.json' if action=='receipt' else 'failed.json'
        temp=root/(name+'.incoming')
        assert not temp.exists() and not temp.is_symlink()
        data=task.get('receipt',{'failed':True})
        encoded=json.dumps(data)
        assert len(encoded)<=262144
        with open(temp,'x') as file:file.write(encoded)
        os.replace(temp,root/name)
        print(json.dumps({'written':name}))
    elif action in ['ready','complete']:
        name='ready.json' if action=='ready' else 'complete.json'
        path=root/name
        proof=json.loads(path.read_text()) if path.exists() else None
        if action=='complete' and proof:
            assert (deployment/'.deploy-revision').read_text().strip()==proof['revision']
            assert proof['status']=='complete'
        print(json.dumps({'proof':proof}))
    else:raise ValueError('UNKNOWN_RELEASE_ACTION')
