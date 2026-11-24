import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import URLError

from tools.catalog_areas import refresh_area_snapshot


class CatalogAreaSnapshotTests(unittest.TestCase):
    def test_last_successful_snapshot_survives_fetch_and_payload_failures(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / "snapshot.json"
            songs = [{
                "id": 1875,
                "map": "Phigros区域",
                "difficulties": {"standard": [], "dx": [{}]},
            }]
            self.assertTrue(refresh_area_snapshot(target, lambda _: json.dumps({"songs": songs})))
            self.assertEqual(json.loads(target.read_text())["areas"], {"11875": "Phigros区域"})
            snapshot = target.read_bytes()

            def offline(_url):
                raise URLError("offline")

            for fetch in (offline, lambda _: '{"songs":[]}', lambda _: "{broken"):
                with self.subTest(fetch=fetch):
                    self.assertFalse(refresh_area_snapshot(target, fetch))
                    self.assertEqual(target.read_bytes(), snapshot)

            refresh_area_snapshot(target, lambda _: '{"songs":[{"id":1875}]}')
            self.assertEqual(target.read_bytes(), snapshot)
