"""Integration tests for login sessions and per-case ownership."""

from __future__ import annotations
import asyncio
import json
import os
import secrets
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from app.db import database
from app.main import app
from app.services import auth_service
from app.core.request_context import current_owner_id

def _asgi_request(method: str, path: str, payload: dict | None = None, *, cookie: str | None = None, origin: str | None = None) -> tuple[int, dict[bytes, bytes], object]:
    raw_body = json.dumps(payload).encode("utf-8") if payload is not None else b""
    headers = [(b"host", b"testserver")]
    if payload is not None:
        headers.append((b"content-type", b"application/json"))
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    if origin:
        headers.append((b"origin", origin.encode("ascii")))
    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1", "method": method, "scheme": "http",
        "path": path, "raw_path": path.encode("ascii"), "query_string": b"",
        "root_path": "", "headers": headers, "client": ("testclient", 123),
        "server": ("testserver", 80), "state": {},
    }
    sent = False
    messages: list[dict] = []
    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": raw_body, "more_body": False}
        return {"type": "http.disconnect"}
    async def send(message):
        messages.append(message)
    with patch.dict(os.environ, {"LAWSENSE_AUTH_TEST_BYPASS": "0"}):
        asyncio.run(app(scope, receive, send))
    response_start = next(m for m in messages if m["type"] == "http.response.start")
    status = response_start["status"]
    response_headers = {k.lower(): v for k, v in response_start["headers"]}
    body_bytes = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    return status, response_headers, json.loads(body_bytes) if body_bytes else None

def _cookie(headers: dict[bytes, bytes]) -> str:
    raw = headers.get(b"set-cookie", b"").decode("latin-1")
    if not raw:
        raise AssertionError("Expected session Set-Cookie header.")
    return raw.split(";", 1)[0]

class AuthenticationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_db_path = database.DB_PATH
        self.temporary_directory = tempfile.TemporaryDirectory()
        database.DB_PATH = Path(self.temporary_directory.name) / "lawsense-auth-test.db"
        database.init_db()
        current_owner_id.set(None)

    def tearDown(self) -> None:
        current_owner_id.set(None)
        database.DB_PATH = self.original_db_path
        self.temporary_directory.cleanup()

    def create_first_user(self, username: str = "local.owner", password: str = "A-long-test-password-42") -> str:
        _asgi_request("GET", "/auth/setup-status")
        setup_token = auth_service.read_local_setup_token()
        status, headers, body = _asgi_request("POST", "/auth/register", {"username": username, "password": password, "setupToken": setup_token}, origin="http://localhost:3000")
        self.assertEqual(status, 201, body)
        return _cookie(headers)

    def create_second_test_user(self, username: str = "other.owner", password: str = "Another-test-password-73") -> str:
        user_id = str(uuid4())
        salt = secrets.token_bytes(16)
        digest = auth_service.hash_password(password, salt)
        with database.get_connection() as connection:
            connection.execute(
                "INSERT INTO auth_users (id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, username, salt.hex(), digest.hex(), datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()
        token, _ = auth_service.create_session(user_id)
        return f"lawsense_session={token}"

    def test_initial_account_bootstrap_is_loopback_only(self) -> None:
        status, _headers, body = _asgi_request("POST", "/auth/register", {"username": "local.owner", "password": "A-long-test-password-42"}, origin="https://192.168.1.25:3000")
        self.assertEqual(status, 403, body)
        self.assertTrue(auth_service.setup_required())

    def test_registration_creates_hashed_account_and_httponly_session(self) -> None:
        status, _headers, body = _asgi_request("GET", "/auth/setup-status")
        self.assertEqual(status, 200, body)
        self.assertTrue(body["setupRequired"])
        setup_token = auth_service.read_local_setup_token()
        status, headers, body = _asgi_request("POST", "/auth/register", {"username": "local.owner", "password": "A-long-test-password-42", "setupToken": setup_token}, origin="http://localhost:3000")
        self.assertEqual(status, 201, body)
        cookie = _cookie(headers)
        self.assertIn("lawsense_session=", cookie)
        self.assertIn(b"httponly", headers[b"set-cookie"].lower())
        with database.get_connection() as connection:
            row = connection.execute("SELECT password_hash, password_salt FROM auth_users WHERE username = ?", ("local.owner",)).fetchone()
        self.assertIsNotNone(row)
        self.assertNotEqual(row["password_hash"], "A-long-test-password-42")
        self.assertTrue(len(row["password_hash"]) >= 64)
        self.assertFalse(auth_service.verify_setup_token("invalid-token"))
        status, _headers, body = _asgi_request("GET", "/auth/me", cookie=cookie, origin="http://localhost:3000")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["username"], "local.owner")
        self.assertFalse(auth_service.setup_required())

    def test_local_setup_code_is_required_even_for_loopback_origin(self) -> None:
        _asgi_request("GET", "/auth/setup-status")
        status, _headers, body = _asgi_request(
            "POST", "/auth/register",
            {"username": "local.owner", "password": "A-long-test-password-42"},
            origin="http://localhost:3000",
        )
        self.assertEqual(status, 403, body)
        self.assertTrue(auth_service.setup_required())

    def test_protected_case_routes_require_a_session(self) -> None:
        status, _headers, body = _asgi_request("GET", "/cases/nonexistent")
        self.assertEqual(status, 401, body)

    def test_login_rejects_wrong_password_with_generic_error(self) -> None:
        self.create_first_user()
        status, _headers, body = _asgi_request("POST", "/auth/login", {"username": "local.owner", "password": "Wrong-password-999"}, origin="http://localhost:3000")
        self.assertEqual(status, 401, body)
        self.assertEqual(body["detail"], "Invalid username or password.")

    def test_case_data_is_scoped_to_authenticated_owner(self) -> None:
        owner_cookie = self.create_first_user()
        status, _headers, case_body = _asgi_request("POST", "/cases", {"initialStatement": "My landlord has not returned my security deposit.", "language": "english"}, cookie=owner_cookie, origin="http://localhost:3000")
        self.assertEqual(status, 201, case_body)
        case_id = case_body["id"]
        with database.get_connection() as connection:
            row = connection.execute("SELECT owner_user_id FROM cases WHERE id = ?", (case_id,)).fetchone()
        self.assertIsNotNone(row)
        self.assertIsNotNone(row["owner_user_id"])
        status, _headers, _ = _asgi_request("GET", f"/cases/{case_id}")
        self.assertEqual(status, 401)
        status, _headers, own_case = _asgi_request("GET", f"/cases/{case_id}", cookie=owner_cookie, origin="http://localhost:3000")
        self.assertEqual(status, 200, own_case)
        other_cookie = self.create_second_test_user()
        status, _headers, other_case = _asgi_request("GET", f"/cases/{case_id}", cookie=other_cookie, origin="http://localhost:3000")
        self.assertEqual(status, 404, other_case)
        self.assertEqual(other_case["detail"], "Case not found")
        status, _headers, deleted = _asgi_request("DELETE", f"/cases/{case_id}", {"confirmation_phrase": "DELETE", "case_id_confirmation": case_id}, cookie=other_cookie, origin="http://localhost:3000")
        self.assertEqual(status, 404, deleted)
        with database.get_connection() as connection:
            remaining = connection.execute("SELECT owner_user_id FROM cases WHERE id = ?", (case_id,)).fetchone()
        self.assertEqual(remaining["owner_user_id"], row["owner_user_id"])

    def test_initial_account_can_only_be_created_once(self) -> None:
        self.create_first_user()
        status, _headers, body = _asgi_request("POST", "/auth/register", {"username": "second.local", "password": "Another-test-password-73"}, origin="http://localhost:3000")
        self.assertEqual(status, 409, body)

if __name__ == "__main__":
    unittest.main()
