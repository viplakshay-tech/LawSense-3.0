"""Fail-closed session authentication for the LawSense HTTP API."""

from __future__ import annotations
import os
from http.cookies import SimpleCookie
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send
from app.core.request_context import current_owner_id
from app.services.auth_service import resolve_session

SESSION_COOKIE = "lawsense_session"
_PUBLIC_EXACT = frozenset({
    "/health", "/docs", "/openapi.json", "/redoc",
    "/auth/setup-status", "/auth/register", "/auth/login", "/auth/logout",
})

def _session_from_headers(headers: Headers) -> str | None:
    raw_cookie = headers.get("cookie", "")
    if not raw_cookie:
        return None
    try:
        cookies = SimpleCookie()
        cookies.load(raw_cookie)
        morsel = cookies.get(SESSION_COOKIE)
        return morsel.value if morsel else None
    except Exception:
        return None

class SessionAuthenticationMiddleware:
    """Requires a valid HttpOnly session on all case-bearing API routes."""
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # Set only on CI test steps while legacy route tests migrate to sessions.
        if os.getenv("LAWSENSE_AUTH_TEST_BYPASS", "").strip() == "1":
            # The browser fixture checks /auth/me to decide whether to render the
            # protected app. Give that route a synthetic identity only in the
            # explicitly enabled CI bypass; ordinary API fixture requests remain
            # unscoped so existing test data behaves as it did before auth.
            if scope.get("path") == "/auth/me":
                scope.setdefault("state", {})["auth_user"] = {
                    "id": "lawsense-ci-test-user",
                    "username": "ci-test",
                }
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        method = scope.get("method", "GET").upper()
        if method == "OPTIONS" or path in _PUBLIC_EXACT or path == "/legal-sources" or path.startswith("/legal-sources/"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        user = resolve_session(_session_from_headers(headers))
        if user is None:
            response = JSONResponse(
                status_code=401,
                content={"detail": "Authentication required. Sign in to LawSense."},
                headers={"Cache-Control": "no-store"},
            )
            await response(scope, receive, send)
            return
        owner_token = current_owner_id.set(user["id"])
        scope.setdefault("state", {})["auth_user"] = user
        try:
            await self.app(scope, receive, send)
        finally:
            current_owner_id.reset(owner_token)
