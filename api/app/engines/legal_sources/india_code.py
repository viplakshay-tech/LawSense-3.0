"""Bounded, explicit client for the free third-party IndiaCode/eCourtsIndia API.

This adapter only retrieves data when called directly. Case narratives are not
sent automatically. Returned material is always marked unverified: API
availability is not proof that legislation is authentic, current, or in force.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import time
from threading import Lock
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen


API_BASE_URL = "https://indiacode.ecourtsindia.com/api/v1"
OFFICIAL_VERIFICATION_PORTALS = (
    "https://www.indiacode.gov.in/",
    "https://egazette.gov.in/",
)
VERIFICATION_NOTE = (
    "This is a free third-party IndiaCode/eCourtsIndia API result. Retrieval does not verify "
    "authenticity, amendments, commencement, current force, or applicability. Check the "
    "official India Code or Gazette of India publication."
)
_MAX_RESPONSE_BYTES = 2_000_000
_CACHE_TTL_SECONDS = 300
_CACHE_LIMIT = 64


class IndiaCodeApiError(RuntimeError):
    """A bounded API request failed or returned unusable data."""


@dataclass(frozen=True, slots=True)
class RetrievedIndiaCodeData:
    """Raw provider response plus retrieval facts; no verification is inferred."""

    endpoint: str
    retrieved_at: datetime
    payload: dict[str, Any]
    provider_name: str = "IndiaCode/eCourtsIndia (third-party API)"
    verification_status: str = "unverified"
    verification_note: str = VERIFICATION_NOTE
    official_verification_portals: tuple[str, ...] = OFFICIAL_VERIFICATION_PORTALS


def jurisdiction_scope(value: object) -> str:
    """Map only explicit provider labels; unknown input remains unknown."""

    label = str(value or "").strip().casefold().replace("/", "_").replace(" ", "_")
    if label in {"central", "union", "national", "central_government", "central_act"}:
        return "central"
    if label in {"state", "ut", "state_ut", "state_or_ut", "state_union_territory"}:
        return "state_or_ut"
    return "unknown"


def official_url(value: object) -> str | None:
    """Return a URL only when it explicitly points at a known official portal."""

    if not isinstance(value, str) or not value.strip():
        return None
    parsed = urlsplit(value.strip())
    host = (parsed.hostname or "").casefold().removeprefix("www.")
    if parsed.scheme not in {"http", "https"} or host not in {
        "indiacode.gov.in",
        "indiacode.nic.in",
        "egazette.gov.in",
        "egazette.nic.in",
    }:
        return None
    return value.strip()


class IndiaCodeApiAdapter:
    """Small TTL-cached client for search, acts, and exact provisions.

    ``urlopen`` is injectable to keep tests deterministic. Request paths and
    response sizes are bounded; callers supply only narrow lookup terms.
    """

    def __init__(
        self,
        *,
        timeout_seconds: float = 4.0,
        max_response_bytes: int = _MAX_RESPONSE_BYTES,
        cache_ttl_seconds: float = _CACHE_TTL_SECONDS,
        opener: Callable[..., Any] | None = None,
    ) -> None:
        if not 0 < timeout_seconds <= 10:
            raise ValueError("timeout_seconds must be between 0 and 10")
        if not 1 <= max_response_bytes <= _MAX_RESPONSE_BYTES:
            raise ValueError("max_response_bytes must be between 1 and 2000000")
        self.timeout_seconds = timeout_seconds
        self.max_response_bytes = max_response_bytes
        self.cache_ttl_seconds = max(0, cache_ttl_seconds)
        self._opener = opener or urlopen
        self._cache: dict[str, tuple[float, dict[str, Any], datetime]] = {}
        self._lock = Lock()

    def search(self, query: str, *, limit: int = 20) -> RetrievedIndiaCodeData:
        cleaned = _clean_query(query)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 100:
            raise ValueError("limit must be between 1 and 100")
        return self._get("/search", {"q": cleaned, "limit": limit})

    def acts(self) -> RetrievedIndiaCodeData:
        return self._get("/acts", {})

    def provision(self, act_id: str, unit: str, number: str) -> RetrievedIndiaCodeData:
        act = _clean_path_part(act_id, "act_id")
        normalized_unit = str(unit or "").strip().casefold()
        if normalized_unit not in {"section", "article", "rule"}:
            raise ValueError("unit must be section, article, or rule")
        provision_number = _clean_path_part(number, "number")
        return self._get(
            f"/{quote(act, safe='')}/{normalized_unit}/{quote(provision_number, safe='')}",
            {},
        )

    def _get(self, path: str, params: dict[str, object]) -> RetrievedIndiaCodeData:
        query_string = urlencode(params)
        endpoint = f"{API_BASE_URL}{path}" + (f"?{query_string}" if query_string else "")
        now = time.monotonic()
        with self._lock:
            cached = self._cache.get(endpoint)
            if cached and now - cached[0] < self.cache_ttl_seconds:
                payload, fetched_at = cached[1], cached[2]
                return RetrievedIndiaCodeData(endpoint=endpoint, retrieved_at=fetched_at, payload=payload)

        request = Request(
            endpoint,
            headers={
                "Accept": "application/json",
                "User-Agent": "LawSense/3.0 (local legal-source lookup)",
            },
            method="GET",
        )
        try:
            with self._opener(request, timeout=self.timeout_seconds) as response:
                body = response.read(self.max_response_bytes + 1)
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            raise IndiaCodeApiError("IndiaCode/eCourtsIndia could not be reached.") from exc
        if len(body) > self.max_response_bytes:
            raise IndiaCodeApiError("IndiaCode/eCourtsIndia response exceeded the size limit.")
        try:
            decoded = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise IndiaCodeApiError("IndiaCode/eCourtsIndia returned invalid JSON.") from exc
        if not isinstance(decoded, dict):
            raise IndiaCodeApiError("IndiaCode/eCourtsIndia returned an unexpected response shape.")

        fetched_at = datetime.now(timezone.utc)
        with self._lock:
            if len(self._cache) >= _CACHE_LIMIT:
                oldest = min(self._cache, key=lambda key: self._cache[key][0])
                self._cache.pop(oldest, None)
            self._cache[endpoint] = (time.monotonic(), decoded, fetched_at)
        return RetrievedIndiaCodeData(endpoint=endpoint, retrieved_at=fetched_at, payload=decoded)


def _clean_query(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("query is required")
    cleaned = " ".join(value.split())
    if not cleaned or len(cleaned) > 200:
        raise ValueError("query must contain 1 to 200 characters")
    return cleaned


def _clean_path_part(value: str, name: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned or len(cleaned) > 100 or cleaned in {".", ".."}:
        raise ValueError(f"{name} must contain 1 to 100 characters")
    if any(char in cleaned for char in ("/", "\\", "?", "#")):
        raise ValueError(f"{name} contains an invalid character")
    return cleaned
