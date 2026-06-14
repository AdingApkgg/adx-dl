import json
import ssl
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import URLError
from urllib.parse import quote

from tools.build_catalog import MEDIA_BASE, build_catalog
from tools.remote_catalog import fetch_text


def _media_url(relative_path: str) -> str:
    return MEDIA_BASE + quote(relative_path, safe="/")


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
            "path": "でらっくす PLUS/[DX] コネクト",
            "files": {
                "maidata": "でらっくす PLUS/[DX] コネクト/maidata.txt",
                "audio": "でらっくす PLUS/[DX] コネクト/track.mp3",
                "bg": "でらっくす PLUS/[DX] コネクト/bg.png",
                "pv": "でらっくす PLUS/[DX] コネクト/pv.mp4",
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
            "shortid": "",
            "version": "FiNALE",
            "versionid": 12,
            "genre": "",
            "bpm": None,
            "first": 0,
            "path": "FiNALE/[ST] Bare Song",
            "files": {
                "maidata": "FiNALE/[ST] Bare Song/maidata.txt",
                "audio": "FiNALE/[ST] Bare Song/track.mp3",
                "bg": "FiNALE/[ST] Bare Song/bg.png",
                "pv": "",
            },
            "difficulties": [
                {"slot": 3, "name": "Advanced", "level": "7.0", "designer": None, "has_notes": True},
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
        # Entries are sorted by id: "10146" (CJK stripped) < "bare-song".
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
            _media_url("でらっくす PLUS/[DX] コネクト/maidata.txt"),
        )
        self.assertEqual(
            konekto["media"]["cover_url"],
            _media_url("でらっくす PLUS/[DX] コネクト/bg.png"),
        )
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
        self.assertEqual(bare["cabinet"], "ST")
        self.assertEqual(bare["short_id"], "")
        self.assertEqual(bare["files"]["pv"], "")
        self.assertEqual(bare["media"]["pv_url"], "")
        self.assertFalse(bare["assets"]["has_pv"])
        self.assertFalse(bare["assets"]["has_dx_chart"])
        self.assertEqual(bare["download_mode"], "onsite")

    def test_catalog_categories_list_distinct_versions(self) -> None:
        catalog = self._build()
        self.assertEqual(
            catalog["categories"]["Remote"], ["maimai DX PLUS", "maimai FiNALE"]
        )

    def test_downloads_cover_images_to_local_paths(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            media_root = root / "media"
            catalog_path = build_catalog(
                root,
                fetch_text=lambda _url: SAMPLE_INDEX,
                fetch_bytes=lambda _url: b"PNGDATA",
                download_media=True,
                media_root=media_root,
            )
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

            konekto = catalog["entries"][0]  # slug "10146"
            # Flat path: one file per chart, no per-chart subdirectory.
            self.assertEqual(konekto["media"]["cover_url"], "/covers/10146.png")
            self.assertEqual(konekto["files"]["background"], "/covers/10146.png")
            # Only images are mirrored — audio/PV stay remote.
            self.assertEqual(
                konekto["media"]["audio_url"],
                _media_url("でらっくす PLUS/[DX] コネクト/track.mp3"),
            )
            saved = media_root / "10146.png"
            self.assertTrue(saved.exists())
            self.assertEqual(saved.read_bytes(), b"PNGDATA")

    def test_keeps_remote_cover_url_when_download_fails(self) -> None:
        def boom(_url: str) -> bytes:
            raise RuntimeError("network down")

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            catalog_path = build_catalog(
                root,
                fetch_text=lambda _url: SAMPLE_INDEX,
                fetch_bytes=boom,
                download_media=True,
                media_root=root / "media",
            )
            konekto = json.loads(catalog_path.read_text(encoding="utf-8"))["entries"][0]

        # A failed download leaves the remote URL in place as a fallback.
        self.assertEqual(
            konekto["media"]["cover_url"],
            _media_url("でらっくす PLUS/[DX] コネクト/bg.png"),
        )

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
            self.assertEqual(fetch_text("https://adx-dl.larx.cc/"), "ok")

        self.assertIsNone(calls[0])
        self.assertIsNotNone(calls[1])


if __name__ == "__main__":
    unittest.main()
