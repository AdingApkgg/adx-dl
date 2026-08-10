from __future__ import annotations

import copy
import hashlib
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

# Authoritative, version-complete chart index, now served by the Alice mirror.
INDEX_URL = "https://astrodx-charts-alice.saop.cc/index.json"
# Chart media (bg.png / track.mp3 / pv.mp4 / bg.avif / bg.webp) is served from the
# Cloudflare R2 bucket, keyed by <versionid>/<shortid>/<file> — the same layout as
# the index.json `path`, so URLs are just MEDIA_BASE + that relative path.
MEDIA_BASE = "https://astrodx-charts.saop.cc/"
# maidata.txt is also available from Alice and is mirrored locally by
# mirror_chart_assets for same-origin fetch.
MAIDATA_BASE = "https://astrodx-charts-alice.saop.cc/"

# Attribution travels inside the payload. Anyone (human or agent) who copies
# index.json — or a single entry out of it — carries the source link with them,
# which a link on the website alone would not survive. See ATTRIBUTION_KEYS
# below: these fields are deliberately excluded from the content fingerprint so
# rewording them never restamps every entry's imported_at.
SITE_URL = "https://adxdls.saop.cc"
DATA_LICENSE = "CC-BY-4.0"
DATA_LICENSE_URL = f"{SITE_URL}/license"
ATTRIBUTION = (
    f"Catalog data from ADX 谱面资源 ({SITE_URL}), licensed CC BY 4.0. "
    "Reuse freely with attribution and a link back to the source."
)
LICENSE_NOTE = (
    f"Catalog metadata: CC BY 4.0, credit {SITE_URL}. "
    "Chart files, cover art, audio and PV remain with their original rights holders."
)

# Song aliases (别名) — community nicknames used to find a chart by an alternate
# name, the same idea as nonebot-plugin-maimaidx's alias lookup. Both sources are
# free no-auth JSON keyed by the canonical maimai song id and are unioned per id:
#   Lxns (落雪咖啡屋): {"aliases": [{"song_id": int, "aliases": [str, ...]}, ...]}
#   柚子 (yuzuchan):   {"content": [{"SongID": int, "Alias": [str, ...]}, ...]}
LXNS_ALIAS_URL = "https://maimai.lxns.net/api/v0/maimai/alias/list"
YUZUCHAN_ALIAS_URL = "https://www.yuzuchan.moe/api/maimaidx/maimaidxalias"

# UTAGE (宴) chart-type kanji. The upstream index only carries it inside the
# title's "[X]" prefix, which is not glyph-normalized: 3 charts ship the Chinese
# 藏 where the other 9 use the Japanese 蔵, splitting one UTAGE type across two
# cabinet values. Lxns' song list exposes the kanji as its own field, so it is
# both the variant authority below and the cross-check in fetch_utage_kanji_map.
LXNS_SONG_URL = "https://maimai.lxns.net/api/v0/maimai/song/list"
UTAGE_KANJI_VARIANTS = {"藏": "蔵"}
# A chart is UTAGE when the upstream item says so. Three independent signals
# agree on all 128 UTAGE charts in the current index (see _utage_signals):
# genreid 107, a lone slot-7 "Utage" difficulty, and the shortid convention.
# genreid is preferred — it is a first-party maimai field, unlike the id
# threshold (an upstream convention) and the slot (a packing detail).
UTAGE_GENRE_ID = 107
UTAGE_SHORT_ID_MIN = 100000
UTAGE_SLOT = 7

# Cover images are mirrored into the web app's public/ during the build so the
# static site serves small local copies instead of hot-linking the remote host.
# Two formats are written per cover: AVIF (primary) and WebP (compatibility
# fallback for browsers without AVIF, e.g. Safari < 16.4), both at COVER_QUALITY.
# The remote original is kept on the entry (for the .adx download, OG/social
# images, and as the final <img> fallback); audio and PV always stay remote.
LOCAL_MEDIA_ROUTE = "/covers"
COVER_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
# Raster formats avifenc / cwebp can decode as input. Others are left remote.
AVIF_SOURCE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
WEBP_SOURCE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
# Lossy quality (0–100) for both mirrored formats; the same target keeps AVIF
# (primary) and WebP (fallback) visually consistent. ~70 stays clean on jacket
# art while keeping files small.
COVER_QUALITY = 70
# Build-time switch (set before a push): ASTRODX_COVERS=remote uses the remote
# image links directly (no download/convert); any other value (default "local")
# mirrors covers to public/covers as AVIF + WebP. The web layer falls back to the
# remote cover_url automatically when no local copy exists, so both modes work.
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
    26: "maimai DX CiRCLE PLUS",
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


