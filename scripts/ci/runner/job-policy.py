"""Host-installed admission hook for repository-scoped Linux runners.

This must be mounted read-only outside the checkout and run by job-started.sh.
Only administrators can change the policy. No command-line/env path override is
accepted. The policy is a guard against untrusted GitHub events, not a sandbox
for previously admitted trusted code or compromised third-party dependencies.

Runner v2.338.0 writes GitHub's context event immediately before running this
hook: JobHookProvider.cs:49 -> ExecutionContext.cs:1202-1216. It passes an empty
handler environment (JobHookProvider.cs:67), then ScriptHandler.cs:270-279
exports GitHubContext defaults; job/step env is not merged into this hook.
Nevertheless, the payload and context must both pass the checks below.

Returning a nonzero status alone is insufficient: StepsRunner.cs:182-235 still
evaluates later always()/failure() steps. Rejected jobs therefore terminate
their own Runner.Worker before the hook returns.

Source base: https://github.com/actions/runner/tree/v2.338.0/src/Runner.Worker
"""

from collections import namedtuple
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import time

Decision = namedtuple("Decision", "allowed reason")
POLICY_PATH = Path("/etc/gha-runner/policy.json")
EVENT_PATH = Path("/opt/actions-runner/_work/_temp/_github_workflow/event.json")
WORKER_EXECUTABLE = "/opt/actions-runner/bin/Runner.Worker"
MAX_JSON_BYTES = 32 * 1024 * 1024


def _require(condition, reason):
    if not condition:
        raise ValueError(reason)


def _strings(value, name, allow_empty=False):
    _require(isinstance(value, list) and (allow_empty or value), f"invalid policy {name}")
    _require(all(isinstance(item, str) and item for item in value), f"invalid policy {name}")
    _require(len(value) == len(set(value)), f"duplicate policy {name}")
    return value


def _valid_branch(branch):
    # Apply Git ref constraints to the branch portion. Nested names and dots
    # are legitimate; full refs belong in the context, not in this policy.
    return (branch != "@" and not branch.startswith(("/", "-", "refs/"))
            and not branch.endswith(("/", "."))
            and ".." not in branch and "//" not in branch and "@{" not in branch
            and not re.search(r"[\x00-\x20\x7f~^:?*\[\\]", branch)
            and all(not part.startswith(".") and not part.endswith(".lock")
                    for part in branch.split("/")))


def _validate_policy(policy):
    _require(isinstance(policy, dict), "policy is not an object")
    repository = policy.get("repository")
    _require(isinstance(repository, str) and re.fullmatch(r"[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+", repository)
             and repository.split("/")[1] not in {".", ".."}, "invalid policy repository")
    for key in ("repository_id", "owner_id"):
        _require(type(policy.get(key)) is int and policy[key] > 0, f"invalid policy {key}")
    branches = _strings(policy.get("trusted_branches"), "trusted_branches")
    _require(all(_valid_branch(branch) for branch in branches),
             "invalid trusted branch")
    workflows = _strings(policy.get("workflows"), "workflows")
    _require(all(re.fullmatch(r"\.github/workflows/[A-Za-z0-9_.-]+\.ya?ml", item)
                 for item in workflows), "invalid workflow path")
    schedules = _strings(policy.get("schedules", []), "schedules", allow_empty=True)
    scheduled_workflows = _strings(policy.get("schedule_workflows", []),
                                   "schedule_workflows", allow_empty=True)
    _require(set(scheduled_workflows).issubset(workflows), "scheduled workflow not in allowlist")
    _require(bool(schedules) == bool(scheduled_workflows), "incomplete schedule policy")


