"""Run on the remote runner host: python3 -m unittest discover -s . -v."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "job_policy", Path(__file__).with_name("job-policy.py")
)
job_policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(job_policy)

REPOSITORY = "AdingApkgg/adx-dl"
SHA = "a" * 40
POLICY = {
    "repository": REPOSITORY,
    "repository_id": 1267897301,
    "owner_id": 119665355,
    "trusted_branches": ["main", "dev", "pre"],
    "workflows": [
        ".github/workflows/web-check.yml",
        ".github/workflows/community-check.yml",
        ".github/workflows/dash-check.yml",
        ".github/workflows/deploy-gh-pages.yml",
        ".github/workflows/runner-smoke.yml",
    ],
    "schedule_workflows": [".github/workflows/deploy-gh-pages.yml"],
    "schedules": ["0 20 * * *"],
}


def fixture(event_name="push", branch="main", workflow="web-check.yml"):
    event = {
        "repository": {
            "full_name": REPOSITORY,
            "id": 1267897301,
            "owner": {"login": "AdingApkgg", "id": 119665355},
            "default_branch": "main",
            "fork": False,
        },
    }
    env = {
        "GITHUB_EVENT_NAME": event_name,
        "GITHUB_REPOSITORY": REPOSITORY,
        "GITHUB_REPOSITORY_ID": "1267897301",
        "GITHUB_REPOSITORY_OWNER_ID": "119665355",
        "GITHUB_REF": f"refs/heads/{branch}",
        "GITHUB_HEAD_REF": "",
        "GITHUB_BASE_REF": "",
        "GITHUB_SHA": SHA,
        "GITHUB_WORKFLOW_REF": f"{REPOSITORY}/.github/workflows/{workflow}@refs/heads/{branch}",
    }
    if event_name == "push":
        event.update(ref=f"refs/heads/{branch}", after=SHA, before="b" * 40,
                     deleted=False, pusher={"name": "AdingApkgg"}, commits=[])
    elif event_name == "workflow_dispatch":
        event.update(ref=branch, inputs={})
    elif event_name == "schedule":
        event["schedule"] = "0 20 * * *"
    else:
        event.update(action="opened", number=5, pull_request={"head": {"ref": "attack"}})
    return event, env


class JobPolicyTests(unittest.TestCase):
    def decision(self, event, env, policy=None):
        return job_policy.validate_job(copy.deepcopy(policy or POLICY), event, env)

    def test_push_allows_only_trusted_branches(self):
        for branch, allowed in [("main", True), ("dev", True), ("pre", True),
                                ("feature", False), ("main/attack", False)]:
            with self.subTest(branch=branch):
                event, env = fixture(branch=branch)
                self.assertEqual(self.decision(event, env).allowed, allowed)

    def test_rejects_pr_even_when_environment_claims_push(self):
        event, _ = fixture("pull_request")
        _, env = fixture()
        event.update(ref="refs/heads/main", after=SHA, deleted=False)
        env["GITHUB_EVENT_PATH"] = "/tmp/fake-push.json"
        self.assertFalse(self.decision(event, env).allowed)

    def test_rejects_pull_request_target_on_main(self):
        event, env = fixture("pull_request_target")
        self.assertFalse(self.decision(event, env).allowed)

    def test_even_null_pull_request_payload_is_rejected(self):
        event, env = fixture()
        event["pull_request"] = None
        self.assertFalse(self.decision(event, env).allowed)

    def test_rejects_pr_refs_in_context(self):
        for key, value in [("GITHUB_REF", "refs/pull/5/merge"),
                           ("GITHUB_HEAD_REF", "attack"), ("GITHUB_BASE_REF", "main")]:
            event, env = fixture()
            env[key] = value
            with self.subTest(key=key):
                self.assertFalse(self.decision(event, env).allowed)

    def test_repository_identity_must_match_payload_and_context(self):
        for location in ["full_name", "id", "owner", "env_repo", "env_id", "env_owner"]:
            event, env = fixture()
            if location == "full_name":
                event["repository"]["full_name"] = "attacker/adx-dl"
            elif location == "id":
                event["repository"]["id"] = 99
            elif location == "owner":
                event["repository"]["owner"]["id"] = 99
            else:
                env[{"env_repo": "GITHUB_REPOSITORY", "env_id": "GITHUB_REPOSITORY_ID",
                     "env_owner": "GITHUB_REPOSITORY_OWNER_ID"}[location]] = "99"
            with self.subTest(location=location):
                self.assertFalse(self.decision(event, env).allowed)

    def test_missing_or_forked_payload_repository_is_rejected(self):
        for value in [None, {}, {"full_name": REPOSITORY}, {**fixture()[0]["repository"], "fork": True}]:
            event, env = fixture()
            event["repository"] = value
            with self.subTest(repository=value):
                self.assertFalse(self.decision(event, env).allowed)

    def test_push_requires_matching_ref_sha_and_nondeleted_branch(self):
        for key, value in [("ref", "refs/tags/main"), ("after", "c" * 40),
                           ("after", "0" * 40), ("deleted", True), ("deleted", "false")]:
            event, env = fixture()
            event[key] = value
            with self.subTest(key=key, value=value):
                self.assertFalse(self.decision(event, env).allowed)

    def test_dispatch_allows_bare_or_full_branch_ref(self):
        for branch in ["main", "dev", "pre"]:
            for event_ref in [branch, f"refs/heads/{branch}"]:
                event, env = fixture("workflow_dispatch", branch)
                event["ref"] = event_ref
                with self.subTest(branch=branch, event_ref=event_ref):
                    self.assertTrue(self.decision(event, env).allowed)

    def test_dispatch_inputs_cannot_change_policy(self):
        event, env = fixture("workflow_dispatch", "feature")
        event["inputs"] = {"ref": "main", "repository": REPOSITORY,
                           "GITHUB_EVENT_NAME": "push"}
        self.assertFalse(self.decision(event, env).allowed)

    def test_dispatch_must_have_dispatch_payload_not_spoofed_push(self):
        event, env = fixture()
        env["GITHUB_EVENT_NAME"] = "workflow_dispatch"
        self.assertFalse(self.decision(event, env).allowed)

    def test_schedule_is_limited_to_deploy_on_default_trusted_branch(self):
        event, env = fixture("schedule", workflow="deploy-gh-pages.yml")
        self.assertTrue(self.decision(event, env).allowed)
        for change in ["wrong_workflow", "wrong_cron", "wrong_branch"]:
            item, context = copy.deepcopy(event), dict(env)
            if change == "wrong_workflow":
                context["GITHUB_WORKFLOW_REF"] = f"{REPOSITORY}/.github/workflows/web-check.yml@refs/heads/main"
            elif change == "wrong_cron":
                item["schedule"] = "* * * * *"
            else:
                context["GITHUB_REF"] = "refs/heads/dev"
            with self.subTest(change=change):
                self.assertFalse(self.decision(item, context).allowed)

    def test_spoofed_schedule_cannot_bypass_pr_payload(self):
        event, _ = fixture("pull_request_target")
        _, env = fixture("schedule", workflow="deploy-gh-pages.yml")
        event["schedule"] = "0 20 * * *"
        self.assertFalse(self.decision(event, env).allowed)

    def test_unknown_events_and_workflows_are_denied(self):
        event, env = fixture()
        env["GITHUB_EVENT_NAME"] = "repository_dispatch"
        self.assertFalse(self.decision(event, env).allowed)
        event, env = fixture(workflow="attacker.yml")
        self.assertFalse(self.decision(event, env).allowed)

    def test_workflow_ref_must_match_repository_and_branch(self):
        for value in [f"attacker/adx-dl/.github/workflows/web-check.yml@refs/heads/main",
                      f"{REPOSITORY}/.github/workflows/web-check.yml@refs/pull/5/head",
                      f"{REPOSITORY}/.github/workflows/web-check.yml@refs/heads/dev"]:
            event, env = fixture()
            env["GITHUB_WORKFLOW_REF"] = value
            with self.subTest(workflow_ref=value):
                self.assertFalse(self.decision(event, env).allowed)

    def test_invalid_policy_fails_closed(self):
        for key, value in [("repository_id", True), ("owner_id", 0),
                           ("trusted_branches", []), ("workflows", []),
                           ("repository", "../attack/repo")]:
            policy = copy.deepcopy(POLICY)
            policy[key] = value
            event, env = fixture()
            with self.subTest(key=key):
                self.assertFalse(self.decision(event, env, policy).allowed)

    def test_accepts_legitimate_nested_branch_and_dotted_workflow_filename(self):
        policy = copy.deepcopy(POLICY)
        policy["trusted_branches"].append("release/main")
        policy["workflows"].append(".github/workflows/ci.build.yml")
        event, env = fixture(branch="release/main", workflow="ci.build.yml")
        self.assertTrue(self.decision(event, env, policy).allowed)

    def test_rejects_invalid_ref_names_and_workflow_traversal(self):
        for branch in ["release/../main", "release//main", "release/.main", "release/main.lock",
                       "release/main.", "release/main@{x}", "release/main ", "refs/pull/5/merge"]:
            policy = copy.deepcopy(POLICY)
            policy["trusted_branches"] = [branch]
            event, env = fixture(branch=branch)
            with self.subTest(branch=branch):
                self.assertFalse(self.decision(event, env, policy).allowed)
        policy = copy.deepcopy(POLICY)
        policy["workflows"].append(".github/workflows/../ci.build.yml")
        event, env = fixture()
        self.assertFalse(self.decision(event, env, policy).allowed)

    def test_fixed_event_path_ignores_fake_environment_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy_path, event_path, fake_path = root / "policy.json", root / "event.json", root / "fake.json"
            policy_path.write_text(json.dumps(POLICY))
            policy_path.chmod(0o444)
            event, _ = fixture("pull_request")
            event_path.write_text(json.dumps(event))
            fake_event, env = fixture()
            fake_path.write_text(json.dumps(fake_event))
            env["GITHUB_EVENT_PATH"] = str(fake_path)
            with patch.object(job_policy, "POLICY_PATH", policy_path), \
                 patch.object(job_policy, "EVENT_PATH", event_path), \
                 patch.dict(os.environ, env, clear=True):
                self.assertFalse(job_policy.check_job().allowed)

    def test_missing_malformed_duplicate_key_or_symlink_payload_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy_path, event_path = root / "policy.json", root / "event.json"
            policy_path.write_text(json.dumps(POLICY))
            policy_path.chmod(0o444)
            _, env = fixture()
            with patch.object(job_policy, "POLICY_PATH", policy_path), \
                 patch.object(job_policy, "EVENT_PATH", event_path), \
                 patch.dict(os.environ, env, clear=True):
                self.assertFalse(job_policy.check_job().allowed)
                for content in ['{', '{"ref":"attack","ref":"main"}', '[]']:
                    event_path.write_text(content)
                    self.assertFalse(job_policy.check_job().allowed)
                event_path.unlink()
                target = root / "valid.json"
                target.write_text(json.dumps(fixture()[0]))
                event_path.symlink_to(target)
                self.assertFalse(job_policy.check_job().allowed)

    def test_finds_worker_only_in_own_ancestry_with_exact_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for pid, parent, executable in [(30, 20, "/usr/bin/python3"),
                                             (20, 10, "/bin/bash"),
                                             (10, 1, "/opt/actions-runner/bin/Runner.Worker"),
                                             (50, 1, "/opt/actions-runner/bin/Runner.Worker")]:
                proc = root / str(pid)
                proc.mkdir()
                (proc / "status").write_text(f"Name:\tworker\nPPid:\t{parent}\n")
                (proc / "exe").symlink_to(executable)
            self.assertEqual(job_policy.find_worker_ancestor(root, 30), 10)
            (root / "10" / "exe").unlink()
            (root / "10" / "exe").symlink_to("/tmp/Runner.Worker")
            self.assertIsNone(job_policy.find_worker_ancestor(root, 30))

    @unittest.skipUnless(sys.platform == "linux" and hasattr(os, "pidfd_open"), "Linux pidfd required")
    def test_denial_kills_actual_worker_before_following_step_and_leaves_no_hook(self):
        # A private copy of bash acts as this fixture's runner worker. The real
        # /proc ancestry and pidfd signal are exercised without touching a real
        # runner, other jobs, or container PID1.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker = root / "Runner.Worker"
            shutil.copy2("/bin/bash", worker)
            child = root / "hook.py"
            marker = root / "following-step-ran"
            source = Path(__file__).with_name("job-policy.py")
            child.write_text(
                "import importlib.util\n"
                f"spec = importlib.util.spec_from_file_location('policy', {str(source)!r})\n"
                "policy = importlib.util.module_from_spec(spec)\n"
                "spec.loader.exec_module(policy)\n"
                f"policy.WORKER_EXECUTABLE = {str(worker)!r}\n"
                "policy.terminate_rejected_job()\n"
            )
            command = (f"{shlex.quote(sys.executable)} -I {shlex.quote(str(child))}; "
                       f"printf executed > {shlex.quote(str(marker))}")
            process = subprocess.Popen([str(worker), "-c", command], stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, start_new_session=True)
            try:
                try:
                    stdout, stderr = process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    self.fail("rejected worker/hook did not terminate cleanly")
                self.assertEqual(process.returncode, -signal.SIGKILL, (stdout, stderr))
                self.assertFalse(marker.exists(), "following always() step executed after denial")
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