def _maidata_url(relative_path: str) -> str:
    """Origin-host URL for a maidata.txt (kept off R2). Used by the local mirror."""
    from urllib.parse import quote

    return MAIDATA_BASE + quote(relative_path, safe="/")


def _resolve_name_cabinet(title: str, short_id: str, path: str) -> tuple[str, str]:
    # The chart folders are named by shortid (e.g. "111069"), so cabinet can no
    # longer be read off a "[DX]"/"[奏]" folder prefix. Derive it from the stable
    # maimai shortid convention instead: <10000 ST, 10000–99999 DX, >=100000 UTAGE.
    # For UTAGE the specific 宴-character survives as the title's "[X]" prefix
    # (e.g. "[協]太陽系デスコ"), which we strip for the display/download name — the
    # same name the old "[協] …" folder prefix produced.
    #
    # The prefix is only read once the shortid has already established the chart
    # IS utage — never the other way round, because a normal chart can be titled
    # "[X]" (shortid 11455) and would otherwise be misread as a 宴 type.
    sid = int(short_id) if short_id.isdigit() else -1
    if sid >= UTAGE_SHORT_ID_MIN:
        match = re.match(r"^\[([^\]]*)\]\s*(.*)$", title)
        if match:
            cabinet = match.group(1).strip() or "宴"
            name = match.group(2).strip() or title
        else:
            cabinet, name = "宴", title
        cabinet = UTAGE_KANJI_VARIANTS.get(cabinet, cabinet)
    elif sid >= 10000:
        cabinet, name = "DX", title
    elif sid >= 0:
        cabinet, name = "ST", title
    else:
        cabinet, name = "", title
    if not name:
        name = (path.split("/")[-1] if path else "") or "chart"
    return name, cabinet


def _utage_signals(item: dict[str, Any]) -> dict[str, bool]:
    """The three independent "this is a UTAGE chart" signals in an index item.

    They agree on every chart in the current index. Disagreement means the
    upstream packing changed (a re-slotted difficulty, a shifted id range, a
    mislabelled genre), which is worth reporting rather than silently resolving.
    """
    short_id = str(item.get("shortid", "") or "").strip()
    difficulties = item.get("difficulties") or []
    return {
        "genre": item.get("genreid") == UTAGE_GENRE_ID,
        "slot": any(
            difficulty.get("slot") == UTAGE_SLOT
            or str(difficulty.get("name", "") or "").strip().casefold() == "utage"
            for difficulty in difficulties
        ),
        "shortid": short_id.isdigit() and int(short_id) >= UTAGE_SHORT_ID_MIN,
    }


def _is_utage(item: dict[str, Any]) -> bool:
    """Whether an index item is a UTAGE chart.

    The shortid range decides: it is the one signal that held even on the older
    index shape, where genreid was absent and a 宴 chart's notes could sit in
    Basic's slot. genreid only covers items whose shortid is unusable, and the
    slot never decides on its own — it is the signal that historically drifted.
    """
    signals = _utage_signals(item)
    if str(item.get("shortid", "") or "").strip().isdigit():
        return signals["shortid"]
    return signals["genre"]


def _report_utage_signal_conflicts(items: list[dict[str, Any]]) -> list[str]:
    """Log items whose UTAGE signals disagree; returns the reported lines."""
    conflicts = []
    for item in items:
        signals = _utage_signals(item)
        if len(set(signals.values())) == 1:
            continue
        agreeing = ", ".join(f"{key}={value}" for key, value in signals.items())
        conflicts.append(
            f"{item.get('shortid', '?')} {item.get('title', '?')!r}: {agreeing}"
        )
    for line in conflicts:
        print(f"[catalog] utage signal conflict: {line}")
    return conflicts


