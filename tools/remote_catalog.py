from __future__ import annotations

import re
import ssl
from html import unescape
from typing import TypedDict
from urllib.error import URLError
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import Request, urlopen


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
