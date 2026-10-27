from __future__ import annotations

import asyncio
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

from app.db import database
from app.main import _is_local_api_client, app


class LocalNetworkBoundaryTests(unittest.TestCase):
    def test_loopback_and_test_harness_clients_are_local(self) -> None:
        self.assertTrue(_is_local_api_client("127.0.0.1"))
        self.assertTrue(_is_local_api_client("::1"))
        self.assertTrue(_is_local_api_client("testclient"))

    def test_remote_or_unparseable_client_is_not_local(self) -> None:
        self.assertFalse(_is_local_api_client("192.0.2.10"))
        self.assertFalse(_is_local_api_client("2001:db8::1"))
        self.assertFalse(_is_local_api_client("not-an-ip"))
        self.assertFalse(_is_local_api_client(None))

    def test_remote_api_request_is_denied_by_default(self) -> None:
        sent_request = False
        status_code = 500
        chunks: list[bytes] = []
        response_headers: dict[bytes, bytes] = {}

        async def receive() -> dict[str, object]:
            nonlocal sent_request
            if sent_request:
                return {"type": "http.disconnect"}
            sent_request = True
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message: dict[str, object]) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                response_headers.update({
                    name.lower(): value for name, value in message.get("headers", [])
                })
            elif message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))  # type: ignore[arg-type]

        path = "/health"
        parsed = urlsplit(path)
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": parsed.path,
            "raw_path": parsed.path.encode("ascii"),
            "query_string": b"",
            "root_path": "",
            "headers": [(b"host", b"testserver")],
            "client": ("192.0.2.10", 12345),
            "server": ("testserver", 80),
            "state": {},
        }
        with patch("app.main._REMOTE_API_FLAG", False):
            asyncio.run(app(scope, receive, send))

        self.assertEqual(status_code, 403)
        self.assertEqual(response_headers.get(b"cache-control"), b"no-store")
        body = json.loads(b"".join(chunks))
        self.assertIn("disabled by default", body["detail"])
        self.assertIn("does not add authentication", body["detail"])

        # The same API remains usable for the same-machine Next.js proxy, and
        # successful responses carrying case data must not be cacheable either.
        scope["client"] = ("127.0.0.1", 12345)
        sent_request = False
        status_code = 500
        chunks.clear()
        response_headers.clear()
        with patch("app.main._REMOTE_API_FLAG", False):
            asyncio.run(app(scope, receive, send))

        self.assertEqual(status_code, 200)
        self.assertEqual(response_headers.get(b"cache-control"), b"no-store")

    @unittest.skipIf(os.name == "nt", "POSIX file mode bits are not Windows ACLs")
    def test_sqlite_database_file_is_private_to_the_running_account(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lawsense-test.db"
            with patch.object(database, "DB_PATH", path):
                with database.get_connection() as connection:
                    connection.execute("CREATE TABLE IF NOT EXISTS privacy_mode_test (id INTEGER)")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
