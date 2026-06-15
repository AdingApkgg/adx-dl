from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote, urlparse

from tools.remote_catalog import fetch_bytes as default_fetch_bytes
from tools.remote_catalog import fetch_text as default_fetch_text

# Authoritative, version-complete chart index (replaces the old flat-directory scrape).
INDEX_URL = "https://adx-dl.larx.cc/tmp/astrodx-charts/index.json"
MEDIA_BASE = "https://adx-dl.larx.cc/tmp/astrodx-charts/"

# Song aliases (别名) — community nicknames used to find a chart by an alternate
# name, the same idea as nonebot-plugin-maimaidx's alias lookup. Both sources are
# free no-auth JSON keyed by the canonical maimai song id and are unioned per id:
#   Lxns (落雪咖啡屋): {"aliases": [{"song_id": int, "aliases": [str, ...]}, ...]}
#   柚子 (yuzuchan):   {"content": [{"SongID": int, "Alias": [str, ...]}, ...]}
LXNS_ALIAS_URL = "https://maimai.lxns.net/api/v0/maimai/alias/list"
YUZUCHAN_ALIAS_URL = "https://www.yuzuchan.moe/api/maimaidx/maimaidxalias"

# Cover images are converted to lossless AVIF and mirrored into the web app's
# public/ during the build so the static site serves a small local copy instead
# of hot-linking the remote host. The remote original is kept on the entry (for
# the .adx download and OG/social images); audio and PV always stay remote.
LOCAL_MEDIA_ROUTE = "/covers"
COVER_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
# Formats avifenc can decode as input. Other source formats are left remote.
AVIF_SOURCE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
# Build-time switch (set before a push): ASTRODX_COVERS=remote uses the remote
# image links directly (no download/convert); any other value (default "local")
# mirrors covers to public/covers as lossless AVIF. The web layer falls back to
# the remote cover_url automatically when no local AVIF exists, so both modes work.
COVERS_MODE_ENV = "ASTRODX_COVERS"

# Canonical maimai version names by versionid (matches the site's MAIMAI_VERSIONS).
CANONICAL_VERSIONS: dict[int, str] = {
    0: "maimai",
    1: "maimai PLUS",
    2: "maimai GreeN",
    3: "maimai GreeN PLUS",
    4: "maimai ORANGE",
    5: "maimai ORANGE PLUS",
    6: "maimai PiNK",
    7: "maimai PiNK PLUS",
    8: "maimai MURASAKi",
    9: "maimai MURASAKi PLUS",
    10: "maimai MiLK",
    11: "maimai MiLK PLUS",
    12: "maimai FiNALE",
    13: "maimai DX",
    14: "maimai DX PLUS",
    15: "maimai DX Splash",
    16: "maimai DX Splash PLUS",
    17: "maimai DX UNiVERSE",
    18: "maimai DX UNiVERSE PLUS",
    19: "maimai DX FESTiVAL",
    20: "maimai DX FESTiVAL PLUS",
    21: "maimai DX BUDDiES",
    22: "maimai DX BUDDiES PLUS",
    23: "maimai DX PRiSM",
    24: "maimai DX PRiSM PLUS",
    25: "maimai DX CiRCLE",
}


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "remote-entry"


def _path_slug(name: str) -> str:
    # Readable, URL-safe route slug derived from the chart directory name.
    # \W keeps Unicode word chars (incl. CJK) and turns whitespace/punctuation
    # into dashes, so non-ASCII titles stay human-readable in the URL.
    slug = re.sub(r"\W+", "-", name.strip(), flags=re.UNICODE).strip("-").lower()
    return slug or "chart"


def _assign_route_slugs(entries: list[dict[str, Any]]) -> None:
    # Canonical slug is the unique maimai song id (shortid): stable, ASCII, and
    # collision-free. A numeric suffix disambiguates the (defensive) case of a
    # missing or duplicate id.
    seen: set[str] = set()
    for entry in entries:
        base = entry["short_id"] or _path_slug(entry["remote_dir_name"])
        slug = base
        index = 2
        while slug in seen:
            slug = f"{base}-{index}"
            index += 1
        seen.add(slug)
        entry["slug"] = slug


