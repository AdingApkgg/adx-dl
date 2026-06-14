from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from tools.parse_maidata import parse_maidata_text
from tools.remote_catalog import fetch_text as default_fetch_text
from tools.remote_catalog import parse_remote_directory_files, parse_remote_root_directories

REMOTE_ROOT = "https://adx-dl.larx.cc/"


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "remote-entry"


def _path_slug(name: str) -> str:
    # Readable, URL-safe route slug derived from the remote directory name.
    # \W keeps Unicode word chars (incl. CJK) and turns whitespace/punctuation
    # into dashes, so non-ASCII titles stay human-readable in the URL.
    slug = re.sub(r"\W+", "-", name.strip(), flags=re.UNICODE).strip("-").lower()
    return slug or "chart"


def _assign_route_slugs(entries: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for entry in entries:
        base = _path_slug(entry["remote_dir_name"])
        slug = base
        index = 2
        while slug in seen:
            slug = f"{base}-{index}"
            index += 1
        seen.add(slug)
        entry["slug"] = slug


def _pick_file(file_index: dict[str, dict[str, str]], *names: str) -> str:
    for name in names:
        if name in file_index:
            return file_index[name]["url"]
    return ""


def _build_remote_entry(
    directory: dict[str, str],
    files: list[dict[str, str]],
    maidata_text: str,
    generated_at: str,
) -> dict[str, Any]:
    parsed = parse_maidata_text(maidata_text)
    file_index = {file["name"]: file for file in files}
    remote_dir_name = directory["name"]
    short_id = str(parsed.get("short_id", "")).strip()
    stable_key = f"{short_id}-{remote_dir_name}" if short_id else remote_dir_name
    version = str(parsed.get("version", "") or "").strip()
    cabinet = str(parsed.get("cabinet", "") or "").strip()
    subcategory = version or cabinet or "Unknown"
    imported_at = (
        file_index.get("maidata.txt", {}).get("modified_at")
        or file_index.get("maidata_dx.txt", {}).get("modified_at")
        or next((file.get("modified_at", "") for file in files if file.get("modified_at")), "")
        or generated_at
    )

    files_payload = {
        "maidata": _pick_file(file_index, "maidata.txt"),
        "maidata_dx": _pick_file(file_index, "maidata_dx.txt"),
        "audio": _pick_file(file_index, "track.mp3", "track.ogg"),
        "background": _pick_file(file_index, "bg.png", "bg.jpg", "bg.jpeg"),
        "pv": _pick_file(file_index, "pv.mp4"),
    }

    return {
        "id": _slugify(stable_key),
        "remote_dir_name": remote_dir_name,
        "title": str(parsed.get("title", "") or remote_dir_name).strip() or remote_dir_name,
        "title_en": str(parsed.get("title_en", "") or "").strip(),
        "artist": str(parsed.get("artist", "") or "").strip(),
        "artist_en": str(parsed.get("artist_en", "") or "").strip(),
        "category": "Remote",
        "subcategory": subcategory,
        "source_archive": "",
        "source_folder": remote_dir_name,
        "version": version,
        "genre": str(parsed.get("genre", "") or "").strip(),
        "cabinet": cabinet,
        "short_id": short_id,
        "offset": parsed.get("offset"),
        "bpm": parsed.get("bpm"),
        "difficulties": parsed.get("difficulties", []),
        "download_mode": "onsite",
        "download_url": "",
        "source_url": directory["url"],
        "license_note": "Built from remote directory listing",
        "files": files_payload,
        "assets": {
            "has_audio": bool(files_payload["audio"]),
            "has_background": bool(files_payload["background"]),
            "has_pv": bool(files_payload["pv"]),
            "has_dx_chart": bool(files_payload["maidata_dx"]),
        },
        "media": {
            "entry_base_url": directory["url"],
            "cover_url": files_payload["background"],
            "audio_url": files_payload["audio"],
            "pv_url": files_payload["pv"],
        },
        "imported_at": imported_at,
    }


def _build_entry_for_directory(
    directory: dict[str, str],
    generated_at: str,
    fetch_text: Callable[[str], str],
) -> dict[str, Any] | None:
    try:
        directory_html = fetch_text(directory["url"])
        files = parse_remote_directory_files(directory_html, directory["url"])
        file_index = {file["name"]: file for file in files}
        maidata_url = _pick_file(file_index, "maidata.txt", "maidata_dx.txt")
        if not maidata_url:
            return None

        maidata_text = fetch_text(maidata_url)
        return _build_remote_entry(directory, files, maidata_text, generated_at)
    except Exception:
        return None


def build_catalog(
    root: Path,
    fetch_text: Callable[[str], str] = default_fetch_text,
    max_workers: int = 8,
) -> Path:
    generated_at = datetime.now(timezone.utc).isoformat()
    root_html = fetch_text(REMOTE_ROOT)
    directories = parse_remote_root_directories(root_html, REMOTE_ROOT)
    entries: list[dict[str, Any]] = []

    if directories:
        worker_count = max(1, min(max_workers, len(directories)))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [
                executor.submit(
                    _build_entry_for_directory,
                    directory,
                    generated_at,
                    fetch_text,
                )
                for directory in directories
            ]
            for future in as_completed(futures):
                entry = future.result()
                if entry is not None:
                    entries.append(entry)

    entries.sort(key=lambda entry: entry["id"])
    _assign_route_slugs(entries)

    catalog = {
        "generated_at": generated_at,
        "total_entries": len(entries),
        "categories": {"Remote": sorted({entry["subcategory"] for entry in entries})},
        "entries": entries,
    }
    # Monorepo layout: generated catalog lives under data/catalog at the repo root.
    catalog_path = root / "data" / "catalog" / "index.json"
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return catalog_path
