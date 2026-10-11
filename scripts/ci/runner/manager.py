#!/usr/bin/env python3
"""Manage separate personal-repository runners on a remote Docker host."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
IMAGE = "managed-gha-runner:2.338.0"
DIND_IMAGE = "docker:29.8.2-dind"


def repository_key(repository):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*", repository):
        raise ValueError("Repository must be OWNER/REPO, without URLs or shell syntax")
    canonical = repository.lower()
    slug = re.sub(r"[^a-z0-9-]", "-", canonical)[:35].strip("-")
    return slug + "-" + hashlib.sha256(canonical.encode()).hexdigest()[:8]


def instance_key(repository, instance):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,24}", instance):
        raise ValueError("Instance must be a short lowercase name")
    return repository_key(repository) + "--" + instance


def compose_config(repository, instance, label, cpus, memory, policy_path):
    key = instance_key(repository, instance)
    return {
        "name": "gha-" + key,
        "services": {
            "docker": {
                "image": DIND_IMAGE,
                "privileged": True,
                "restart": "unless-stopped",
                "environment": {"DOCKER_TLS_CERTDIR": ""},
                "command": ["dockerd", "--host=tcp://0.0.0.0:2375", "--host=unix:///var/run/docker.sock", "--tls=false"],
                "volumes": ["docker-data:/var/lib/docker", "work:/opt/actions-runner/_work"],
                "cpus": min(cpus, 16),
                "mem_limit": "4g",
                "healthcheck": {"test": ["CMD", "docker", "info"], "interval": "5s", "timeout": "5s", "retries": 24},
            },
            "runner": {
                "image": IMAGE,
                "restart": "unless-stopped",
                "depends_on": {"docker": {"condition": "service_healthy"}},
                "network_mode": "service:docker",
                "environment": {
                    "MANAGED_REPOSITORY": repository,
                    "MANAGED_RUNNER_NAME": "localhost-128-" + key[:40] + "-" + hashlib.sha256(key.encode()).hexdigest()[:8],
                    "MANAGED_RUNNER_LABELS": "managed-ci," + label,
                },
                "volumes": ["state:/opt/actions-runner", "work:/opt/actions-runner/_work", "tools:/opt/hostedtoolcache", str(policy_path) + ":/etc/gha-runner/policy.json:ro"],
                "cpus": cpus,
                "mem_limit": memory,
                "pids_limit": 4096,
                "stop_grace_period": "5m",
                "security_opt": ["no-new-privileges:true"],
            },
        },
        "volumes": {"state": {}, "work": {}, "tools": {}, "docker-data": {}},
    }


def run_compose(directory, *arguments, **kwargs):
    return subprocess.run(["docker", "compose", "--project-directory", str(directory), "-f", str(directory / "compose.json"), *arguments], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["add", "start", "stop", "restart", "status", "logs", "build"])
    parser.add_argument("repository", nargs="?")
    parser.add_argument("--instance", default="01")
    parser.add_argument("--label")
    parser.add_argument("--cpus", type=int, default=32)
    parser.add_argument("--memory", default="8g")
    args = parser.parse_args()
    if args.command == "build":
        subprocess.run(["docker", "build", "-t", IMAGE, str(Path(__file__).parent)], check=True)
        return
    if not args.repository:
        if args.command != "status":
            parser.error("repository is required")
        for manifest in sorted((ROOT / "instances").glob("*/manifest.json")):
            data = json.loads(manifest.read_text())
            print(f"\n{data['repository']} / {data['instance']}", flush=True)
            run_compose(manifest.parent, "ps")
        return
    key = instance_key(args.repository, args.instance)
    directory = ROOT / "instances" / key
    if args.command == "add":
        payload = json.load(sys.stdin)
        if not isinstance(payload.get("repository"), str) or payload["repository"].lower() != args.repository.lower() or not payload.get("token"):
            raise ValueError("Invalid registration input")
        args.repository = payload["repository"]
        if not 1 <= args.cpus <= 128 or not re.fullmatch(r"[1-9][0-9]*[mg]", args.memory):
            raise ValueError("Invalid CPU or memory limit")
        label = args.label or re.sub(r"[^a-z0-9_-]", "-", args.repository.split("/")[1].lower()) + "-ci"
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", label):
            raise ValueError("Invalid runner label")
        if (directory / "manifest.json").exists():
            print("Instance already exists; starting its existing configuration.", flush=True)
            run_compose(directory, "up", "-d")
            return
        directory.mkdir(parents=True, mode=0o700)
        policy_path = directory / "policy.json"
        policy = {
            "repository": args.repository,
            "repository_id": payload["repository_id"],
            "owner_id": payload["owner_id"],
            "trusted_branches": sorted(set(["main", "dev", "pre", payload.get("default_branch", "main")])),
            "workflows": payload.get("workflows", []),
            "schedule_workflows": payload.get("schedule_workflows", []),
            "schedules": payload.get("schedules", []),
        }
        policy_path.write_text(json.dumps(policy, indent=2) + "\n")
        policy_path.chmod(0o444)
        config = compose_config(args.repository, args.instance, label, args.cpus, args.memory, policy_path)
        (directory / "compose.json").write_text(json.dumps(config, indent=2) + "\n")
        # No token or administrative credential is persisted in this manifest.
        manifest = {"repository": args.repository, "instance": args.instance, "label": label, "cpus": args.cpus, "memory": args.memory}
        run_compose(directory, "up", "-d", "--wait", "docker")
        run_compose(directory, "run", "--rm", "-T", "--no-deps", "runner", "/usr/local/libexec/gha-runner/register.sh", input=payload["token"] + "\n", text=True)
        (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        run_compose(directory, "up", "-d", "--wait")
        print(f"Registered {args.repository}: {manifest['label']} ({args.instance})", flush=True)
    else:
        if not (directory / "manifest.json").exists():
            raise ValueError("Instance is not installed")
        if args.command == "start":
            run_compose(directory, "up", "-d", "--wait")
        elif args.command == "stop":
            run_compose(directory, "stop", "runner", "docker")
        elif args.command == "restart":
            run_compose(directory, "restart", "runner")
        elif args.command == "status":
            run_compose(directory, "ps")
        elif args.command == "logs":
            run_compose(directory, "logs", "--tail", "100", "runner")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, subprocess.CalledProcessError) as error:
        # Never stringify a CalledProcessError command: registration argv/input may be sensitive.
        print(f"runnerctl: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