def _media_url(relative_path: str) -> str:
    from urllib.parse import quote

    return MEDIA_BASE + quote(relative_path, safe="/")


def _strip_cabinet_prefix(segment: str) -> tuple[str, str]:
    # "[DX] 1000年生きてる" -> ("1000年生きてる", "DX"); "[奏]アイドル" -> ("アイドル", "奏")
    match = re.match(r"^\[([^\]]*)\]\s*(.*)$", segment)
    if match:
        name = match.group(2).strip()
        return (name or segment, match.group(1).strip())
    return (segment, "")


def _build_entry(item: dict[str, Any], generated_at: str) -> dict[str, Any]:
    path = str(item.get("path", "")).strip()
    segment = path.split("/")[-1] if path else str(item.get("title", ""))
    name, cabinet = _strip_cabinet_prefix(segment)

    files = item.get("files") or {}

    def media(key: str) -> str:
        rel = files.get(key)
        return _media_url(rel) if rel else ""

    maidata_url = media("maidata")
    audio_url = media("audio")
    cover_url = media("bg")
    pv_url = media("pv")

    version_id = item.get("versionid")
    version = CANONICAL_VERSIONS.get(version_id, str(item.get("version", "") or "").strip())
    short_id = str(item.get("shortid", "") or "").strip()
    stable_key = f"{short_id}-{name}" if short_id else name

    difficulties = [
        {
            "slot": difficulty.get("slot"),
            "name": str(difficulty.get("name", "") or ""),
            "level": str(difficulty.get("level", "") or ""),
            "designer": str(difficulty.get("designer", "") or ""),
        }
        for difficulty in item.get("difficulties", [])
        if difficulty.get("has_notes", True)
    ]

    return {
        "id": _slugify(stable_key),
        "remote_dir_name": name,
        "title": str(item.get("title", "") or name),
        "title_en": "",
        "artist": str(item.get("artist", "") or ""),
        "artist_en": "",
        "category": "Remote",
        "subcategory": version or cabinet or "Unknown",
        "source_archive": "",
        "source_folder": path,
        "version": version,
        "versionid": version_id,
        "genre": str(item.get("genre", "") or ""),
        "genreid": item.get("genreid"),
        "cabinet": cabinet,
        "short_id": short_id,
        # Filled in by _attach_aliases() once the alias map is fetched; kept here
        # so the field always exists even when the alias source is unavailable.
        "aliases": [],
        "offset": item.get("first"),
        "bpm": item.get("bpm"),
        "difficulties": difficulties,
        "download_mode": "onsite",
        "download_url": "",
        "source_url": _media_url(path) + "/" if path else "",
        "license_note": "Built from astrodx-charts index",
        "files": {
            "maidata": maidata_url,
            "maidata_dx": "",
            "audio": audio_url,
            "background": cover_url,
            "pv": pv_url,
        },
        "assets": {
            "has_audio": bool(audio_url),
            "has_background": bool(cover_url),
            "has_pv": bool(pv_url),
            "has_dx_chart": cabinet == "DX",
        },
        "media": {
            "entry_base_url": _media_url(path) + "/" if path else "",
            "cover_url": cover_url,
            # Local lossless-AVIF copy for on-page display; set during the build.
            "cover_avif": "",
            "audio_url": audio_url,
            "pv_url": pv_url,
        },
        "imported_at": generated_at,
    }


def _cover_extension(remote_url: str) -> str:
    ext = os.path.splitext(unquote(urlparse(remote_url).path))[1].lower()
    return ext if ext in COVER_EXTENSIONS else ".png"


def _to_avif_lossless(data: bytes, src_ext: str) -> bytes | None:
    """Convert image bytes to lossless AVIF via avifenc. Returns None when the
    source format can't be decoded, avifenc is missing, or the encode fails — the
    caller then keeps the remote cover as a graceful fallback."""
    if src_ext not in AVIF_SOURCE_EXTENSIONS:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"in{src_ext}"
        dst = Path(tmp) / "out.avif"
        src.write_bytes(data)
        try:
            subprocess.run(
                ["avifenc", "--lossless", str(src), str(dst)],
                check=True,
                capture_output=True,
                timeout=180,
            )
        except (OSError, subprocess.SubprocessError) as error:
            print(f"[catalog] avifenc failed ({src_ext}): {error}", file=sys.stderr)
            return None
        return dst.read_bytes()


