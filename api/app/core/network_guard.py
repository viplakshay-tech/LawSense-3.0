"""Default-deny API boundary for a personal local-first deployment.

The Next.js frontend proxies requests to FastAPI over loopback. This layer
reduces accidental LAN/public exposure and rejects unexpected Host/Origin
values (including common DNS-rebinding/cross-site browser attempts). It is not
user authentication, case ownership authorization, or a defense against other
software running on the same machine.
"""

from __future__ import annotations

import ipaddress
import os
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


_REMOTE_ACCESS_ENV = "LAWSENSE_ALLOW_REMOTE_API"
_ALLOWED_HOSTS_ENV = "LAWSENSE_ALLOWED_API_HOSTS"
_ALLOWED_ORIGINS_ENV = "LAWSENSE_ALLOWED_API_ORIGINS"
_TEST_CLIENT_NAMES = frozenset({"testclient", "testserver"})

_DEFAULT_HOSTS = frozenset({
    "localhost",
    "localhost:3000",
    "localhost:8000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "127.0.0.1:8000",
    "[::1]",
    "[::1]:3000",
    "[::1]:8000",
    "testserver",
    "testserver:80",
})

_DEFAULT_ORIGINS = frozenset({
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://localhost",
})


def _remote_access_enabled() -> bool:
    return os.getenv(_REMOTE_ACCESS_ENV, "").strip().casefold() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _normalise_host(value: str) -> str:
    candidate = value.strip().casefold()
    if not candidate:
        return ""
    try:
        parsed = urlsplit("//" + candidate)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return ""
    if not hostname:
        return ""
    hostname = hostname.rstrip(".")
    try:
        parsed_ip = ipaddress.ip_address(hostname.split("%", maxsplit=1)[0])
    except ValueError:
        parsed_ip = None
    if isinstance(parsed_ip, ipaddress.IPv6Address):
        host = f"[{hostname}]"
    else:
        host = hostname
    return f"{host}:{port}" if port is not None else host


def _allowed_hosts() -> frozenset[str]:
    configured = {
        _normalise_host(item)
        for item in os.getenv(_ALLOWED_HOSTS_ENV, "").split(",")
        if item.strip()
    }
    return frozenset(_DEFAULT_HOSTS | configured)


def _normalise_origin(value: str) -> str | None:
    candidate = value.strip()
    if not candidate or candidate.casefold() == "null":
        return None
    try:
        parsed = urlsplit(candidate)
        if (
            parsed.scheme.casefold() not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            return None
        host = _normalise_host(
            f"[{parsed.hostname}]:{parsed.port}"
            if ":" in parsed.hostname and parsed.port is not None
            else f"[{parsed.hostname}]"
            if ":" in parsed.hostname
            else f"{parsed.hostname}:{parsed.port}"
            if parsed.port is not None
            else parsed.hostname
        )
    except ValueError:
        return None
    return f"{parsed.scheme.casefold()}://{host}" if host else None


def _host_is_allowed(host_value: str) -> bool:
    normalized = _normalise_host(host_value)
    if normalized in _allowed_hosts():
        return True

    # Next.js may preserve the LAN Host header when proxying an Android WebView
    # request. Permit only a private, non-loopback IP on the documented UI port.
    try:
        parsed = urlsplit("//" + normalized)
        if not parsed.hostname or parsed.port != 3000:
            return False
        address = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        return False
    return address.is_private and not address.is_loopback and not address.is_link_local


def _allowed_origins() -> frozenset[str]:
    configured = {
        normalized
        for item in os.getenv(_ALLOWED_ORIGINS_ENV, "").split(",")
        if (normalized := _normalise_origin(item))
    }
    defaults = {
        normalized
        for item in _DEFAULT_ORIGINS
        if (normalized := _normalise_origin(item))
    }
    return frozenset(defaults | configured)


def _origin_is_allowed(origin: str) -> bool:
    normalized = _normalise_origin(origin)
    if normalized is None:
        return False
    if normalized in _allowed_origins():
        return True

    # The Android shell serves the Next.js UI from a trusted local HTTPS
    # endpoint such as https://192.168.1.25:3000. Keep that limited to private
    # IPs on the documented UI port; local hostnames can be explicitly listed
    # in LAWSENSE_ALLOWED_API_ORIGINS when the installation requires them.
    parsed = urlsplit(normalized)
    if parsed.scheme != "https" or parsed.port != 3000 or not parsed.hostname:
        return False
    try:
        address = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        return False
    return address.is_private and not address.is_loopback and not address.is_link_local


def _is_loopback(host: str) -> bool:
    # Starlette's in-process test clients use synthetic peer names that are
    # not taken from request headers.
    if host.casefold() in _TEST_CLIENT_NAMES:
        return True

    candidate = host.split("%", maxsplit=1)[0]
    try:
        address = ipaddress.ip_address(candidate)
    except ValueError:
        return False

    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        return address.ipv4_mapped.is_loopback
    return address.is_loopback


class LocalOnlyApiMiddleware:
    """Reject unexpected hosts/origins and remote peers by default.

    Remote access requires an explicit operator opt-in, and even then host
    and origin allowlists remain enforced. These checks are not authentication.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_no_store(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"cache-control"
                ]
                headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        headers = Headers(scope=scope)
        host_value = headers.get("host", "")
        if not _host_is_allowed(host_value):
            response = JSONResponse(
                status_code=403,
                content={"detail": "The LawSense API rejected this Host header."},
                headers={"Cache-Control": "no-store"},
            )
            await response(scope, receive, send_no_store)
            return

        origin = headers.get("origin")
        if origin is not None and not _origin_is_allowed(origin):
            response = JSONResponse(
                status_code=403,
                content={
                    "detail": (
                        "The LawSense API rejected this browser Origin. Configure "
                        "LAWSENSE_ALLOWED_API_ORIGINS only for a trusted frontend origin."
                    )
                },
                headers={"Cache-Control": "no-store"},
            )
            await response(scope, receive, send_no_store)
            return

        if not _remote_access_enabled():
            client = scope.get("client")
            client_host = client[0] if client else ""
            if not _is_loopback(client_host):
                response = JSONResponse(
                    status_code=403,
                    content={
                        "detail": (
                            "The LawSense API accepts local-machine requests only by default. "
                            "For a trusted reverse-proxy deployment, set "
                            "LAWSENSE_ALLOW_REMOTE_API=true only after restricting access "
                            "at the network layer. This setting does not add authentication."
                        )
                    },
                    headers={"Cache-Control": "no-store"},
                )
                await response(scope, receive, send_no_store)
                return

        await self.app(scope, receive, send_no_store)