def _build_entry(item: dict[str, Any], generated_at: str) -> dict[str, Any]:
    path = str(item.get("path", "")).strip()
    title = str(item.get("title", "") or "")
    short_id = str(item.get("shortid", "") or "").strip()
    name, cabinet = _resolve_name_cabinet(title, short_id, path)

    files = item.get("files") or {}

    def media(key: str) -> str:
        rel = files.get(key)
        return _media_url(rel) if rel else ""

    # maidata comes from Alice; the other media blobs use the primary R2 route.
    maidata_url = _maidata_url(files["maidata"]) if files.get("maidata") else ""
    audio_url = media("audio")
    cover_url = media("bg")
    pv_url = media("pv")

    version_id = item.get("versionid")
    version = CANONICAL_VERSIONS.get(version_id, str(item.get("version", "") or "").strip())
    stable_key = f"{short_id}-{name}" if short_id else name

    # UTAGE (宴) charts used to be packed inconsistently upstream: most carried
    # their notes in inote_7, but some sat in inote_2 — Basic's slot — and index.py
    # names each difficulty after its slot, so those came through as "Basic" on a 宴
    # chart. Upstream now labels all 128 of them "Utage" itself, but the rename is
    # kept so a regression there cannot put a Basic pill on a 宴 chart again.
    is_utage = _is_utage(item)

    difficulties = [
        {
            "slot": difficulty.get("slot"),
            "name": "Utage" if is_utage else str(difficulty.get("name", "") or ""),
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
        # Canonical page for this chart on the source site: the one field that
        # makes a copied row traceable back here.
        "page_url": f"{SITE_URL}/charts/{short_id}" if short_id else SITE_URL,
        "license_note": LICENSE_NOTE,
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
            # Local copies for on-page display; set during the build. AVIF is the
            # primary tier, WebP the fallback for browsers without AVIF.
            "cover_avif": "",
            "cover_webp": "",
            "audio_url": audio_url,
            "pv_url": pv_url,
        },
        "imported_at": generated_at,
    }


def _cover_extension(remote_url: str) -> str:
    ext = os.path.splitext(unquote(urlparse(remote_url).path))[1].lower()
    return ext if ext in COVER_EXTENSIONS else ".png"


def _to_avif(data: bytes, src_ext: str) -> bytes | None:
    """Convert image bytes to AVIF via avifenc at COVER_QUALITY (the primary
    display tier). Returns None when the source format can't be decoded, avifenc
    is missing, or the encode fails — the caller then keeps the remote cover as a
    graceful fallback."""
    if src_ext not in AVIF_SOURCE_EXTENSIONS:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"in{src_ext}"
        dst = Path(tmp) / "out.avif"
        src.write_bytes(data)
        try:
            subprocess.run(
                ["avifenc", "-q", str(COVER_QUALITY), str(src), str(dst)],
                check=True,
                capture_output=True,
                timeout=180,
            )
        except (OSError, subprocess.SubprocessError) as error:
            print(f"[catalog] avifenc failed ({src_ext}): {error}", file=sys.stderr)
            return None
        return dst.read_bytes()


def _to_webp(data: bytes, src_ext: str) -> bytes | None:
    """Convert image bytes to WebP via cwebp at COVER_QUALITY. WebP is the
    compatibility fallback tier (browsers without AVIF, e.g. Safari < 16.4).
    Returns None when the source can't be decoded, cwebp is missing, or the
    encode fails — the caller then keeps the remote cover as a fallback."""
    if src_ext not in WEBP_SOURCE_EXTENSIONS:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"in{src_ext}"
        dst = Path(tmp) / "out.webp"
        src.write_bytes(data)
        try:
            subprocess.run(
                ["cwebp", "-quiet", "-q", str(COVER_QUALITY), str(src), "-o", str(dst)],
                check=True,
                capture_output=True,
                timeout=180,
            )
        except (OSError, subprocess.SubprocessError) as error:
            print(f"[catalog] cwebp failed ({src_ext}): {error}", file=sys.stderr)
            return None
        return dst.read_bytes()


