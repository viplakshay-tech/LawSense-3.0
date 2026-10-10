from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import patch

from app.db import database
from app.main import app
from app.schemas.case_state import CaseState
from document_compiler.test_compiler import make_case


def asgi_request(method: str, path: str, payload: dict[str, object] | None = None) -> tuple[int, object]:
    body = json.dumps(payload or {}).encode("utf-8") if payload is not None else b""
    sent_request = False
    status = 500
    chunks: list[bytes] = []

    async def receive() -> dict[str, object]:
        nonlocal sent_request
        if sent_request:
            return {"type": "http.disconnect"}
        sent_request = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: dict[str, object]) -> None:
        nonlocal status
        if message["type"] == "http.response.start":
            status = int(message["status"])
        elif message["type"] == "http.response.body":
            chunks.append(message.get("body", b""))  # type: ignore[arg-type]

    parsed = urlsplit(path)
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": parsed.path,
        "raw_path": parsed.path.encode("ascii"),
        "query_string": parsed.query.encode("ascii"),
        "root_path": "",
        "headers": [(b"host", b"testserver"), (b"content-type", b"application/json")],
        "client": ("testclient", 123),
        "server": ("testserver", 80),
        "state": {},
    }
    asyncio.run(app(scope, receive, send))
    response = b"".join(chunks)
    return status, json.loads(response) if response else None


class DocumentCompilerRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.db_patch = patch.object(database, "DB_PATH", Path(self.temp_dir.name) / "documents.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        database.init_db()
        self.case_state = make_case()
        database.save_case(self.case_state)

    def test_package_export_is_blocked_until_user_confirms_review(self) -> None:
        status, package = asgi_request(
            "POST",
            f"/cases/{self.case_state.id}/document-packages",
            {"templateIds": ["evidence-index"]},
        )
        self.assertEqual(status, 201, package)
        package_id = package["id"]

        blocked_status, blocked = asgi_request(
            "POST",
            f"/cases/{self.case_state.id}/document-packages/{package_id}/export",
        )
        self.assertEqual(blocked_status, 409, blocked)
        self.assertEqual(blocked["detail"]["export"]["status"], "blocked")
        self.assertTrue(any("confirmed review" in item for item in blocked["detail"]["export"]["blockers"]))

        confirm_status, confirmed = asgi_request(
            "POST",
            f"/cases/{self.case_state.id}/document-packages/{package_id}/confirm",
            {"acknowledgeMissingInformation": False},
        )
        self.assertEqual(confirm_status, 200, confirmed)
        self.assertEqual(confirmed["documents"][0]["reviewState"], "reviewed")

        export_status, export = asgi_request(
            "POST",
            f"/cases/{self.case_state.id}/document-packages/{package_id}/export",
        )
        self.assertEqual(export_status, 200, export)
        self.assertEqual(export["status"], "ready")
        self.assertEqual(export["documents"][0]["status"], "ready")
        self.assertTrue(export["documents"][0]["contentSha256"])

    def test_stale_package_export_is_blocked_after_case_changes(self) -> None:
        status, package = asgi_request(
            "POST",
            f"/cases/{self.case_state.id}/document-packages",
            {"templateIds": ["evidence-index"]},
        )
        self.assertEqual(status, 201, package)
        database.save_case(self.case_state.model_copy(update={"title": "New case title"}))

        export_status, export = asgi_request(
            "POST",
            f"/cases/{self.case_state.id}/document-packages/{package['id']}/export",
        )

        self.assertEqual(export_status, 409, export)
        self.assertTrue(any("case changed" in item for item in export["detail"]["export"]["blockers"]))

    def test_package_route_preserves_selected_fact_edits_and_provenance(self) -> None:
        status, package = asgi_request(
            "POST",
            f"/cases/{self.case_state.id}/document-packages",
            {
                "templateIds": ["evidence-index"],
                "includedFactIdsByTemplate": {"evidence-index": ["fact-deposit"]},
                "factEditsByTemplate": {"evidence-index": {"fact-deposit": "User-confirmed wording: 31,000 INR"}},
            },
        )

        self.assertEqual(status, 201, package)
        field = package["documents"][0]["fields"]["selected_case_facts"]
        self.assertEqual(field["value"], "Deposit amount: User-confirmed wording: 31,000 INR")
        self.assertEqual(field["sourceFactIds"], ["fact-deposit"])
        self.assertIn("evidence-receipt", field["sourceEvidenceIds"])
        self.assertTrue(any(item["sourceType"] == "user_edit" for item in field["provenance"]))


if __name__ == "__main__":
    unittest.main()

