from __future__ import annotations

from typing import Any


def _first_non_empty(mapping: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = mapping.get(key, "").strip()
        if value:
            return value
    return ""


def _parse_float(value: str) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_maidata_text(text: str) -> dict[str, Any]:
    raw: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("&") or "=" not in line:
            continue
        key, value = line[1:].split("=", 1)
        raw[key] = value

    difficulties: list[dict[str, Any]] = []
    for slot in range(1, 8):
        level = _first_non_empty(raw, f"lv_{slot}")
        note_text = _first_non_empty(raw, f"inote_{slot}")
        designer = _first_non_empty(raw, f"des_{slot}", f"des{slot}")
        if not (level or note_text or designer):
            continue
        difficulties.append(
            {
                "slot": slot,
                "level": level,
                "designer": designer,
                "note_text": note_text,
            }
        )

    return {
        "title": _first_non_empty(raw, "title"),
        "title_en": _first_non_empty(raw, "en_title", "engtitle"),
        "artist": _first_non_empty(raw, "artist"),
        "artist_en": _first_non_empty(raw, "en_artist", "engartist"),
        "version": _first_non_empty(raw, "version"),
        "genre": _first_non_empty(raw, "genre", "des"),
        "cabinet": _first_non_empty(raw, "cabinet"),
        "short_id": _first_non_empty(raw, "shortid"),
        "bpm": _parse_float(_first_non_empty(raw, "wholebpm", "whole_bpm", "bpm")),
        "offset": _parse_float(_first_non_empty(raw, "first")),
        "demo_seek": _parse_float(_first_non_empty(raw, "demo_seek")),
        "demo_len": _parse_float(_first_non_empty(raw, "demo_len")),
        "difficulties": difficulties,
        "raw_keys": raw,
    }
