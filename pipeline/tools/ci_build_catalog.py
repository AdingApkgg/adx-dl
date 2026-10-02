"""CI entry point for the catalog build.

The catalog is rebuilt from the origin index (``INDEX_URL``) on alice, a single
home server. When alice is offline the build cannot reach it, and before this
existed every publish, scheduled rebuild and push check failed at "Build
catalog" until someone could power-cycle the box (it happened on 2026-09-29 and
again for days around 2026-10-02).

The committed ``data/catalog/index.json`` is always a complete, enriched catalog
(charts are only ever added together with a committed rebuild), so publishing
it is safe. This falls back to it only on network failures, with a GitHub
warning annotation so the run says what happened. Any other error — a bad
maidata, a code bug — still fails the job.

Run from ``pipeline/``: ``python3 -m tools.ci_build_catalog``.
"""

from __future__ import annotations

import http.client
import ssl
import subprocess
import sys
from pathlib import Path
from urllib.error import URLError

from tools.build_catalog import build_catalog

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "data" / "catalog" / "index.json"

ORIGIN_UNREACHABLE = (URLError, http.client.HTTPException, ConnectionError, TimeoutError, ssl.SSLError)


def main(build=build_catalog, restore=None) -> int:
    try:
        print(build(ROOT, max_workers=16))
    except ORIGIN_UNREACHABLE as error:
        # build_catalog only writes at the very end, but restore anyway so a
        # half-written file can never be published.
        (restore or _restore_committed_catalog)()
        print(
            "::warning title=Catalog origin unreachable::"
            f"{type(error).__name__}: {error}. "
            "Publishing the committed data/catalog/index.json instead."
        )
    return 0


def _restore_committed_catalog() -> None:
    subprocess.run(["git", "checkout", "--", str(CATALOG)], cwd=ROOT, check=True)


if __name__ == "__main__":
    sys.exit(main())
