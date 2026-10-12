#!/usr/bin/env python3
"""Manage separate personal-repository runners on a remote Docker host."""
import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
IMAGE = "managed-gha-runner:2.338.0"
DIND_IMAGE = "docker:29.8.2-dind"
DEFAULT_NO_PROXY = "localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,.tailac9c6f.ts.net"


def network_config(settings=None):
    """Validate shared, credential-free proxy settings before persisting them."""
    settings = {} if settings is None else settings
    if not isinstance(settings, dict) or set(settings) - {"proxy_url", "no_proxy"}:
        raise ValueError("Unsupported network settings")
    no_proxy = settings.get("no_proxy", DEFAULT_NO_PROXY)
    if not isinstance(no_proxy, str) or len(no_proxy) > 8192 or not re.fullmatch(r"[A-Za-z0-9.*,:/_-]*", no_proxy):
        raise ValueError("Invalid no_proxy")
    config = {"no_proxy": no_proxy}
    if "proxy_url" not in settings:
        return config
    proxy = settings["proxy_url"]
    if not isinstance(proxy, str) or not proxy or len(proxy) > 2048 or any(character.isspace() or ord(character) < 32 for character in proxy):
        raise ValueError("Invalid proxy URL")
    parsed = urlsplit(proxy)
    if parsed.scheme not in {"http", "https"} or parsed.username is not None or parsed.password is not None or parsed.path or "?" in proxy or "#" in proxy:
        raise ValueError("Proxy URL must have no credentials, path, query, or fragment")
    if parsed.netloc.startswith("["):
        authority = re.fullmatch(r"\[([0-9A-Fa-f:.]+)\](?::([0-9]+))?", parsed.netloc)
        if not authority or ipaddress.ip_address(authority[1]).version != 6:
            raise ValueError("Invalid proxy host")
    else:
        authority = re.fullmatch(r"([A-Za-z0-9.-]+)(?::([0-9]+))?", parsed.netloc)
        if not authority:
            raise ValueError("Invalid proxy host")
        host = authority[1][:-1] if authority[1].endswith(".") else authority[1]
        if len(host) > 253 or any(not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in host.split(".")):
            raise ValueError("Invalid proxy host")
        if re.fullmatch(r"[0-9]+(?:\.[0-9]+){3}", host):
            ipaddress.IPv4Address(host)
    if authority[2] is not None and not 1 <= int(authority[2]) <= 65535:
        raise ValueError("Invalid proxy port")
    config["proxy_url"] = proxy
    return config


def load_network_config():
    path = ROOT / "network.json"
    settings = json.loads(path.read_text()) if path.exists() else {}
    if not isinstance(settings, dict):
        raise ValueError("Network settings must be an object")
    return network_config(settings)


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


def compose_config(repository, instance, label, cpus, memory, policy_path, network=None):
    key = instance_key(repository, instance)
    settings = network_config(network)
    proxy_environment = {"NO_PROXY": settings["no_proxy"], "no_proxy": settings["no_proxy"]}
    if "proxy_url" in settings:
        proxy_environment.update({variable: settings["proxy_url"] for variable in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]})
    initializer = {
        "image": IMAGE,
        "network_mode": "none",
        "entrypoint": ["/usr/bin/python3", "-I", "/etc/gha-runner/configure-proxy.py"],
        # Reconcile even after disabling the proxy so managed CLI defaults
        # do not outlive the shared network setting in this persistent state.
        "environment": {**proxy_environment, "DOCKER_CONFIG": "/opt/actions-runner/.docker"},
        "volumes": ["state:/opt/actions-runner", "work:/opt/actions-runner/_work", "tools:/opt/hostedtoolcache",
                    str(ROOT / "runner" / "configure-proxy.py") + ":/etc/gha-runner/configure-proxy.py:ro"],
    }
    return {
        "name": "gha-" + key,
        "services": {
            # Seed new named volumes from the runner image before DinD can
            # create empty placeholders. No network or registration is needed.
            "init-volumes": initializer,
            "docker": {
                "image": DIND_IMAGE,
                "privileged": True,
                "restart": "unless-stopped",
                "depends_on": {"init-volumes": {"condition": "service_completed_successfully"}},
                "environment": {"DOCKER_TLS_CERTDIR": "", **proxy_environment},
                # Each isolated daemon has its own namespace, so these pools
                # can be reused without masking the host's 172.17 bridge.
                "command": ["dockerd", "--host=tcp://0.0.0.0:2375", "--host=unix:///var/run/docker.sock", "--tls=false",
                            "--bip=10.240.0.1/24", "--default-address-pool=base=10.241.0.0/16,size=24"],
                # DinD resolves bind-mount paths for job containers. It must
                # see the same externals/tools paths as the runner; the nested
                # workspace remains writable underneath the read-only state.
                "volumes": ["docker-data:/var/lib/docker", "state:/opt/actions-runner:ro", "work:/opt/actions-runner/_work", "tools:/opt/hostedtoolcache"],
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
                    "DOCKER_CONFIG": "/opt/actions-runner/.docker",
                    # Keep packages and node_modules on the same mount so Bun
                    # can hardlink; checkout only cleans the nested repository.
                    "BUN_INSTALL_CACHE_DIR": "/opt/actions-runner/_work/.bun-install-cache",
                    **proxy_environment,
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


def refresh_compose(directory):
    """Refresh an idle instance from its existing manifest; report changes.

    Start/add can recreate the daemon and runner together when this changes.
    Stop/restart deliberately do not refresh a potentially busy instance.
    """
    manifest = json.loads((directory / "manifest.json").read_text())
    config = compose_config(manifest["repository"], manifest["instance"], manifest["label"],
                            manifest["cpus"], manifest["memory"], directory / "policy.json", load_network_config())
    compose_path = directory / "compose.json"
    previous = json.loads(compose_path.read_text()) if compose_path.exists() else None
    if previous == config:
        return False
    temporary = directory / ".compose.json.tmp"
    temporary.write_text(json.dumps(config, indent=2) + "\n")
    temporary.replace(compose_path)
    return True


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
            # Updating the daemon also requires a new runner network namespace.
            # Run add/start only when this instance is idle; keep named volumes.
            arguments = ["up", "-d", "--wait"]
            if refresh_compose(directory):
                arguments.append("--force-recreate")
            run_compose(directory, *arguments)
            return
        settings = load_network_config()
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
        config = compose_config(args.repository, args.instance, label, args.cpus, args.memory, policy_path, settings)
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
            arguments = ["up", "-d", "--wait"]
            if refresh_compose(directory):
                arguments.append("--force-recreate")
            run_compose(directory, *arguments)
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