def _download_cover(
    entry: dict[str, Any],
    media_root: Path,
    fetch_bytes: Callable[[str], bytes],
    to_avif: Callable[[bytes, str], bytes | None],
    to_webp: Callable[[bytes, str], bytes | None],
) -> tuple[bool, bool]:
    """Mirror one entry's cover into media_root as AVIF (<slug>.avif) and WebP
    (<slug>.webp), pointing media.cover_avif/cover_webp at them for on-page
    display. The remote original is downloaded once and
    encoded to both formats. cover_url and files.background keep the remote
    original (used by the .adx download, OG/social images, and as the final
    <img> fallback). Returns (avif_ok, webp_ok); either failing just leaves its
    field empty so display falls back to the next tier."""
    remote_url = entry["media"]["cover_url"]
    if not remote_url or remote_url.startswith("/"):
        return (False, False)  # no cover, or already local

    slug = entry["slug"]
    src_ext = _cover_extension(remote_url)
    avif_file = media_root / f"{slug}.avif"
    webp_file = media_root / f"{slug}.webp"
    avif_ok = avif_file.exists()
    webp_ok = webp_file.exists()

    # Download the remote original once if either local copy is still missing.
    if not avif_ok or not webp_ok:
        try:
            data = fetch_bytes(remote_url)
        except Exception as error:  # noqa: BLE001 - one bad cover shouldn't fail the build
            print(f"[catalog] cover download failed for {slug}: {error}", file=sys.stderr)
            return (avif_ok, webp_ok)
        if not data:
            return (avif_ok, webp_ok)

        if not avif_ok:
            avif = to_avif(data, src_ext)
            if avif:
                avif_file.write_bytes(avif)
                avif_ok = True
        if not webp_ok:
            webp = to_webp(data, src_ext)
            if webp:
                webp_file.write_bytes(webp)
                webp_ok = True

    if avif_ok:
        entry["media"]["cover_avif"] = f"{LOCAL_MEDIA_ROUTE}/{slug}.avif"
    if webp_ok:
        entry["media"]["cover_webp"] = f"{LOCAL_MEDIA_ROUTE}/{slug}.webp"
    return (avif_ok, webp_ok)


def _download_covers(
    entries: list[dict[str, Any]],
    media_root: Path,
    fetch_bytes: Callable[[str], bytes],
    to_avif: Callable[[bytes, str], bytes | None],
    to_webp: Callable[[bytes, str], bytes | None],
    max_workers: int,
) -> tuple[int, int]:
    media_root.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
        results = list(
            pool.map(
                lambda entry: _download_cover(
                    entry, media_root, fetch_bytes, to_avif, to_webp
                ),
                entries,
            )
        )
    avif = sum(1 for avif_ok, _ in results if avif_ok)
    webp = sum(1 for _, webp_ok in results if webp_ok)
    return (avif, webp)


def _mirror_covers_enabled(explicit: bool | None) -> bool:
    """Whether to mirror covers locally. Covers are served from R2 by default, so
    the legacy local AVIF/WebP mirror is OFF unless opted back in: an explicit
    download_media argument wins; otherwise ASTRODX_COVERS=local re-enables it."""
    if explicit is not None:
        return explicit
    return os.environ.get(COVERS_MODE_ENV, "").strip().lower() == "local"


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


def _parse_lxns_utage_kanji(payload: object) -> dict[int, str]:
    """{song_id: 宴 kanji} from the Lxns song list's difficulties.utage[].kanji."""
    out: dict[int, str] = {}
    if not isinstance(payload, dict):
        return out
    for song in payload.get("songs", []):
        song_id = song.get("id")
        if not isinstance(song_id, int):
            continue
        difficulties = song.get("difficulties")
        utage = difficulties.get("utage", []) if isinstance(difficulties, dict) else []
        for chart in utage or []:
            kanji = str(chart.get("kanji", "") or "").strip()
            if kanji:
                out[song_id] = kanji
                break
    return out


def fetch_utage_kanji_map(
    fetch_text: Callable[[str], str] = default_fetch_text,
) -> dict[int, str]:
    """Fetch the Lxns 宴 kanji per song id; best-effort like fetch_alias_map.

    Lxns only lists charts currently in the game, so this covers roughly half the
    catalog's UTAGE charts — enough to catch glyph drift in the titles we parse,
    not enough to replace them. A failure here leaves every cabinet as parsed.
    """
    try:
        return _parse_lxns_utage_kanji(json.loads(fetch_text(LXNS_SONG_URL)))
    except Exception as error:  # noqa: BLE001 — network/JSON/shape are all non-fatal
        print(f"[catalog] utage kanji source lxns failed ({error}); skipping")
        return {}


