from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from tools.build_catalog import INDEX_URL, _assign_route_slugs, _build_entry, _media_url
from tools.remote_catalog import fetch_bytes as default_fetch_bytes
from tools.remote_catalog import fetch_text as default_fetch_text

LOCAL_ASSET_NAMES = {
    "maidata": "maidata.txt",
    "bg": "bg.png",
}


def _chart_records(items: list[dict[str, Any]]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    generated_at = datetime.now(timezone.utc).isoformat()
    records = [(item, _build_entry(item, generated_at)) for item in items]
    entries = [entry for _, entry in records]
    entries.sort(key=lambda entry: entry["id"])
    _assign_route_slugs(entries)
    return records


def _write_asset(
    target_file: Path,
    source_url: str,
    fetch_bytes: Callable[[str], bytes],
) -> str:
    if target_file.exists() and target_file.stat().st_size > 0:
        return "cached"

    data = fetch_bytes(source_url)
    if not data:
        raise RuntimeError(f"empty response for {source_url}")

    target_file.parent.mkdir(parents=True, exist_ok=True)
    temp_file = target_file.with_suffix(f"{target_file.suffix}.tmp")
    temp_file.write_bytes(data)
    temp_file.replace(target_file)
    return "downloaded"


def mirror_chart_assets(
    root: Path,
    fetch_text: Callable[[str], str] = default_fetch_text,
    fetch_bytes: Callable[[str], bytes] = default_fetch_bytes,
    max_workers: int = 8,
) -> Path:
    """Mirror chart bg + maidata into apps/web/public/adxcs/<route-id>/.

    The route id intentionally matches the chart detail URL id (normally the
    maimai shortid, e.g. /charts/11951), because the web download spec reads
    /adxcs/<route-id>/bg.png and /adxcs/<route-id>/maidata.txt directly.
    """

    target_root = root / "apps" / "web" / "public" / "adxcs"
    items = json.loads(fetch_text(INDEX_URL))
    tasks: list[tuple[Path, str]] = []
    for item, entry in _chart_records(items):
        route_id = str(entry.get("slug") or entry.get("short_id") or entry["id"]).strip()
        files = item.get("files") or {}
        if not route_id:
            continue
        for source_key, local_name in LOCAL_ASSET_NAMES.items():
            relative_path = str(files.get(source_key) or "").strip()
            if relative_path:
                tasks.append((target_root / route_id / local_name, _media_url(relative_path)))

    downloaded = 0
    cached = 0
    failed: list[str] = []

    def run(task: tuple[Path, str]) -> str:
        target_file, source_url = task
        try:
            return _write_asset(target_file, source_url, fetch_bytes)
        except Exception as error:  # noqa: BLE001 - aggregate all failed URLs before raising
            failed.append(f"{source_url} -> {target_file}: {error}")
            return "failed"

    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
        for result in pool.map(run, tasks):
            if result == "downloaded":
                downloaded += 1
            elif result == "cached":
                cached += 1

    if failed:
        preview = "\n".join(failed[:10])
        extra = "" if len(failed) <= 10 else f"\n... and {len(failed) - 10} more"
        raise RuntimeError(f"failed to mirror {len(failed)} chart assets:\n{preview}{extra}")

    print(
        f"[adxcs] mirrored chart assets to {target_root}: "
        f"{downloaded} downloaded, {cached} cached, {len(tasks)} total"
    )
    return target_root


def main() -> None:
    parser = argparse.ArgumentParser(description="Mirror AstroDX bg + maidata assets locally.")
    parser.add_argument("--root", type=Path, default=Path(".."), help="Repository root")
    parser.add_argument("--max-workers", type=int, default=8)
    args = parser.parse_args()
    mirror_chart_assets(args.root.resolve(), max_workers=args.max_workers)


if __name__ == "__main__":
    main()
