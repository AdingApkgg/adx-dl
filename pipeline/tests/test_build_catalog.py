import json
import os
import ssl
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import quote

from tools.build_catalog import (
    MAIDATA_BASE,
    MEDIA_BASE,
    _aliases_for,
    build_catalog,
    fetch_alias_map,
)
from tools.mirror_chart_assets import mirror_chart_assets
from tools.remote_catalog import fetch_text


def _media_url(relative_path: str) -> str:
    return MEDIA_BASE + quote(relative_path, safe="/")


def _maidata_url(relative_path: str) -> str:
    return MAIDATA_BASE + quote(relative_path, safe="/")


# The remote index now names chart folders by shortid under a numeric versionid
# dir (e.g. "14/10146"), so cabinet is derived from the shortid, not a folder
# prefix. See tools.build_catalog._resolve_name_cabinet.
SAMPLE_INDEX = json.dumps(
    [
        {
            "title": "コネクト",
            "artist": "ClariS",
            "shortid": "10146",
            "version": "でらっくす PLUS",
            "versionid": 14,
            "genre": "POPSアニメ",
            "bpm": 175,
            "first": 0,
            "path": "14/10146",
            "files": {
                "maidata": "14/10146/maidata.txt",
                "audio": "14/10146/track.mp3",
                "bg": "14/10146/bg.png",
                "pv": "14/10146/pv.mp4",
            },
            "difficulties": [
                {"slot": 2, "name": "Basic", "level": "4.0", "designer": None, "has_notes": True},
                {"slot": 5, "name": "Master", "level": "13.4", "designer": "Charter", "has_notes": True},
                {"slot": 6, "name": "Re:Master", "level": "0", "designer": None, "has_notes": False},
            ],
        },
        {
            "title": "Bare Song",
            "artist": "Nobody",
            "shortid": "146",
            "version": "FiNALE",
            "versionid": 12,
            "genre": "",
            "bpm": None,
            "first": 0,
            "path": "12/146",
            "files": {
                "maidata": "12/146/maidata.txt",
                "audio": "12/146/track.mp3",
                "bg": "12/146/bg.png",
                "pv": "",
            },
            "difficulties": [
                {"slot": 3, "name": "Advanced", "level": "7.0", "designer": None, "has_notes": True},
            ],
        },
    ],
    ensure_ascii=False,
)

# A UTAGE (宴) chart: shortid >= 100000, and the 宴-character rides in the title
# as a "[X]" prefix (there is no folder prefix to read anymore).
UTAGE_INDEX = json.dumps(
    [
        {
            "title": "[協]太陽系デスコ",
            "artist": "ナユタン星人",
            "shortid": "111069",
            "version": "PRiSM",
            "versionid": 23,
            "genre": "",
            "bpm": 160,
            "first": 0,
            "path": "23/111069",
            "files": {
                "maidata": "23/111069/maidata.txt",
                "audio": "23/111069/track.mp3",
                "bg": "23/111069/bg.png",
                "pv": "",
            },
            "difficulties": [
                {"slot": 7, "name": "U·TAGE", "level": "14", "designer": None, "has_notes": True},
            ],
        },
    ],
    ensure_ascii=False,
)