def _apply_utage_kanji(
    entries: list[dict[str, Any]], kanji_map: dict[int, str]
) -> tuple[int, int]:
    """Reconcile each UTAGE entry's cabinet against Lxns' kanji.

    Returns (checked, corrected). Lxns wins on a mismatch: the title prefix is
    free text an upstream packer typed, the kanji is a dedicated field.
    """
    checked = corrected = 0
    for entry in entries:
        short_id = str(entry.get("short_id", "") or "").strip()
        if not short_id.isdigit() or int(short_id) < UTAGE_SHORT_ID_MIN:
            continue
        kanji = kanji_map.get(int(short_id))
        if not kanji:
            continue
        checked += 1
        if entry.get("cabinet") != kanji:
            print(
                f"[catalog] utage kanji: {short_id} {entry.get('title', '')!r} "
                f"{entry.get('cabinet')!r} -> {kanji!r}"
            )
            entry["cabinet"] = kanji
            corrected += 1
    return checked, corrected


def _aliases_for(short_id: str, alias_map: dict[int, list[str]]) -> list[str]:
    """Resolve a chart's aliases from the merged alias map by its maimai song id.

    AstroDX short_ids follow the maimai id convention where DX charts carry a
    +10000 offset and UTAGE charts +100000, while the sources key aliases on the
    base song id — inconsistently: the same chart can appear under both ids, with
    different aliases on each. So both keys are unioned rather than stopping at
    the first hit. Returning early would let a sparse offset-id entry mask a rich
    base-id one (yuzuchan filing a bare "dragoon" under 10367 hid the 15 aliases
    under 367).
    """
    if not alias_map or not short_id.isdigit():
        return []
    n = int(short_id)
    candidates = [n]
    if 10000 <= n < 100000:
        candidates.append(n - 10000)
    elif n >= 100000:
        candidates.append(n - 100000)

    merged: list[str] = []
    seen: set[str] = set()
    for key in candidates:
        for alias in alias_map.get(key, []):
            folded = alias.casefold()
            if folded not in seen:
                seen.add(folded)
                merged.append(alias)
    return merged


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


# Fields excluded from an entry's content fingerprint. imported_at is the value
# we're deciding. cover_avif/cover_webp flip with the ASTRODX_COVERS build flag
# (mirror vs. remote) rather than with content. aliases and slug come from
# best-effort/deterministic post-processing — a flaky alias source or a shifted
# slug tie-break shouldn't restamp <lastmod>.
# Boilerplate that is identical on every entry and changes only when we reword
# it. Keeping it out of the fingerprint means an attribution edit never restamps
# 1800+ imported_at values (which would churn every sitemap lastmod and make
# IndexNow resubmit the whole catalog).
ATTRIBUTION_KEYS = ("page_url", "license_note")

# Fields owned by the post-build enrichment pass
# (apps/web/scripts/enrich-chart-details.ts): note counts, chart duration, BPM
# range, measured download sizes and romaji. This builder writes none of them —
# title_en/artist_en are emitted empty here and filled from maidata later — so
# without this exclusion every rebuild would see "" != "Some Title" on all 1800+
# entries and restamp the entire catalog's imported_at.
ENRICHED_KEYS = (
    "title_en",
    "artist_en",
    "title_romaji",
    "artist_romaji",
    "duration_ms",
    "bpm_min",
    "bpm_max",
    "file_bytes",
)
ENRICHED_DIFFICULTY_KEYS = ("notes", "duration_ms")