def validate_job(policy, event, environment):
    """Decide admission; errors, missing fields and unknown events deny by default."""
    try:
        _validate_policy(policy)
        _require(isinstance(event, dict), "event is not an object")
        # Check presence, not truthiness, before interpreting the claimed event.
        _require("pull_request" not in event and "number" not in event,
                 "pull request payload is prohibited")
        event_name = environment.get("GITHUB_EVENT_NAME")
        _require(event_name in {"push", "workflow_dispatch", "schedule"},
                 "event is not admitted")
        _require(not environment.get("GITHUB_HEAD_REF") and not environment.get("GITHUB_BASE_REF"),
                 "pull request context is prohibited")

        repository = event.get("repository")
        _require(isinstance(repository, dict), "missing event repository")
        _require(repository.get("full_name") == policy["repository"], "event repository mismatch")
        _require(type(repository.get("id")) is int and repository["id"] == policy["repository_id"],
                 "event repository id mismatch")
        owner = repository.get("owner")
        _require(isinstance(owner, dict) and type(owner.get("id")) is int
                 and owner["id"] == policy["owner_id"], "event owner id mismatch")
        _require(repository.get("fork") is False, "forked or incomplete repository payload")
        for context_key, policy_key in [("GITHUB_REPOSITORY", "repository"),
                                       ("GITHUB_REPOSITORY_ID", "repository_id"),
                                       ("GITHUB_REPOSITORY_OWNER_ID", "owner_id")]:
            _require(environment.get(context_key) == str(policy[policy_key]), "context repository mismatch")

        ref = environment.get("GITHUB_REF", "")
        _require(ref in {f"refs/heads/{branch}" for branch in policy["trusted_branches"]},
                 "ref is not a trusted branch")
        branch = ref.removeprefix("refs/heads/")
        workflow_ref = environment.get("GITHUB_WORKFLOW_REF", "")
        prefix = f'{policy["repository"]}/'
        suffix = f"@{ref}"
        _require(workflow_ref.startswith(prefix) and workflow_ref.endswith(suffix),
                 "workflow repository/ref mismatch")
        workflow = workflow_ref[len(prefix):-len(suffix)]
        _require(workflow in policy["workflows"], "workflow is not admitted")

        if event_name == "push":
            _require("action" not in event and "schedule" not in event and "inputs" not in event,
                     "payload is not a push")
            _require(event.get("ref") == ref and event.get("deleted") is False,
                     "push ref mismatch or deletion")
            after = event.get("after")
            _require(isinstance(after, str) and re.fullmatch(r"[0-9a-f]{40}", after)
                     and after != "0" * 40 and after == environment.get("GITHUB_SHA"),
                     "push commit mismatch")
            _require(isinstance(event.get("pusher"), dict) and isinstance(event.get("commits"), list),
                     "incomplete push payload")
        elif event_name == "workflow_dispatch":
            _require("inputs" in event and (event["inputs"] is None or isinstance(event["inputs"], dict)),
                     "missing dispatch inputs")
            _require("action" not in event and "after" not in event and "schedule" not in event,
                     "payload is not a dispatch")
            _require(event.get("ref") in {branch, ref}, "dispatch ref mismatch")
        else:
            _require("action" not in event and "after" not in event and "inputs" not in event,
                     "payload is not a schedule")
            _require(event.get("schedule") in policy.get("schedules", []), "schedule is not admitted")
            _require(workflow in policy.get("schedule_workflows", []), "scheduled workflow is not admitted")
            _require(repository.get("default_branch") == branch, "schedule is not on the default branch")
        return Decision(True, f"admitted {event_name} on {branch}")
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        return Decision(False, str(error))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def _read_json(path, protected=False):
    # Reject redirects anywhere in the fixed path, including its parents.
    _require(path.resolve(strict=True) == path, "JSON path is redirected")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "r", encoding="utf-8") as stream:
        metadata = os.fstat(stream.fileno())
        _require(stat.S_ISREG(metadata.st_mode) and metadata.st_size <= MAX_JSON_BYTES,
                 "invalid JSON file")
        if protected:
            _require(not metadata.st_mode & (stat.S_IWGRP | stat.S_IWOTH), "policy is group/world writable")
            _require(metadata.st_uid != os.geteuid() or not metadata.st_mode & stat.S_IWUSR,
                     "policy is writable by runner")
        return json.loads(stream.read(MAX_JSON_BYTES + 1), object_pairs_hook=_unique_object)


def check_job():
    """Read only the administrator policy and runner-written fixed event path."""
    try:
        policy = _read_json(POLICY_PATH, protected=True)
        event = _read_json(EVENT_PATH)
        return validate_job(policy, event, os.environ)
    except (OSError, ValueError, UnicodeError) as error:
        return Decision(False, f"cannot read admission inputs: {type(error).__name__}")


def find_worker_ancestor(proc_root=Path("/proc"), start_pid=None):
    """Find this hook's exact runner worker, never a different concurrent job."""
    pid = os.getppid() if start_pid is None else start_pid
    seen = set()
    for _ in range(64):
        if pid <= 1 or pid in seen:
            return None
        seen.add(pid)
        directory = proc_root / str(pid)
        try:
            if os.readlink(directory / "exe") == WORKER_EXECUTABLE:
                return pid
            status = (directory / "status").read_text()
            parent = re.search(r"^PPid:\s+(\d+)$", status, re.MULTILINE)
            if parent is None:
                return None
            pid = int(parent.group(1))
        except OSError:
            return None
    return None


def terminate_rejected_job():
    """Stop execution rather than let malicious always() steps follow a denial."""
    worker = find_worker_ancestor()
    if worker is not None:
        # pidfd avoids killing an unrelated process if a PID is reused.
        descriptor = os.pidfd_open(worker)
        try:
            _require(os.readlink(f"/proc/{worker}/exe") == WORKER_EXECUTABLE,
                     "worker executable changed")
            signal.pidfd_send_signal(descriptor, signal.SIGKILL)
        finally:
            os.close(descriptor)
        # The fatal signal terminates the worker and all its threads. Exit the
        # hook directly as well, so it cannot remain as an orphan process.
        os._exit(77)
    else:
        # A namespace's init normally ignores SIGKILL sent from inside that
        # namespace. Tini handles SIGTERM and forwards it to the listener. Only
        # stop a known container init, never a host init or arbitrary process.
        init = os.readlink("/proc/1/exe")
        _require(Path("/.dockerenv").is_file()
                 and init in {"/usr/bin/tini", "/usr/bin/docker-init", "/sbin/docker-init"},
                 "not a supported runner container")
        os.kill(1, signal.SIGTERM)
    # Never return after the container-level fallback: shutdown must end this
    # process. Ordinary exit(1) would permit subsequent workflow steps.
    while True:
        time.sleep(60)


def main():
    decision = check_job()
    print(f"Runner admission: {decision.reason}", flush=True)
    if decision.allowed:
        return 0
    try:
        terminate_rejected_job()
    except (OSError, ValueError) as error:
        print(f"Admission termination failed: {type(error).__name__}; blocking execution", flush=True)
        while True:
            time.sleep(60)


if __name__ == "__main__":
    sys.exit(main())
