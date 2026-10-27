"""Default-deny API network boundary for the personal local-first deployment.

The frontend's same-machine Next.js rewrite talks to FastAPI over loopback.
Remote clients should not connect to this API directly unless an operator
explicitly opts in and supplies network-layer protection.
"""

from __future__ import annotations

import ipaddress
import os

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


_REMOTE_ACCESS_ENV = "LAWSENSE_ALLOW_REMOTE_API"
_TEST_CLIENT_NAMES = frozenset({"testclient", "testserver"})


def _remote_access_enabled() -> bool:
    return os.getenv(_REMOTE_ACCESS_ENV, "").strip().casefold() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _is_loopback(host: str) -> bool:
    # Starlette's in-process test clients use a synthetic peer name rather
    # than an IP address. These values are not supplied by HTTP headers.
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
    """Reject direct remote API clients unless explicit remote access is enabled.

    This boundary reduces accidental LAN/public exposure. It is not user
    authentication and does not protect against other software running on the
    same machine or a compromised local account.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_no_store(message: Message) -> None:
            if message["type"] == "http.response.start":
                # Prevent browser/intermediary caching of sensitive case records.
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"cache-control"
                ]
                headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        # The explicit operator override changes network exposure only; it must
        # not turn sensitive API responses into cacheable responses.
        if _remote_access_enabled():
            await self.app(scope, receive, send_no_store)
            return

        client = scope.get("client")
        client_host = client[0] if client else ""
        if _is_loopback(client_host):
            await self.app(scope, receive, send_no_store)
            return

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