def _content_fingerprint(entry: dict[str, Any]) -> str:
    clone = copy.deepcopy(entry)
    clone.pop("imported_at", None)
    clone.pop("aliases", None)
    clone.pop("slug", None)
    for key in ATTRIBUTION_KEYS:
        clone.pop(key, None)
    for key in ENRICHED_KEYS:
        clone.pop(key, None)
    for difficulty in clone.get("difficulties") or []:
        if isinstance(difficulty, dict):
            for key in ENRICHED_DIFFICULTY_KEYS:
                difficulty.pop(key, None)
    media = clone.get("media")
    if isinstance(media, dict):
        media.pop("cover_avif", None)
        media.pop("cover_webp", None)
    encoded = json.dumps(clone, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


# Keep imported_at stable across rebuilds so <lastmod> is a real per-entry
# freshness signal. An entry inherits its previous timestamp when its content
# fingerprint is unchanged and only takes the current build time when it is new
# or genuinely changed. Without this, every rebuild restamps all 1500+ entries to
# the same instant, which trains crawlers to ignore lastmod entirely.
def _carry_forward_timestamps(
    entries: list[dict[str, Any]], previous_entries: list[dict[str, Any]]
) -> int:
    previous_by_id = {
        entry["id"]: entry
        for entry in previous_entries
        if isinstance(entry, dict) and entry.get("id")
    }
    carried = 0
    for entry in entries:
        previous = previous_by_id.get(entry.get("id"))
        if not previous:
            continue
        prior_imported_at = previous.get("imported_at")
        if not prior_imported_at:
            continue
        if _content_fingerprint(previous) == _content_fingerprint(entry):
            entry["imported_at"] = prior_imported_at
            carried += 1
    return carried


def _load_previous_entries(catalog_path: Path) -> list[dict[str, Any]]:
    if not catalog_path.exists():
        return []
    try:
        previous = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    entries = previous.get("entries") if isinstance(previous, dict) else None
    return entries if isinstance(entries, list) else []


def build_catalog(
    root: Path,
    fetch_text: Callable[[str], str] = default_fetch_text,
    fetch_bytes: Callable[[str], bytes] | None = default_fetch_bytes,
    to_avif: Callable[[bytes, str], bytes | None] = _to_avif,
    to_webp: Callable[[bytes, str], bytes | None] = _to_webp,
    download_media: bool | None = None,
    media_root: Path | None = None,
    max_workers: int = 8,
) -> Path:
    generated_at = datetime.now(timezone.utc).isoformat()
    items = json.loads(fetch_text(INDEX_URL))

    # UTAGE detection reads three upstream signals that currently agree on all of
    # them; report any that drift apart instead of letting one quietly win.
    conflicts = _report_utage_signal_conflicts(items)
    if conflicts:
        print(f"[catalog] utage: {len(conflicts)} item(s) with disagreeing signals")

    entries = [_build_entry(item, generated_at) for item in items]
    entries.sort(key=lambda entry: entry["id"])
    _assign_route_slugs(entries)

    # The 宴 kanji is parsed out of the title prefix, which is not glyph-normalized
    # upstream; reconcile it against Lxns' dedicated field where it reaches.
    checked, corrected = _apply_utage_kanji(entries, fetch_utage_kanji_map(fetch_text))
    print(f"[catalog] utage kanji: corrected {corrected}/{checked} cross-checked")

    # Community aliases (别名) so a chart is findable by its nicknames; best-effort.
    matched = _attach_aliases(entries, fetch_alias_map(fetch_text))
    print(f"[catalog] aliases: matched {matched}/{len(entries)} entries")

    # Cover handling is switchable before a push via ASTRODX_COVERS (or the
    # download_media arg): "remote" leaves cover_url pointing at the remote host;
    # otherwise covers are mirrored to public/covers as AVIF + WebP and exposed
    # via media.cover_avif/cover_webp (cover_url stays remote for the .adx
    # download, OG images, and as the final <img> fallback).
    if _mirror_covers_enabled(download_media) and fetch_bytes is not None:
        target = media_root or (root / "apps" / "web" / "public" / "covers")
        avif_n, webp_n = _download_covers(
            entries, target, fetch_bytes, to_avif, to_webp, max_workers
        )
        print(
            f"[catalog] mirrored covers to {target}: "
            f"{avif_n}/{len(entries)} AVIF, {webp_n}/{len(entries)} WebP"
        )
    else:
        # Covers are served from R2 in the same <vid>/<sid>/ dir as bg.png, so
        # point the display tiers (AVIF primary, WebP fallback) at bg.avif/bg.webp
        # there instead of mirroring locally into the Pages build.
        for entry in entries:
            base = entry["media"]["entry_base_url"]
            if base:
                entry["media"]["cover_avif"] = f"{base}bg.avif"
                entry["media"]["cover_webp"] = f"{base}bg.webp"
        print("[catalog] covers: served from R2 (<entry>/bg.avif, bg.webp)")

    catalog_path = root / "data" / "catalog" / "index.json"

    # Preserve per-entry lastmod across rebuilds: only new or changed entries take
    # the current build time; unchanged ones keep their prior imported_at.
    carried = _carry_forward_timestamps(entries, _load_previous_entries(catalog_path))
    print(
        f"[catalog] lastmod: kept {carried}/{len(entries)} timestamps, "
        f"stamped {len(entries) - carried} at {generated_at}"
    )

    catalog = {
        "generated_at": generated_at,
        "source": SITE_URL,
        "license": DATA_LICENSE,
        "license_url": DATA_LICENSE_URL,
        "attribution": ATTRIBUTION,
        "total_entries": len(entries),
        "categories": {"Remote": sorted({entry["subcategory"] for entry in entries})},
        "entries": entries,
    }

    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return catalog_path
