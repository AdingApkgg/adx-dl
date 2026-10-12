#!/usr/bin/env python3
"""Move the managed worker's Next compiler cache across checkout boundaries."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import time


class NextCache:
    def __init__(self, workspace, work_root, runtime):
        self.workspace = Path(workspace).absolute()
        self.work = Path(work_root).absolute()
        if self.workspace == self.work or not self.workspace.is_relative_to(self.work):
            raise ValueError("Workspace must be nested in the worker volume")
        self.root = self.work / ".next-build-cache"
        self.target = self.workspace / "apps/web/.next/cache"
        lock = self.workspace / "bun.lock"
        if lock.resolve() != lock:
            raise ValueError("Dependency lock must be a regular workspace path")
        identity = json.dumps({"schema": 1, "workspace": str(self.workspace),
                               "platform": platform.system(), "architecture": platform.machine(),
                               "runtime": runtime, "lock": hashlib.sha256(lock.read_bytes()).hexdigest()}, sort_keys=True)
        self.key = hashlib.sha256(identity.encode()).hexdigest()
        self.slot = self.root / self.key

    def validate(self):
        for path in (self.work, self.workspace, self.root, self.slot, self.target):
            if path.resolve() != path or path.is_symlink():
                raise ValueError("Cache paths must not traverse symlinks")
            if path.exists() and not path.is_dir():
                raise ValueError("Cache paths must be directories")

    def restore(self):
        self.validate()
        if not self.slot.exists():
            return False
        if self.target.exists():
            raise FileExistsError("Existing workspace cache must not be overwritten")
        self.target.parent.mkdir(parents=True, exist_ok=True)
        # os.rename refuses cross-volume moves instead of silently copying.
        os.rename(self.slot, self.target)
        return True

    def save(self):
        self.validate()
        if not self.target.exists():
            return False
        if self.slot.exists():
            raise FileExistsError("Persistent cache slot is already occupied")
        self.root.mkdir(exist_ok=True)
        os.rename(self.target, self.slot)
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["restore", "save"])
    args = parser.parse_args()
    node = subprocess.check_output(["node", "--version"], text=True).strip()
    bun = subprocess.check_output(["bun", "--version"], text=True).strip()
    cache = NextCache(os.environ["GITHUB_WORKSPACE"], Path(os.environ["RUNNER_TEMP"]).parent, f"node:{node};bun:{bun}")
    started = time.monotonic()
    changed = getattr(cache, args.operation)()
    print(f"Local Next cache {args.operation}: {'hit' if changed else 'miss/no cache'}; key={cache.key}; {time.monotonic()-started:.3f} seconds")


if __name__ == "__main__":
    main()
