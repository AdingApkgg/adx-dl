from __future__ import annotations

import http.client
import re
import ssl
import time
from html import unescape
from typing import Callable, TypedDict, TypeVar
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import Request, urlopen

_T = TypeVar("_T")

# The remote index/mirror is occasionally flaky; retry transient failures
# (read timeouts, dropped connections, 5xx/429) with exponential backoff so a
# single blip doesn't fail the whole catalog build. Permanent failures (404,
# certificate verification) are not retried.
_MAX_ATTEMPTS = 3
_RETRY_BACKOFF = 1.5  # seconds; doubles each retry (1.5s, then 3.0s)
_RETRYABLE_HTTP_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


def _is_retryable(error: Exception) -> bool:
    if isinstance(error, HTTPError):
        return error.code in _RETRYABLE_HTTP_STATUS
    if isinstance(error, ssl.SSLCertVerificationError):
        return False  # handled by the unverified-context fallback, never by retry
    if isinstance(error, URLError):
        return not isinstance(error.reason, ssl.SSLCertVerificationError)
    return isinstance(
        error,
        (TimeoutError, ConnectionError, ssl.SSLError, http.client.HTTPException),
    )


def _with_retry(attempt: Callable[[], _T], url: str) -> _T:
    for attempt_number in range(1, _MAX_ATTEMPTS + 1):
        try:
            return attempt()
        except Exception as error:
            if attempt_number >= _MAX_ATTEMPTS or not _is_retryable(error):
                raise
            delay = _RETRY_BACKOFF * (2 ** (attempt_number - 1))
            print(
                f"[remote_catalog] {type(error).__name__} fetching {url!r}; "
                f"retrying in {delay:.1f}s ({attempt_number}/{_MAX_ATTEMPTS - 1})",
                flush=True,
            )
            time.sleep(delay)
    raise AssertionError("unreachable")  # pragma: no cover


class RemoteDirectory(TypedDict):
    name: str
    url: str


class RemoteFile(TypedDict):
    name: str
    url: str
    size_label: str
    modified_at: str


_ROW_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_CELL_RE = re.compile(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", re.IGNORECASE | re.DOTALL)
_LINK_RE = re.compile(
    r"""<a\b[^>]*href\s*=\s*(['"])(.*?)\1[^>]*>(.*?)</a>""",
    re.IGNORECASE | re.DOTALL,
)
_TAG_RE = re.compile(r"<[^>]+>")


def fetch_text(url: str) -> str:
    def attempt() -> str:
        request = Request(url, headers={"User-Agent": "AstroDX catalog builder"})
        try:
            with urlopen(request, timeout=20) as response:
                return response.read().decode("utf-8", errors="replace")
        except ssl.SSLCertVerificationError:
            insecure_context = ssl._create_unverified_context()
            with urlopen(request, context=insecure_context, timeout=20) as response:
                return response.read().decode("utf-8", errors="replace")
        except URLError as error:
            if isinstance(error.reason, ssl.SSLCertVerificationError):
                insecure_context = ssl._create_unverified_context()
                with urlopen(request, context=insecure_context, timeout=20) as response:
                    return response.read().decode("utf-8", errors="replace")
            raise

    return _with_retry(attempt, url)


def fetch_bytes(url: str, timeout: int = 60) -> bytes:
    """Download a remote file as raw bytes, with the same SSL fallback and
    transient-failure retry as fetch_text."""

    def attempt() -> bytes:
        request = Request(url, headers={"User-Agent": "AstroDX catalog builder"})
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except ssl.SSLCertVerificationError:
            insecure_context = ssl._create_unverified_context()
            with urlopen(request, context=insecure_context, timeout=timeout) as response:
                return response.read()
        except URLError as error:
            if isinstance(error.reason, ssl.SSLCertVerificationError):
                insecure_context = ssl._create_unverified_context()
                with urlopen(
                    request, context=insecure_context, timeout=timeout
                ) as response:
                    return response.read()
            raise

    return _with_retry(attempt, url)


def _clean_text(value: str) -> str:
    return " ".join(unescape(_TAG_RE.sub(" ", value)).split())


def parse_remote_root_directories(html: str, root_url: str) -> list[RemoteDirectory]:
    directories: list[RemoteDirectory] = []
    seen: set[str] = set()
    root_path = urlparse(root_url).path

    for _, href, raw_text in _LINK_RE.findall(html):
        label = _clean_text(raw_text)
        if not href or href.startswith("?") or "parent directory" in label.lower():
            continue
        if not href.endswith("/"):
            continue

        absolute_url = urljoin(root_url, href)
        relative_path = urlparse(absolute_url).path[len(root_path) :].strip("/")
        if not relative_path or "/" in relative_path:
            continue

        directory_name = unquote(relative_path)
        if directory_name in seen:
            continue

        seen.add(directory_name)
        directories.append({"name": directory_name, "url": absolute_url})

    return directories


def parse_remote_directory_files(html: str, directory_url: str) -> list[RemoteFile]:
    files: list[RemoteFile] = []
    seen: set[str] = set()
    directory_path = urlparse(directory_url).path

    for row_html in _ROW_RE.findall(html):
        cells = _CELL_RE.findall(row_html)
        if not cells:
            continue

        link_match = _LINK_RE.search(cells[0])
        if link_match is None:
            continue

        href = link_match.group(2)
        label = _clean_text(link_match.group(3))
        if not href or href.startswith("?") or "parent directory" in label.lower():
            continue
        if href.endswith("/"):
            continue

        absolute_url = urljoin(directory_url, href)
        relative_path = urlparse(absolute_url).path[len(directory_path) :].strip("/")
        if not relative_path or "/" in relative_path:
            continue

        file_name = unquote(relative_path)
        if file_name in seen:
            continue

        seen.add(file_name)
        size_label = _clean_text(cells[1]) if len(cells) > 1 else ""
        modified_at = _clean_text(cells[2]) if len(cells) > 2 else ""
        files.append(
            {
                "name": file_name,
                "url": absolute_url,
                "size_label": size_label,
                "modified_at": modified_at,
            }
        )

    return files