def _download_cover(
    entry: dict[str, Any],
    media_root: Path,
    fetch_bytes: Callable[[str], bytes],
    to_avif: Callable[[bytes, str], bytes | None],
) -> bool:
    """Mirror one entry's cover as a lossless AVIF at media_root/<slug>.avif and
    point media.cover_avif at it (for on-page display). cover_url and
    files.background keep the remote original, so the .adx download and OG/social
    images still pull the unconverted file. Returns True when the local AVIF is in
    place; any failure leaves cover_avif empty and the remote cover untouched."""
    remote_url = entry["media"]["cover_url"]
    if not remote_url or remote_url.startswith("/"):
        return False  # no cover, or already local

    slug = entry["slug"]
    src_ext = _cover_extension(remote_url)
    target_file = media_root / f"{slug}.avif"
    local_url = f"{LOCAL_MEDIA_ROUTE}/{slug}.avif"

    if not target_file.exists():
        try:
            data = fetch_bytes(remote_url)
        except Exception as error:  # noqa: BLE001 - one bad cover shouldn't fail the build
            print(f"[catalog] cover download failed for {slug}: {error}", file=sys.stderr)
            return False
        if not data:
            return False
        avif = to_avif(data, src_ext)
        if not avif:
            return False  # unconvertible source or encode failure; keep remote cover
        target_file.parent.mkdir(parents=True, exist_ok=True)
        target_file.write_bytes(avif)

    entry["media"]["cover_avif"] = local_url
    return True


def _download_covers(
    entries: list[dict[str, Any]],
    media_root: Path,
    fetch_bytes: Callable[[str], bytes],
    to_avif: Callable[[bytes, str], bytes | None],
    max_workers: int,
) -> int:
    media_root.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
        results = pool.map(
            lambda entry: _download_cover(entry, media_root, fetch_bytes, to_avif), entries
        )
        return sum(1 for ok in results if ok)


def _mirror_covers_enabled(explicit: bool | None) -> bool:
    """Whether to mirror covers locally. An explicit download_media argument wins;
    otherwise the ASTRODX_COVERS env var decides ("remote" -> off, else on)."""
    if explicit is not None:
        return explicit
    return os.environ.get(COVERS_MODE_ENV, "local").strip().lower() != "remote"


def _parse_lxns_aliases(payload: object) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}
    if not isinstance(payload, dict):
        return out
    for item in payload.get("aliases", []):
        song_id = item.get("song_id")
        aliases = [a for a in item.get("aliases", []) if isinstance(a, str) and a.strip()]
        if isinstance(song_id, int) and aliases:
            out[song_id] = aliases
    return out


def _parse_yuzuchan_aliases(payload: object) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}
    if not isinstance(payload, dict):
        return out
    for item in payload.get("content", []):
        song_id = item.get("SongID")
        aliases = [a for a in item.get("Alias", []) if isinstance(a, str) and a.strip()]
        if isinstance(song_id, int) and aliases:
            out[song_id] = aliases
    return out


def fetch_alias_map(
    fetch_text: Callable[[str], str] = default_fetch_text,
) -> dict[int, list[str]]:
    """Fetch and union the Lxns + yuzuchan alias lists as {song_id: [alias, ...]}.

    Each source is independently best-effort: one failing (network/JSON/shape) is
    logged and skipped rather than aborting the build (mirrors the non-fatal
    IndexNow CI handling). Aliases are unioned per song id, de-duplicated
    case-insensitively while preserving first-seen order.
    """
    sources = (
        ("lxns", LXNS_ALIAS_URL, _parse_lxns_aliases),
        ("yuzuchan", YUZUCHAN_ALIAS_URL, _parse_yuzuchan_aliases),
    )

    merged: dict[int, list[str]] = {}
    for name, url, parse in sources:
        try:
            partial = parse(json.loads(fetch_text(url)))
        except Exception as error:  # noqa: BLE001 — network/JSON/shape are all non-fatal
            print(f"[catalog] alias source {name} failed ({error}); skipping")
            continue
        for song_id, aliases in partial.items():
            bucket = merged.setdefault(song_id, [])
            seen = {a.casefold() for a in bucket}
            for alias in aliases:
                if alias.casefold() not in seen:
                    bucket.append(alias)
                    seen.add(alias.casefold())
    return merged


