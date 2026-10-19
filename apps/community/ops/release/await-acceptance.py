#!/usr/bin/env python3
"""Fail-closed release receipt checker. Runs under the deployment's host lock."""
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import time

REQUIRED_STEPS = {
    'explicit_session_and_role', 'catalog_chart_comments_and_download_link',
    'legacy_chart_and_user_redirects', 'three_language_forum_notices_help',
    'anonymous_private_routes_denied', 'mobile_catalog_and_forum_320_390',
    'signed_in_notifications_forum_and_comment_composers',
    'production_dashboard_permissions_and_pages', 'production_following_feed_and_alert_settings',
    'production_library_and_public_lists', 'production_download_center_and_list_admin',
    'production_author_workbench_and_imports', 'production_author_review_compare_and_denials',
    'production_bridge_write_denial_and_session_revocation',
}

def atomic(path, value):
    path = pathlib.Path(path)
    temp = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    with open(temp, 'x', encoding='utf8') as file:
        os.chmod(temp, 0o600)
        file.write(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')
    os.replace(temp, path)

def private_file(path):
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077 or metadata.st_size > 262144:
        raise ValueError('PRIVATE_RECEIPT_REQUIRED')
    return json.loads(path.read_text())

def required_preview():
    chart = os.environ.get('PRODUCTION_PREVIEW_CHART', '')
    difficulty = os.environ.get('PRODUCTION_PREVIEW_DIFFICULTY', '')
    if not chart and not difficulty: return None
    if not re.fullmatch('[1-9][0-9]{0,19}', chart) or not re.fullmatch('[1-7]', difficulty):
        raise ValueError('VALID_PREVIEW_TARGET_REQUIRED')
    return {'chart':chart, 'difficulty':int(difficulty)}

def context():
    run = os.environ.get('COMMUNITY_RELEASE_ID', '')
    directory = pathlib.Path(os.environ.get('COMMUNITY_RELEASE_DIR', '.'))
    timeout = os.environ.get('COMMUNITY_RELEASE_TIMEOUT', '600')
    if not re.fullmatch('[a-f0-9]{32}', run) or not directory.is_absolute() or not re.fullmatch('[1-9][0-9]{0,3}', timeout) or int(timeout) > 1800:
        raise ValueError('FORMAL_RELEASE_CONTEXT_REQUIRED')
    meta = directory.lstat()
    if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != os.getuid() or meta.st_mode & 0o077 or (directory/'.owner').read_text().strip() != run:
        raise ValueError('RELEASE_DIRECTORY_NOT_OWNED')
    digest = os.environ.get('COMMUNITY_SMOKE_SHA256', '')
    if not re.fullmatch('[a-f0-9]{64}', digest): raise ValueError('SMOKE_SCRIPT_DIGEST_REQUIRED')
    required_preview()
    return run, directory, int(timeout), digest

def runtime_snapshot():
    ids = subprocess.check_output(['docker','compose','ps','-q','web','worker','media-worker'], text=True).split()
    if len(ids) != 3: raise ValueError('THREE_RUNNING_ROLES_REQUIRED')
    containers = json.loads(subprocess.check_output(['docker','inspect',*ids], text=True))
    roles = {}
    for item in containers:
        role = item['Config']['Labels']['com.docker.compose.service']
        if not item['State']['Running']: raise ValueError('ROLE_NOT_RUNNING')
        roles[role] = { 'id': item['Id'], 'image': item['Image'], 'startedAt': item['State']['StartedAt'] }
    if set(roles) != {'web','worker','media-worker'}: raise ValueError('ROLE_IDENTITY_MISMATCH')
    return roles

def validate(receipt, ready):
    result, cleanup = receipt.get('result', {}), receipt.get('cleanup', {})
    checks = [
        receipt.get('schema') == 1, receipt.get('releaseId') == ready['releaseId'],
        isinstance(receipt.get('smokeRunId'), str) and re.fullmatch('[a-f0-9]{32}', receipt['smokeRunId']) is not None,
        result.get('status') == 'passed', result.get('authenticated') == 'passed',
        result.get('role') == 'admin', result.get('headless') is True,
        result.get('authTransport') == 'ssh-readonly-bridge-to-public-production',
        result.get('productionRevision') == ready['revision'],
        result.get('smokeSha256') == ready['smokeSha256'],
        result.get('sessionRevoked') is True, result.get('businessWrites') is False,
        all(type(result.get(key)) is int and result[key] == 0 for key in ['pageErrors','routeFailures','blockedBusinessWrites']),
        REQUIRED_STEPS.issubset(set(result.get('steps', []))),
        cleanup.get('cleanup') == 'passed', cleanup.get('sessionRevoked') is True,
        cleanup.get('webNotRestarted') is True,
        cleanup.get('runId') == receipt.get('smokeRunId'),
    ]
    if ready.get('requiredPreview'):
        preview = result.get('previewCoverage') or {}
        target = ready['requiredPreview']
        checks.extend([
            'production_required_chart_preview' in result.get('steps', []),
            preview.get('chart') == target['chart'],
            type(preview.get('difficulty')) is int and preview['difficulty'] == target['difficulty'],
            type(preview.get('slotWarnings')) is int and preview['slotWarnings'] == 0,
            all(preview.get(key) is True for key in ['apiSupported','maidataLoaded','maidataMatchesSummary','ready','clockAdvanced','pauseStable','seekSucceeded']),
        ])
    if not all(checks): raise ValueError('HEADLESS_RELEASE_RECEIPT_REJECTED')
    started = dt.datetime.fromisoformat(result['startedAt'].replace('Z','+00:00')).timestamp()
    if started < ready['startedAt'] - 5 or started > time.time() + 5 or time.time() - started > 900:
        raise ValueError('STALE_RELEASE_RECEIPT')

def main():
    os.umask(0o077)
    run, directory, timeout, digest = context()
    mode = sys.argv[1]
    if mode == '--preflight': return
    revision = sys.argv[2]
    if not re.fullmatch('[a-f0-9]{7,64}', revision): raise ValueError('REVISION_REQUIRED')
    if mode == '--candidate':
        expected = os.environ.get('COMMUNITY_RELEASE_SOURCE_REVISION', '')
        if not re.fullmatch('[a-f0-9]{40}', expected) or revision != expected:
            raise ValueError('UPDATE_OPERATOR_TO_TARGET_SOURCE_REVISION')
        return
    if mode == '--await':
        ready = { 'releaseId':run, 'revision':revision, 'startedAt':time.time(), 'smokeSha256':digest, 'runtime':runtime_snapshot() }
        if required_preview(): ready['requiredPreview'] = required_preview()
        atomic(directory/'ready.json', ready)
        atomic('.release-status.json', { 'status':'awaiting_acceptance', **ready })
        print('== 应用已切换，自动等待生产登录态验收', flush=True)
        deadline = time.monotonic() + timeout
        try:
            while time.monotonic() < deadline:
                if (directory/'failed.json').exists(): raise ValueError('HEADLESS_RELEASE_GATE_FAILED')
                if (directory/'acceptance.json').exists():
                    receipt = private_file(directory/'acceptance.json')
                    validate(receipt, ready)
                    if runtime_snapshot() != ready['runtime']: raise ValueError('RUNTIME_CHANGED_DURING_ACCEPTANCE')
                    if pathlib.Path('.serving-revision').read_text().strip() != revision: raise ValueError('SERVING_REVISION_CHANGED')
                    atomic(directory/'accepted.json', { 'status':'accepted', 'receiptSha256':hashlib.sha256((directory/'acceptance.json').read_bytes()).hexdigest(), **ready })
                    return
                time.sleep(.25)
            raise ValueError('HEADLESS_RELEASE_GATE_TIMEOUT')
        except Exception:
            atomic('.release-status.json', { 'status':'failed', **ready })
            raise
    elif mode == '--complete':
        try:
            accepted = private_file(directory/'accepted.json')
            if accepted.get('releaseId') != run or accepted.get('smokeSha256') != digest: raise ValueError('COMPLETION_CONTEXT_MISMATCH')
            receipt = private_file(directory/'acceptance.json')
            validate(receipt, accepted)
            if accepted['revision'] != revision or accepted['runtime'] != runtime_snapshot(): raise ValueError('COMPLETION_RUNTIME_MISMATCH')
            if hashlib.sha256((directory/'acceptance.json').read_bytes()).hexdigest() != accepted['receiptSha256']: raise ValueError('ACCEPTED_RECEIPT_CHANGED')
            if pathlib.Path('.serving-revision').read_text().strip() != revision: raise ValueError('SERVING_REVISION_CHANGED')
            atomic('.deploy-revision', revision + '\n')
            complete = { 'status':'complete', 'completedAt':dt.datetime.now(dt.timezone.utc).isoformat(), **accepted }
            complete['status'] = 'complete'
            atomic(directory/'complete.json', complete)
            atomic('.release-status.json', complete)
        except Exception:
            atomic('.release-status.json', {'status':'failed', 'releaseId':run, 'revision':revision})
            raise
    else: raise ValueError('UNKNOWN_GATE_ACTION')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        # No Docker inspect payload, receipt body or credentials reach stderr.
        message = str(error)
        reason = message if isinstance(error, ValueError) and re.fullmatch('[A-Z][A-Z0-9_]+', message) else type(error).__name__
        print('RELEASE_GATE_FAILED ' + reason, file=sys.stderr)
        raise SystemExit(1)