class BuildCatalogTests(unittest.TestCase):
    def _build(self) -> dict:
        with TemporaryDirectory() as temp_dir:
            catalog_path = build_catalog(
                Path(temp_dir),
                fetch_text=lambda _url: SAMPLE_INDEX,
                download_media=False,
            )
            return json.loads(catalog_path.read_text(encoding="utf-8"))

    def test_transforms_index_into_catalog_entries(self) -> None:
        catalog = self._build()
        self.assertEqual(catalog["total_entries"], 2)
        # Entries are sorted by id: "10146" (CJK stripped) < "146-bare-song".
        konekto = catalog["entries"][0]

        self.assertEqual(konekto["title"], "コネクト")
        self.assertEqual(konekto["artist"], "ClariS")
        # Version is canonicalized from versionid (14 -> maimai DX PLUS).
        self.assertEqual(konekto["version"], "maimai DX PLUS")
        self.assertEqual(konekto["versionid"], 14)
        self.assertEqual(konekto["subcategory"], "maimai DX PLUS")
        # Canonical slug is the numeric shortid (no readable-name alias).
        self.assertEqual(konekto["remote_dir_name"], "コネクト")
        self.assertEqual(konekto["slug"], "10146")
        self.assertEqual(konekto["cabinet"], "DX")
        self.assertEqual(konekto["short_id"], "10146")
        self.assertEqual(konekto["bpm"], 175)
        self.assertEqual(
            konekto["files"]["maidata"],
            _maidata_url("14/10146/maidata.txt"),
        )
        self.assertEqual(
            konekto["media"]["cover_url"],
            _media_url("14/10146/bg.png"),
        )
        # Display covers default to the R2 copies alongside bg.png (no local mirror).
        self.assertEqual(konekto["media"]["cover_avif"], _media_url("14/10146/bg.avif"))
        self.assertEqual(konekto["media"]["cover_webp"], _media_url("14/10146/bg.webp"))
        self.assertTrue(konekto["assets"]["has_pv"])
        self.assertTrue(konekto["assets"]["has_dx_chart"])

    def test_only_playable_difficulties_with_source_names(self) -> None:
        konekto = self._build()["entries"][0]
        # The has_notes=False Re:Master row is dropped; names come from the source.
        self.assertEqual(
            konekto["difficulties"],
            [
                {"slot": 2, "name": "Basic", "level": "4.0", "designer": ""},
                {"slot": 5, "name": "Master", "level": "13.4", "designer": "Charter"},
            ],
        )

    def test_missing_pv_and_standard_cabinet(self) -> None:
        bare = self._build()["entries"][1]
        self.assertEqual(bare["version"], "maimai FiNALE")
        # shortid 146 (< 10000) => Standard cabinet.
        self.assertEqual(bare["cabinet"], "ST")
        self.assertEqual(bare["short_id"], "146")
        self.assertEqual(bare["files"]["pv"], "")
        self.assertEqual(bare["media"]["pv_url"], "")
        self.assertFalse(bare["assets"]["has_pv"])
        self.assertFalse(bare["assets"]["has_dx_chart"])
        self.assertEqual(bare["download_mode"], "onsite")

    def test_utage_cabinet_and_name_from_title_prefix(self) -> None:
        with TemporaryDirectory() as temp_dir:
            catalog_path = build_catalog(
                Path(temp_dir),
                fetch_text=lambda _url: UTAGE_INDEX,
                download_media=False,
            )
            entry = json.loads(catalog_path.read_text(encoding="utf-8"))["entries"][0]
        # shortid >= 100000 => UTAGE; the 宴-character is recovered from the
        # title's "[X]" prefix, and the display name drops that prefix.
        self.assertEqual(entry["cabinet"], "協")
        self.assertEqual(entry["title"], "[協]太陽系デスコ")
        self.assertEqual(entry["remote_dir_name"], "太陽系デスコ")
        self.assertEqual(entry["slug"], "111069")
        self.assertEqual(entry["version"], "maimai DX PRiSM")
        self.assertFalse(entry["assets"]["has_dx_chart"])

    def test_catalog_categories_list_distinct_versions(self) -> None:
        catalog = self._build()
        self.assertEqual(
            catalog["categories"]["Remote"], ["maimai DX PLUS", "maimai FiNALE"]
        )

    def test_mirrors_download_assets_by_route_id(self) -> None:
        seen_urls: list[str] = []

        def fake_fetch_bytes(url: str) -> bytes:
            seen_urls.append(url)
            return f"bytes:{url}".encode()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            mirror_chart_assets(
                root,
                fetch_text=lambda _url: SAMPLE_INDEX,
                fetch_bytes=fake_fetch_bytes,
                max_workers=1,
            )

            # Only maidata is mirrored locally now; bg.png is served from R2.
            self.assertTrue((root / "apps/web/public/adxcs/10146/maidata.txt").exists())
            self.assertTrue((root / "apps/web/public/adxcs/146/maidata.txt").exists())
            self.assertFalse((root / "apps/web/public/adxcs/10146/bg.png").exists())
            self.assertFalse((root / "apps/web/public/adxcs/146/bg.png").exists())

        # maidata is mirrored from the origin host (not R2, which has no maidata).
        self.assertIn(_maidata_url("14/10146/maidata.txt"), seen_urls)
        self.assertNotIn(_media_url("14/10146/bg.png"), seen_urls)
        self.assertNotIn(_maidata_url("14/10146/bg.png"), seen_urls)

    def test_downloads_cover_images_as_local_avif(self) -> None:
        seen_exts: list[str] = []

        def fake_avif(data: bytes, src_ext: str) -> bytes:
            seen_exts.append(src_ext)
            return b"AVIFDATA"

        def fake_webp(data: bytes, src_ext: str) -> bytes:
            return b"WEBPDATA"

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            media_root = root / "media"
            catalog_path = build_catalog(
                root,
                fetch_text=lambda _url: SAMPLE_INDEX,
                fetch_bytes=lambda _url: b"PNGDATA",
                to_avif=fake_avif,
                to_webp=fake_webp,
                download_media=True,
                media_root=media_root,
            )
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

            konekto = catalog["entries"][0]  # slug "10146"
            # Display points at the local AVIF (primary) + WebP (fallback) copies...
            self.assertEqual(konekto["media"]["cover_avif"], "/covers/10146.avif")
            self.assertEqual(konekto["media"]["cover_webp"], "/covers/10146.webp")
            # ...while cover_url and files.background keep the remote original
            # (used by the .adx download and OG/social images).
            self.assertEqual(
                konekto["media"]["cover_url"],
                _media_url("14/10146/bg.png"),
            )
            self.assertEqual(
                konekto["files"]["background"],
                _media_url("14/10146/bg.png"),
            )
            # Audio/PV always stay remote.
            self.assertEqual(
                konekto["media"]["audio_url"],
                _media_url("14/10146/track.mp3"),
            )
            saved = media_root / "10146.avif"
            self.assertTrue(saved.exists())
            self.assertEqual(saved.read_bytes(), b"AVIFDATA")
            saved_webp = media_root / "10146.webp"
            self.assertTrue(saved_webp.exists())
            self.assertEqual(saved_webp.read_bytes(), b"WEBPDATA")

        self.assertIn(".png", seen_exts)  # the source ext is passed to the converter

    def test_keeps_remote_cover_when_download_fails(self) -> None:
        def boom(_url: str) -> bytes:
            raise RuntimeError("network down")

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            catalog_path = build_catalog(
                root,
                fetch_text=lambda _url: SAMPLE_INDEX,
                fetch_bytes=boom,
                to_avif=lambda _data, _ext: b"AVIFDATA",
                to_webp=lambda _data, _ext: b"WEBPDATA",
                download_media=True,
                media_root=root / "media",
            )
            konekto = json.loads(catalog_path.read_text(encoding="utf-8"))["entries"][0]

        # A failed download leaves both local copies empty and the remote URL intact.
        self.assertEqual(konekto["media"]["cover_avif"], "")
        self.assertEqual(konekto["media"]["cover_webp"], "")
        self.assertEqual(
            konekto["media"]["cover_url"],
            _media_url("14/10146/bg.png"),
        )

    def test_keeps_remote_cover_when_conversion_unavailable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            catalog_path = build_catalog(
                root,
                fetch_text=lambda _url: SAMPLE_INDEX,
                fetch_bytes=lambda _url: b"PNGDATA",
                to_avif=lambda _data, _ext: None,  # avifenc missing / encode failed
                to_webp=lambda _data, _ext: None,  # cwebp missing / encode failed
                download_media=True,
                media_root=root / "media",
            )
            konekto = json.loads(catalog_path.read_text(encoding="utf-8"))["entries"][0]

        # Neither local copy written; display falls back to the remote cover.
        self.assertEqual(konekto["media"]["cover_avif"], "")
        self.assertEqual(konekto["media"]["cover_webp"], "")
        self.assertEqual(
            konekto["media"]["cover_url"],
            _media_url("14/10146/bg.png"),
        )

    def test_uses_webp_when_only_avif_conversion_fails(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            media_root = root / "media"
            catalog_path = build_catalog(
                root,
                fetch_text=lambda _url: SAMPLE_INDEX,
                fetch_bytes=lambda _url: b"PNGDATA",
                to_avif=lambda _data, _ext: None,  # avif encode failed
                to_webp=lambda _data, _ext: b"WEBPDATA",  # but webp succeeds
                download_media=True,
                media_root=media_root,
            )
            konekto = json.loads(catalog_path.read_text(encoding="utf-8"))["entries"][0]

            # AVIF missing but WebP succeeded: display uses the local WebP tier; the
            # two formats are converted independently from the single download.
            self.assertEqual(konekto["media"]["cover_avif"], "")
            self.assertEqual(konekto["media"]["cover_webp"], "/covers/10146.webp")
            self.assertTrue((media_root / "10146.webp").exists())
            self.assertFalse((media_root / "10146.avif").exists())

    def test_covers_point_at_r2_without_local_mirror(self) -> None:
        def fetch_should_not_run(_url: str) -> bytes:
            raise AssertionError("R2-cover mode must not download covers")

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            media_root = root / "media"
            # Anything other than ASTRODX_COVERS=local skips the mirror -> R2 covers.
            with patch.dict(os.environ, {"ASTRODX_COVERS": "remote"}):
                catalog_path = build_catalog(
                    root,
                    fetch_text=lambda _url: SAMPLE_INDEX,
                    fetch_bytes=fetch_should_not_run,
                    to_avif=lambda _data, _ext: b"AVIFDATA",
                    to_webp=lambda _data, _ext: b"WEBPDATA",
                    media_root=media_root,
                )
            konekto = json.loads(catalog_path.read_text(encoding="utf-8"))["entries"][0]
            # No local mirror; display covers point at the R2 bg.avif/bg.webp.
            self.assertEqual(konekto["media"]["cover_avif"], _media_url("14/10146/bg.avif"))
            self.assertEqual(konekto["media"]["cover_webp"], _media_url("14/10146/bg.webp"))
            self.assertEqual(
                konekto["media"]["cover_url"],
                _media_url("14/10146/bg.png"),
            )
            self.assertFalse(media_root.exists())

    def test_fetch_text_retries_without_ssl_verification_on_certificate_error(self) -> None:
        calls: list[object] = []

        class FakeResponse:
            def __enter__(self) -> "FakeResponse":
                return self

            def __exit__(self, exc_type, exc, tb) -> None:
                return None

            def read(self) -> bytes:
                return b"ok"

        def fake_urlopen(request, context=None, timeout=0):
            calls.append(context)
            if len(calls) == 1:
                raise URLError(
                    ssl.SSLCertVerificationError(
                        1,
                        "certificate verify failed: unable to get local issuer certificate",
                    )
                )
            return FakeResponse()

        with patch("tools.remote_catalog.urlopen", side_effect=fake_urlopen):
            self.assertEqual(fetch_text("https://adxcs.saop.cc/"), "ok")

        self.assertIsNone(calls[0])
        self.assertIsNotNone(calls[1])

    def test_fetch_text_retries_on_transient_timeout(self) -> None:
        class FakeResponse:
            def __enter__(self) -> "FakeResponse":
                return self

            def __exit__(self, exc_type, exc, tb) -> None:
                return None

            def read(self) -> bytes:
                return b"recovered"

        attempts = {"n": 0}

        def flaky_urlopen(request, context=None, timeout=0):
            attempts["n"] += 1
            if attempts["n"] < 3:
                raise TimeoutError("The read operation timed out")
            return FakeResponse()

        with patch("tools.remote_catalog.time.sleep") as sleep, patch(
            "tools.remote_catalog.urlopen", side_effect=flaky_urlopen
        ):
            self.assertEqual(fetch_text("https://adxcs.saop.cc/"), "recovered")

        self.assertEqual(attempts["n"], 3)  # failed twice, then succeeded
        self.assertEqual(sleep.call_count, 2)  # backed off between attempts

    def test_fetch_text_does_not_retry_on_permanent_http_error(self) -> None:
        attempts = {"n": 0}

        def not_found(request, context=None, timeout=0):
            attempts["n"] += 1
            raise HTTPError("https://adxcs.saop.cc/", 404, "Not Found", {}, None)

        with patch("tools.remote_catalog.time.sleep") as sleep, patch(
            "tools.remote_catalog.urlopen", side_effect=not_found
        ):
            with self.assertRaises(HTTPError):
                fetch_text("https://adxcs.saop.cc/")

        self.assertEqual(attempts["n"], 1)  # 404 is permanent — no retry
        sleep.assert_not_called()

    def test_aliases_resolve_with_dx_and_utage_offset_fallback(self) -> None:
        # Lxns keys aliases on the base maimai song id; AstroDX short_ids carry
        # the +10000 (DX) / +100000 (UTAGE) offset, so the lookup de-offsets.
        alias_map = {8: ["真爱歌", "真爱"], 100: ["告诉你的世界"]}
        self.assertEqual(_aliases_for("100", alias_map), ["告诉你的世界"])  # exact
        self.assertEqual(_aliases_for("10008", alias_map), ["真爱歌", "真爱"])  # DX → base 8
        self.assertEqual(_aliases_for("100008", alias_map), ["真爱歌", "真爱"])  # UTAGE → base 8
        self.assertEqual(_aliases_for("999", alias_map), [])  # no alias
        self.assertEqual(_aliases_for("", alias_map), [])  # non-numeric short_id

    def test_fetch_alias_map_is_non_fatal_on_unexpected_payload(self) -> None:
        # A non-dict payload (e.g. an HTML error page parsed as JSON list) must
        # not break the build — it yields an empty map.
        self.assertEqual(fetch_alias_map(lambda _url: "[]"), {})
        self.assertEqual(
            fetch_alias_map(lambda _url: json.dumps({"aliases": [{"song_id": 8, "aliases": ["真爱"]}]})),
            {8: ["真爱"]},
        )

    def test_fetch_alias_map_unions_lxns_and_yuzuchan(self) -> None:
        lxns = json.dumps({"aliases": [{"song_id": 100, "aliases": ["告诉你的世界"]}]})
        yuzu = json.dumps(
            {"content": [{"SongID": 100, "Alias": ["告诉你的世界", "Tell Your World", "tyw"]}]}
        )

        def fetch(url: str) -> str:
            return yuzu if "yuzuchan" in url else lxns

        merged = fetch_alias_map(fetch)
        # Unioned, lxns first, yuzuchan extras appended, case-insensitive dedup of
        # the shared "告诉你的世界".
        self.assertEqual(merged, {100: ["告诉你的世界", "Tell Your World", "tyw"]})

    def test_fetch_alias_map_survives_one_failing_source(self) -> None:
        def fetch(url: str) -> str:
            if "yuzuchan" in url:
                raise URLError("yuzuchan down")
            return json.dumps({"aliases": [{"song_id": 8, "aliases": ["真爱"]}]})

        # lxns still contributes even though yuzuchan errored.
        self.assertEqual(fetch_alias_map(fetch), {8: ["真爱"]})


if __name__ == "__main__":
    unittest.main()