def _aliases_for(short_id: str, alias_map: dict[int, list[str]]) -> list[str]:
    """Resolve a chart's aliases from the Lxns map by its maimai song id.

    AstroDX short_ids follow the maimai id convention where DX charts carry a
    +10000 offset and UTAGE charts +100000, while Lxns keys aliases on the base
    song id. So an exact-id miss falls back to the de-offset base id.
    """
    if not alias_map or not short_id.isdigit():
        return []
    n = int(short_id)
    candidates = [n]
    if 10000 <= n < 100000:
        candidates.append(n - 10000)
    elif n >= 100000:
        candidates.append(n - 100000)
    for key in candidates:
        if key in alias_map:
            return alias_map[key]
    return []


def _attach_aliases(
    entries: list[dict[str, Any]], alias_map: dict[int, list[str]]
) -> int:
    """Set each entry's "aliases"; returns how many entries matched an alias.

    Positions the key right after "short_id" so enriching an already-built index
    yields the same field order as a fresh build (keeps the generated diff clean).
    """
    matched = 0
    for index, entry in enumerate(entries):
        aliases = _aliases_for(str(entry.get("short_id", "") or ""), alias_map)
        if aliases:
            matched += 1
        if "aliases" in entry:
            entry["aliases"] = aliases
            continue
        rebuilt: dict[str, Any] = {}
        for key, value in entry.items():
            rebuilt[key] = value
            if key == "short_id":
                rebuilt["aliases"] = aliases
        rebuilt.setdefault("aliases", aliases)  # no short_id key — append at end
        entries[index] = rebuilt
    return matched


def enrich_aliases(
    root: Path, fetch_text: Callable[[str], str] = default_fetch_text
) -> Path:
    """Merge aliases into an already-built catalog index.json in place.

    Lets aliases be refreshed on their own cadence without re-running the full,
    download-heavy build. Safe to run repeatedly.
    """
    catalog_path = root / "data" / "catalog" / "index.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    matched = _attach_aliases(catalog["entries"], fetch_alias_map(fetch_text))
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[catalog] aliases: matched {matched}/{len(catalog['entries'])} entries")
    return catalog_path


def build_catalog(
    root: Path,
    fetch_text: Callable[[str], str] = default_fetch_text,
    fetch_bytes: Callable[[str], bytes] | None = default_fetch_bytes,
    to_avif: Callable[[bytes, str], bytes | None] = _to_avif_lossless,
    download_media: bool | None = None,
    media_root: Path | None = None,
    max_workers: int = 8,
) -> Path:
    generated_at = datetime.now(timezone.utc).isoformat()
    items = json.loads(fetch_text(INDEX_URL))

    entries = [_build_entry(item, generated_at) for item in items]
    entries.sort(key=lambda entry: entry["id"])
    _assign_route_slugs(entries)

    # Community aliases (别名) so a chart is findable by its nicknames; best-effort.
    matched = _attach_aliases(entries, fetch_alias_map(fetch_text))
    print(f"[catalog] aliases: matched {matched}/{len(entries)} entries")

    # Cover handling is switchable before a push via ASTRODX_COVERS (or the
    # download_media arg): "remote" leaves cover_url pointing at the remote host;
    # otherwise covers are mirrored to public/covers as lossless AVIF and exposed
    # via media.cover_avif (cover_url stays remote for the .adx download and OG).
    if _mirror_covers_enabled(download_media) and fetch_bytes is not None:
        target = media_root or (root / "apps" / "web" / "public" / "covers")
        saved = _download_covers(entries, target, fetch_bytes, to_avif, max_workers)
        print(f"[catalog] mirrored {saved}/{len(entries)} cover images (AVIF) to {target}")
    else:
        print("[catalog] covers: using remote image links (no local mirror)")

    catalog = {
        "generated_at": generated_at,
        "total_entries": len(entries),
        "categories": {"Remote": sorted({entry["subcategory"] for entry in entries})},
        "entries": entries,
    }

    catalog_path = root / "data" / "catalog" / "index.json"
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return catalog_path
