#!/usr/bin/env python3
"""Run on the approved Linux build host; never print upstream credentials."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import re
import shutil
import subprocess
import time
import urllib.request

NAME = "managed-ci-egress"
IMAGE = "managed-gha-runner:2.338.0"
BINARY = "/usr/local/bin/sing-box"
UPSTREAM = "http://127.0.0.1:11090"
ENDPOINT = "http://127.0.0.1:11092"
RULES = {
    "geosite-cn.srs": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs",
    "geoip-cn.srs": "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs",
}


def run(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, text=True, **kwargs)


def mount_args(root: Path) -> list[str]:
    return [
        "--mount", f"type=bind,src={BINARY},dst=/usr/local/bin/ci-sing-box,readonly",
        "--mount", f"type=bind,src={root / 'config.json'},dst=/config/config.json,readonly",
        "--mount", f"type=bind,src={root / 'rules'},dst=/rules,readonly",
    ]


def image_args() -> list[str]:
    return ["--entrypoint", "/usr/local/bin/ci-sing-box", IMAGE]


def installed() -> bool:
    return subprocess.run(["docker", "container", "inspect", NAME],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def update_rules(root: Path) -> None:
    rules = root / "rules"
    rules.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": UPSTREAM}))
    checksums = {}
    for filename, source in RULES.items():
        with opener.open(source, timeout=60) as response:
            data = response.read(8 * 1024 * 1024)
        if not data.startswith(b"SRS"):
            raise RuntimeError(f"{filename} is not a binary sing-box rule set")
        temporary = rules / (filename + ".tmp")
        temporary.write_bytes(data)
        temporary.chmod(0o644)
        temporary.replace(rules / filename)
        checksums[filename] = {"source": source, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    (rules / "sources.json").write_text(json.dumps(checksums, indent=2) + "\n")
    print(json.dumps(checksums, indent=2))


def check(root: Path) -> None:
    run(["docker", "run", "--rm", "--network", "none", "--read-only",
         "--user", "1001:1001", *mount_args(root), *image_args(),
         "check", "-c", "/config/config.json"])


def start(root: Path) -> None:
    if installed():
        run(["docker", "start", NAME])
        return
    check(root)
    run(["docker", "run", "-d", "--name", NAME, "--restart", "unless-stopped",
         "--network", "host", "--read-only", "--user", "1001:1001",
         "--cpus", "1", "--memory", "256m", "--pids-limit", "128",
         "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
         "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m", *mount_args(root),
         *image_args(), "run", "-c", "/config/config.json"])


def verify(root: Path) -> None:
    check(root)
    targets = [
        ("cn-domain", "https://registry.npmmirror.com/", {200}),
        ("cn-ip", "https://223.5.5.5/dns-query", {400, 405}),
        ("github", "https://api.github.com/", {200}),
        ("dockerhub", "https://registry-1.docker.io/v2/", {401}),
    ]
    since = str(int(time.time()))
    for label, url, expected in targets:
        result = run(["curl", "--proxy", ENDPOINT, "--noproxy", "",
                      "--connect-timeout", "8", "--max-time", "30", "-sS",
                      *([] if label == "cn-domain" else ["-I"]),
                      "-o", "/dev/null", "-w", "%{http_code} %{http_connect}", url], capture_output=True)
        status, connect_status = map(int, result.stdout.split())
        if connect_status != 200:
            raise RuntimeError(f"{label}: proxy CONNECT failed with {connect_status}")
        if status not in expected:
            raise RuntimeError(f"{label}: unexpected HTTP {status}")
        print(f"{label}: CONNECT {connect_status}, HTTP {status}")
    logs = run(["docker", "logs", "--since", since, NAME], capture_output=True)
    lines = re.sub(r"\x1b\[[0-9;]*m", "", logs.stdout + logs.stderr)
    required = [
        ("outbound/direct[direct]", "registry.npmmirror.com:443"),
        ("outbound/direct[direct]", "223.5.5.5:443"),
        ("outbound/http[upstream]", "api.github.com:443"),
        ("outbound/http[upstream]", "registry-1.docker.io:443"),
    ]
    for markers in required:
        matches = [line for line in lines.splitlines() if all(marker in line for marker in markers)]
        if not matches:
            raise RuntimeError(f"missing route proof for {markers[1]}")
        print(matches[-1])


def main() -> None:
    if platform.system() != "Linux":
        raise SystemExit("This management program runs only on the approved remote Linux build host.")
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["install", "update-rules", "check", "start", "stop", "status", "logs", "verify"])
    parser.add_argument("--root", type=Path, default=Path.home() / ".local/share/gha-runners/proxy")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == "install":
        root.mkdir(parents=True, exist_ok=True)
        (root / "rules").mkdir(exist_ok=True)
        source_config = Path(__file__).with_name("config.json")
        if source_config.resolve() != (root / "config.json").resolve():
            shutil.copyfile(source_config, root / "config.json")
        (root / "config.json").chmod(0o644)
        update_rules(root)
        check(root)
    elif args.command == "update-rules":
        update_rules(root)
        check(root)
        print("Rule files updated; restart only this egress service in a CI maintenance window to load them.")
    elif args.command == "check":
        check(root)
    elif args.command == "start":
        start(root)
    elif args.command == "stop":
        run(["docker", "stop", NAME])
    elif args.command == "status":
        run(["docker", "inspect", "--format", "{{.Name}} {{.State.Status}} cpu={{.HostConfig.NanoCpus}} memory={{.HostConfig.Memory}}", NAME])
    elif args.command == "logs":
        run(["docker", "logs", "--tail", "80", NAME])
    elif args.command == "verify":
        verify(root)


if __name__ == "__main__":
    main()
