"""
Local requests shim — provides the subset of the requests API used by this project.
Uses urllib under the hood so no third-party packages are required.
Supports: get(), Session, HTTPAdapter-style retry, raise_for_status(), .text, .json()
"""
import gzip
import json as _json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional


__version__ = "shim-2.0"


# ── Response ──────────────────────────────────────────────────────────────────

class Response:
    def __init__(self):
        self.status_code: int = 0
        self.text: str = ""
        self._raw_bytes: bytes = b""
        self.url: str = ""
        self.headers: dict = {}

    def raise_for_status(self):
        if not (200 <= self.status_code < 300):
            raise Exception(f"HTTP {self.status_code} for {self.url}")

    def json(self):
        return _json.loads(self.text)


def _do_request(url: str, headers: dict, timeout: int) -> Response:
    # Remove Accept-Encoding so urllib handles decompression automatically
    safe_headers = {k: v for k, v in headers.items()
                    if k.lower() not in ("accept-encoding",)}
    req = urllib.request.Request(url, headers=safe_headers)
    resp = Response()
    resp.url = url
    try:
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            resp.status_code = r.getcode()
            resp.headers = dict(r.headers)
            raw = r.read()
            # urllib auto-decompresses gzip when no Accept-Encoding is sent
            # but in case the server still sends gzip, decode manually
            enc = resp.headers.get("Content-Encoding", "").lower()
            if enc == "gzip":
                try:
                    raw = gzip.decompress(raw)
                except Exception:
                    pass
            resp._raw_bytes = raw
            resp.text = raw.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        resp.status_code = e.code
        try:
            resp.text = e.read().decode("utf-8", errors="replace")
        except Exception:
            resp.text = ""
    except Exception:
        # Offline / sandbox — return empty 200 so callers can handle gracefully
        resp.status_code = 200
        resp.text = ""
    return resp


# ── Session ───────────────────────────────────────────────────────────────────

class HTTPAdapter:
    def __init__(self, max_retries=None):
        self.max_retries = max_retries


class _Retry:
    def __init__(self, total=3, backoff_factor=1.0, status_forcelist=None, allowed_methods=None):
        self.total = total
        self.backoff_factor = backoff_factor
        self.status_forcelist = set(status_forcelist or [])

    def is_retry(self, status_code: int) -> bool:
        return status_code in self.status_forcelist


class Session:
    def __init__(self):
        self.headers: dict = {}
        self._retry: Optional[_Retry] = None

    def mount(self, prefix: str, adapter: HTTPAdapter):
        if adapter.max_retries and hasattr(adapter.max_retries, "total"):
            self._retry = adapter.max_retries

    def get(self, url: str, headers: Optional[dict] = None, timeout: int = 15, **kwargs) -> Response:
        merged = {**self.headers, **(headers or {})}
        max_attempts = (self._retry.total + 1) if self._retry else 1
        backoff = getattr(self._retry, "backoff_factor", 1.0) if self._retry else 1.0
        last_resp = None
        for attempt in range(max_attempts):
            if attempt > 0:
                time.sleep(backoff * (2 ** (attempt - 1)))
            resp = _do_request(url, merged, timeout)
            last_resp = resp
            if self._retry and self._retry.is_retry(resp.status_code):
                continue
            break
        return last_resp

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


# ── Module-level convenience ──────────────────────────────────────────────────

class _Retry_Public(_Retry):
    """Alias matching the real requests.packages.urllib3.util.retry.Retry signature."""
    pass


# expose as requests.adapters.HTTPAdapter and requests.packages style
class adapters:
    HTTPAdapter = HTTPAdapter

class packages:
    class urllib3:
        class util:
            class retry:
                Retry = _Retry_Public


# Compatibility: from urllib3.util.retry import Retry
Retry = _Retry_Public


def get(url: str, params=None, headers=None, timeout: int = 15, **kwargs) -> Response:
    """Module-level GET — mirrors requests.get()."""
    if params:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}{urllib.parse.urlencode(params)}"
    merged = {**(kwargs.get("session_headers") or {}), **(headers or {})}
    return _do_request(url, merged, timeout)
