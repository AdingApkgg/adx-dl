"""Persist the latest usable LXNS area list independently of the chart origin."""

import http.client
import json
import os
import tempfile
from pathlib import Path
from typing import Callable
from urllib.request import urlopen

LXNS_SONG_URL = "https://maimai.lxns.net/api/v0/maimai/song/list"
AREA_CACHE = "data/catalog/.lxns-areas-cache.json"


def fetch_lxns_songs(url: str) -> str:
    with urlopen(url, timeout=12) as response:
        return response.read().decode("utf-8")


def refresh_area_snapshot(
    path: Path, fetch_text: Callable[[str], str] = fetch_lxns_songs
) -> dict | None:
    """Return the song payload for other enrichments and atomically save usable areas."""
    try:
        payload = json.loads(fetch_text(LXNS_SONG_URL))
        songs = payload.get("songs") if isinstance(payload, dict) else None
        if (
            not isinstance(songs, list) or not songs
            or not all(isinstance(song, dict) for song in songs)
        ):
            raise ValueError("missing or invalid song list")
    except (OSError, http.client.HTTPException, ValueError) as error:
        print(f"[catalog] LXNS song list unavailable ({error}); using saved areas")
        return None

    areas = {}
    for song in songs:
        song_id, label, difficulties = song.get("id"), song.get("map"), song.get("difficulties")
        if (
            type(song_id) is not int or not 0 < song_id < 10000
            or not isinstance(label, str) or not label.strip()
            or not isinstance(difficulties, dict)
        ):
            continue
        for chart_type, offset in (("standard", 0), ("dx", 10000)):
            charts = difficulties.get(chart_type)
            if isinstance(charts, list) and charts:
                areas[str(song_id + offset)] = label.strip()
    if not areas:
        print("[catalog] LXNS returned no usable areas; using saved areas")
        return payload

    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as file:
        temporary = Path(file.name)
        try:
            json.dump(
                {"source": LXNS_SONG_URL, "areas": areas},
                file,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            file.write("\n")
            file.close()
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    print(f"[catalog] LXNS areas: saved {len(areas)} chart mappings")
    return payload
