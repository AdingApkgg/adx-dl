import json
import ssl
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import URLError

from tools.build_catalog import build_catalog
from tools.remote_catalog import (
    fetch_text,
    parse_remote_directory_files,
    parse_remote_root_directories,
)


class BuildCatalogTests(unittest.TestCase):
    def test_parse_remote_root_directories_extracts_direct_children(self) -> None:
        html = """
        <html>
          <body>
            <a href="../">Parent directory</a>
            <a href="39%20%5BDX%5D/">39 [DX]/</a>
            <a href="?sort=name&order=asc">Name</a>
            <a href="nested/path/">nested/path/</a>
            <a href="39%20%5BDX%5D/">39 [DX]/</a>
          </body>
        </html>
        """

        directories = parse_remote_root_directories(html, "https://adx-dl.larx.cc/")

        self.assertEqual(
            directories,
            [
                {
                    "name": "39 [DX]",
                    "url": "https://adx-dl.larx.cc/39%20%5BDX%5D/",
                }
            ],
        )

    def test_parse_remote_directory_files_extracts_file_rows(self) -> None:
        html = """
        <table>
          <tr>
            <td><a href="../">Parent directory</a></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td><a href="bg.png">bg.png</a></td>
            <td>246.7 KiB</td>
            <td>2026-06-13 05:25:42 +08:00</td>
          </tr>
          <tr>
            <td><a href="maidata.txt">maidata.txt</a></td>
            <td>6.9 KiB</td>
            <td>2026-06-13 05:25:42 +08:00</td>
          </tr>
          <tr>
            <td><a href="nested/">nested/</a></td>
            <td></td>
            <td></td>
          </tr>
        </table>
        """

        files = parse_remote_directory_files(
            html,
            "https://adx-dl.larx.cc/39%20%5BDX%5D/",
        )

        self.assertEqual([file["name"] for file in files], ["bg.png", "maidata.txt"])
        self.assertEqual(files[0]["url"], "https://adx-dl.larx.cc/39%20%5BDX%5D/bg.png")
        self.assertEqual(files[0]["size_label"], "246.7 KiB")
        self.assertEqual(files[0]["modified_at"], "2026-06-13 05:25:42 +08:00")

    def test_build_catalog_scans_remote_directories_and_builds_entries(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            payloads = {
                "https://adx-dl.larx.cc/": """
                <table>
                  <tr>
                    <td><a href="39%20%5BDX%5D/">39 [DX]/</a></td>
                    <td></td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                </table>
                """,
                "https://adx-dl.larx.cc/39%20%5BDX%5D/": """
                <table>
                  <tr>
                    <td><a href="bg.png">bg.png</a></td>
                    <td>246.7 KiB</td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                  <tr>
                    <td><a href="maidata.txt">maidata.txt</a></td>
                    <td>6.9 KiB</td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                  <tr>
                    <td><a href="track.mp3">track.mp3</a></td>
                    <td>2.7 MiB</td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                </table>
                """,
                "https://adx-dl.larx.cc/39%20%5BDX%5D/maidata.txt": """
                &title=39 [DX]
                &artist=sasakure.UK x DECO*27
                &wholebpm=175
                &shortid=10146
                &genre=niconicoボーカロイド
                &cabinet=DX
                &version=maimai DX
                &lv_5=12+
                &des_5=Jack
                &inote_5=(175){4},1,2,3,4
                """,
            }

            catalog_path = build_catalog(root, fetch_text=payloads.__getitem__)
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            entry = catalog["entries"][0]

            self.assertEqual(catalog["total_entries"], 1)
            self.assertEqual(catalog["categories"]["Remote"], ["maimai DX"])
            self.assertEqual(entry["title"], "39 [DX]")
            self.assertEqual(entry["artist"], "sasakure.UK x DECO*27")
            self.assertEqual(entry["remote_dir_name"], "39 [DX]")
            self.assertEqual(
                entry["files"]["maidata"],
                "https://adx-dl.larx.cc/39%20%5BDX%5D/maidata.txt",
            )
            self.assertEqual(
                entry["media"]["cover_url"],
                "https://adx-dl.larx.cc/39%20%5BDX%5D/bg.png",
            )
            self.assertEqual(
                entry["media"]["audio_url"],
                "https://adx-dl.larx.cc/39%20%5BDX%5D/track.mp3",
            )
            self.assertEqual(entry["download_mode"], "onsite")
            self.assertEqual(entry["license_note"], "Built from remote directory listing")

    def test_build_catalog_skips_directories_without_maidata(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            payloads = {
                "https://adx-dl.larx.cc/": """
                <table>
                  <tr>
                    <td><a href="empty/">empty/</a></td>
                    <td></td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                </table>
                """,
                "https://adx-dl.larx.cc/empty/": """
                <table>
                  <tr>
                    <td><a href="bg.png">bg.png</a></td>
                    <td>246.7 KiB</td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                </table>
                """,
            }

            catalog_path = build_catalog(root, fetch_text=payloads.__getitem__)
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

            self.assertEqual(catalog["total_entries"], 0)
            self.assertEqual(catalog["entries"], [])

    def test_build_catalog_uses_maidata_dx_when_plain_maidata_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            payloads = {
                "https://adx-dl.larx.cc/": """
                <table>
                  <tr>
                    <td><a href="dx-only/">dx-only/</a></td>
                    <td></td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                </table>
                """,
                "https://adx-dl.larx.cc/dx-only/": """
                <table>
                  <tr>
                    <td><a href="maidata_dx.txt">maidata_dx.txt</a></td>
                    <td>6.9 KiB</td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                  <tr>
                    <td><a href="track.mp3">track.mp3</a></td>
                    <td>2.7 MiB</td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                </table>
                """,
                "https://adx-dl.larx.cc/dx-only/maidata_dx.txt": """
                &title=DX Only
                &artist=Remote Artist
                &version=maimai DX PRiSM
                &shortid=620
                &lv_5=13+
                &des_5=Charter
                &inote_5=(225){4},1,2,3,4
                """,
            }

            catalog_path = build_catalog(root, fetch_text=payloads.__getitem__)
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            entry = catalog["entries"][0]

            self.assertEqual(
                entry["files"]["maidata_dx"],
                "https://adx-dl.larx.cc/dx-only/maidata_dx.txt",
            )
            self.assertEqual(entry["files"]["maidata"], "")
            self.assertTrue(entry["assets"]["has_dx_chart"])
            self.assertEqual(entry["subcategory"], "maimai DX PRiSM")

    def test_build_catalog_sets_remote_media_urls_without_copying_assets(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            payloads = {
                "https://adx-dl.larx.cc/": """
                <table>
                  <tr>
                    <td><a href="39%20%5BDX%5D/">39 [DX]/</a></td>
                    <td></td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                </table>
                """,
                "https://adx-dl.larx.cc/39%20%5BDX%5D/": """
                <table>
                  <tr>
                    <td><a href="bg.png">bg.png</a></td>
                    <td>246.7 KiB</td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                  <tr>
                    <td><a href="maidata.txt">maidata.txt</a></td>
                    <td>6.9 KiB</td>
                    <td>2026-06-13 05:25:42 +08:00</td>
                  </tr>
                </table>
                """,
                "https://adx-dl.larx.cc/39%20%5BDX%5D/maidata.txt": """
                &title=39 [DX]
                &artist=Artist
                &version=maimai DX
                &lv_5=12+
                &des_5=Jack
                &inote_5=(175){4},1,2,3,4
                """,
            }

            catalog_path = build_catalog(root, fetch_text=payloads.__getitem__)
            entry = json.loads(catalog_path.read_text(encoding="utf-8"))["entries"][0]

            self.assertEqual(
                entry["media"]["cover_url"],
                "https://adx-dl.larx.cc/39%20%5BDX%5D/bg.png",
            )
            self.assertFalse((root / "site" / "public" / "catalog-assets").exists())

    def test_build_catalog_parallel_fetch_keeps_entries_in_stable_order(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            payloads = {
                "https://adx-dl.larx.cc/": """
                <table>
                  <tr><td><a href="b/">b/</a></td><td></td><td>2026-06-13 05:25:42 +08:00</td></tr>
                  <tr><td><a href="a/">a/</a></td><td></td><td>2026-06-13 05:25:42 +08:00</td></tr>
                </table>
                """,
                "https://adx-dl.larx.cc/a/": """
                <table>
                  <tr><td><a href="maidata.txt">maidata.txt</a></td><td>6.9 KiB</td><td>2026-06-13 05:25:42 +08:00</td></tr>
                </table>
                """,
                "https://adx-dl.larx.cc/b/": """
                <table>
                  <tr><td><a href="maidata.txt">maidata.txt</a></td><td>6.9 KiB</td><td>2026-06-13 05:25:42 +08:00</td></tr>
                </table>
                """,
                "https://adx-dl.larx.cc/a/maidata.txt": """
                &title=A Song
                &artist=Artist A
                &version=maimai DX
                &shortid=1
                &lv_5=12+
                &des_5=Jack
                &inote_5=(175){4},1,2,3,4
                """,
                "https://adx-dl.larx.cc/b/maidata.txt": """
                &title=B Song
                &artist=Artist B
                &version=maimai DX
                &shortid=2
                &lv_5=12+
                &des_5=Jack
                &inote_5=(175){4},1,2,3,4
                """,
            }

            def fake_fetch(url: str) -> str:
                if url.endswith("/a/maidata.txt"):
                    time.sleep(0.02)
                return payloads[url]

            catalog_path = build_catalog(root, fetch_text=fake_fetch, max_workers=2)
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

            self.assertEqual([entry["id"] for entry in catalog["entries"]], ["1-a", "2-b"])

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
