#!/usr/bin/env python3
"""Provision Docker CLI proxy defaults without replacing registry credentials."""
import json
import os
from pathlib import Path
import sys
import tempfile

MANAGED_KEY = "x-managed-ci-proxy"


def configure(directory, proxy_url, no_proxy):
    directory = Path(directory)
    target = directory / "config.json"
    if not proxy_url and not target.exists():
        return
    config = json.loads(target.read_text()) if target.exists() else {}
    if not isinstance(config, dict):
        raise ValueError("Docker configuration must be an object")
    if not proxy_url and MANAGED_KEY not in config:
        return
    proxies = config.setdefault("proxies", {})
    if not isinstance(proxies, dict):
        raise ValueError("Docker proxy configuration must be an object")
    if proxy_url:
        managed = {"httpProxy": proxy_url, "httpsProxy": proxy_url, "noProxy": no_proxy}
        proxies["default"] = managed
        config[MANAGED_KEY] = managed
    else:
        # Remove only our unchanged default; preserve later administrator edits.
        managed = config.pop(MANAGED_KEY)
        if isinstance(managed, dict) and proxies.get("default") == managed:
            proxies.pop("default", None)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=directory, prefix=".proxy-", delete=False) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(config, temporary, indent=2)
            temporary.write("\n")
        temporary_path.replace(target)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        configure(os.environ.get("DOCKER_CONFIG", str(Path.home() / ".docker")),
                  os.environ.get("HTTP_PROXY", ""), os.environ.get("NO_PROXY", ""))
    except (OSError, ValueError, TypeError) as error:
        # Existing registry credentials and proxy URLs never belong in logs.
        print(f"Docker proxy configuration failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
