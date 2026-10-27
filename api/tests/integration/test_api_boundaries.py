from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import patch

from app.db import database
from app.main import app
from app.services.privacy import case_deletion
from app.schemas.case_state import CaseState
from app.services.voice_case import VoiceCaseService
from fastapi.middleware.cors import CORSMiddleware
from document_intelligence.test_pipeline import make_pdf


def _asgi_request(
    method: str,
    path: str,
    payload: dict[str, object] | None = None,
    *,
    raw_body: bytes | None = None,
    content_type: str = "application/json",
    client_host: str = "testclient",
    response_headers: dict[bytes, bytes] | None = None,
) -> tuple[int, object]:
    body = (
        raw_body
        if raw_body is not None
        else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if payload is not None
        else b""
    )
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
            if response_headers is not None:
                response_headers.clear()
                response_headers.update({
                    name.lower(): value for name, value in message.get("headers", [])  # type: ignore[union-attr]
                })
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
        "headers": [(b"host", host_header.encode("ascii")), (b"content-type", content_type.encode("ascii"))] + ([(b"origin", origin_header.encode("ascii"))] if origin_header is not None else []),
        "client": (client_host, 123),
        "server": ("testserver", 80),
        "state": {},
    }
    asyncio.run(app(scope, receive, send))
    response = b"".join(chunks)
    return status, json.loads(response) if response else None


def _multipart_file(filename: str, content: bytes) -> tuple[str, bytes]:
    boundary = "LawSenseApiBoundary"
    body = (
        f"--{boundary}\r\n".encode("ascii")
        + f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode("ascii")
        + b"Content-Type: application/octet-stream\r\n\r\n"
        + content
        + f"\r\n--{boundary}--\r\n".encode("ascii")
    )
    return f"multipart/form-data; boundary={boundary}", body


class ApiBoundaryIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.db_patch = patch.object(database, "DB_PATH", Path(self.temp_dir.name) / "api.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        database.init_db()

    def post_case(self, statement: str) -> CaseState:
        status, body = _asgi_request("POST", "/cases", {"initialStatement": statement})
        self.assertEqual(status, 201, body)
        return CaseState.model_validate(body)

    def test_capacitor_android_origin_is_allowlisted_for_local_health_check(self) -> None:
        cors_options = next(
            middleware.kwargs
            for middleware in app.user_middleware
            if middleware.cls is CORSMiddleware
        )
        origins = cors_options["allow_origins"]
        self.assertIn("https://localhost", origins)
        self.assertNotIn("*", origins)

    def test_case_deletion_requires_exact_case_id_confirmation(self) -> None:
        case = self.post_case("Synthetic case data that will remain until confirmed.")
        with patch.object(case_deletion, "DATA_DIR", Path(self.temp_dir.name) / "private-data"):
            status, body = _asgi_request(
                "DELETE",
                f"/cases/{case.id}",
                {
                    "confirmation_phrase": "DELETE",
                    "case_id_confirmation": "a-different-case",
                },
            )
        self.assertEqual(status, 400, body)
        self.assertIsNotNone(database.get_case(case.id))

    def test_confirmed_case_deletion_removes_case_and_prevents_stale_restore(self) -> None:
        case = self.post_case("Synthetic case data for deletion integration coverage.")
        data_dir = Path(self.temp_dir.name) / "private-data"
        with patch.object(case_deletion, "DATA_DIR", data_dir):
            status, body = _asgi_request(
                "DELETE",
                f"/cases/{case.id}",
                {
                    "confirmation_phrase": "DELETE",
                    "case_id_confirmation": case.id,
                },
            )
            self.assertEqual(status, 200, body)
            self.assertEqual(body["status"], "deleted")
            self.assertTrue(body["data_records_removed"])
            self.assertTrue(body["uploaded_documents_removed"])
            self.assertTrue(body["minimal_tombstone_retained"])
            self.assertIsNone(database.get_case(case.id))

            status, body = _asgi_request("GET", f"/cases/{case.id}")
            self.assertEqual(status, 404, body)

            with self.assertRaises(database.CasePermanentlyDeletedError):
                database.save_case(case)

    def test_untrusted_host_is_rejected_even_for_loopback_clients(self) -> None:
        with patch.dict(os.environ, {"LAWSENSE_ALLOW_REMOTE_API": "false"}):
            status, body = _asgi_request(
                "GET",
                "/health",
                client_host="127.0.0.1",
                host_header="attacker.example",
            )
        self.assertEqual(status, 403, body)
        self.assertIn("Host header", body["detail"])

    def test_untrusted_browser_origin_is_rejected(self) -> None:
        with patch.dict(os.environ, {"LAWSENSE_ALLOW_REMOTE_API": "false"}):
            status, body = _asgi_request(
                "GET",
                "/health",
                client_host="127.0.0.1",
                host_header="127.0.0.1:8000",
                origin_header="https://attacker.example",
            )
        self.assertEqual(status, 403, body)
        self.assertIn("Origin", body["detail"])

    def test_https_private_lan_frontend_origin_is_allowed_for_android_development(self) -> None:
        with patch.dict(os.environ, {"LAWSENSE_ALLOW_REMOTE_API": "false"}):
            status, body = _asgi_request(
                "GET",
                "/health",
                client_host="127.0.0.1",
                host_header="127.0.0.1:8000",
                origin_header="https://192.168.1.25:3000",
            )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["service"], "lawsense-api")

    def test_trusted_reverse_proxy_allowlists_are_explicit(self) -> None:
        with patch.dict(
            os.environ,
            {
                "LAWSENSE_ALLOW_REMOTE_API": "true",
                "LAWSENSE_ALLOWED_API_HOSTS": "api.example.test",
                "LAWSENSE_ALLOWED_API_ORIGINS": "https://portal.example.test",
            },
        ):
            status, body = _asgi_request(
                "GET",
                "/health",
                client_host="10.20.30.40",
                host_header="api.example.test",
                origin_header="https://portal.example.test",
            )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["service"], "lawsense-api")

    def test_remote_api_client_is_blocked_by_default(self) -> None:
        headers: dict[bytes, bytes] = {}
        with patch.dict(os.environ, {"LAWSENSE_ALLOW_REMOTE_API": "false"}):
            status, body = _asgi_request(
                "GET",
                "/health",
                client_host="192.168.1.50",
                response_headers=headers,
            )
        self.assertEqual(status, 403, body)
        self.assertIn("local-machine requests only", body["detail"].lower())
        self.assertEqual(headers.get(b"cache-control"), b"no-store")

    def test_loopback_api_client_remains_available_without_cacheable_responses(self) -> None:
        headers: dict[bytes, bytes] = {}
        with patch.dict(os.environ, {"LAWSENSE_ALLOW_REMOTE_API": "false"}):
            status, body = _asgi_request(
                "GET", "/health", client_host="127.0.0.1", response_headers=headers
            )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["service"], "lawsense-api")
        self.assertEqual(headers.get(b"cache-control"), b"no-store")

    def test_remote_api_access_requires_explicit_operator_opt_in(self) -> None:
        headers: dict[bytes, bytes] = {}
        with patch.dict(os.environ, {"LAWSENSE_ALLOW_REMOTE_API": "true"}):
            status, body = _asgi_request(
                "GET",
                "/health",
                client_host="192.168.1.50",
                response_headers=headers,
            )
        self.assertEqual(status, 200, body)
        self.assertEqual(headers.get(b"cache-control"), b"no-store")

    def test_landlord_deposit_complete_analysis_and_reasoning_are_structured_and_fail_closed(self) -> None:
        case = self.post_case("My landlord did not return my ₹30,000 security deposit.")

        status, body = _asgi_request("GET", f"/cases/{case.id}/analysis")

        self.assertEqual(status, 200, body)
        self.assertEqual(body["caseId"], case.id)
        self.assertEqual(body["status"], "available")
        self.assertEqual(body["legalKnowledgeStatus"], "insufficient_or_blocked")
        self.assertEqual(body["caseAnalysis"]["legalKnowledge"]["status"], "records_found")
        knowledge = body["caseAnalysis"]["legalKnowledge"]["records"]
        self.assertTrue(knowledge)
        provision = next(item for item in knowledge if item["type"] == "legal_provision")
        self.assertEqual(
            provision["reference"],
            "Section 11(1)(a)–(b) and Section 11(2); commencement under Section 1(3)",
        )
        self.assertEqual(provision["status"], "verified")
        self.assertEqual(provision["authorityTier"], "TIER_1_PRIMARY_OFFICIAL")
        self.assertTrue(
            provision["sourceUrl"].startswith((
                "https://indiacode.gov.in/",
                "https://www.indiacode.nic.in/",
            ))
        )
        self.assertEqual(provision["jurisdiction"], "jurisdiction-uttarakhand")
        reasoning = body["legalReasoning"]
        self.assertEqual(reasoning["caseId"], case.id)
        self.assertEqual(reasoning["legalKnowledgeStatus"], "insufficient_or_blocked")
        self.assertTrue(any(
            item["recordId"] == "provision-uttarakhand-tenancy-act-2021-section-11-security-deposit"
            and "JURISDICTION_UNKNOWN" in item["reasonCodes"]
            and "RULE_APPLICATION_NOT_PERFORMED" in item["reasonCodes"]
            for item in reasoning["groundedLegalStatements"]
        ))
        self.assertTrue(any(
            "JURISDICTION_UNKNOWN" in item["reasonCodes"]
            for item in reasoning["blockedConclusions"]
        ))
        json.dumps(body, ensure_ascii=False)

    def test_consumer_refund_returns_case_bound_journey_execution_state(self) -> None:
        case = self.post_case("The seller sent a damaged phone and has not refunded me.")

        status, first = _asgi_request("GET", f"/cases/{case.id}/journey/execution")
        second_status, second = _asgi_request("GET", f"/cases/{case.id}/journey/execution")

        self.assertEqual(status, 200, first)
        self.assertEqual(second_status, 200, second)
        self.assertEqual(first, second)
        self.assertEqual(first["caseId"], case.id)
        self.assertEqual(first["legalKnowledgeStatus"], "available")
        execution = first["execution"]
        self.assertEqual(execution["case_id"], case.id)
        self.assertTrue(execution["provenance"])
        self.assertTrue(execution["missing_information"])
        self.assertTrue(all(action["status"] == "proposed" for action in execution["user_actions"]))
        self.assertEqual(len(execution["case_readiness"]["dimensions"]), 7)
        self.assertEqual(execution["next_best_action"]["action"], "Confirm jurisdiction")
        self.assertEqual(execution["next_best_action"]["status"], "AVAILABLE")
        self.assertTrue(execution["action_plan"])
        json.dumps(first)

    def test_employment_dispute_exposes_separate_legal_reasoning_result(self) -> None:
        case = self.post_case("My employer has not paid my wages for April 2026.")

        status, body = _asgi_request("GET", f"/cases/{case.id}/legal-reasoning")

        self.assertEqual(status, 200, body)
        self.assertEqual(body["caseId"], case.id)
        self.assertEqual(body["status"], "available")
        self.assertEqual(body["legalKnowledgeStatus"], "insufficient_or_blocked")
        self.assertEqual(body["result"]["legalKnowledgeStatus"], "insufficient_or_blocked")
        self.assertTrue(any(
            "JURISDICTION_UNKNOWN" in step["reasonCodes"]
            for step in body["result"]["reasoningSteps"]
        ))
        self.assertTrue(any(
            item["recordId"] == "provision-code-on-wages-2019-section-17"
            and "JURISDICTION_UNKNOWN" in item["reasonCodes"]
            and "RULE_APPLICATION_NOT_PERFORMED" in item["reasonCodes"]
            for item in body["result"]["groundedLegalStatements"]
        ))

    def test_safety_sensitive_case_has_explicit_no_contact_and_unavailable_resources(self) -> None:
        case = self.post_case("Someone has repeatedly threatened me in messages.")

        status, body = _asgi_request(
            "POST",
            f"/cases/{case.id}/safety-support",
            {"immediateDanger": "not_sure"},
        )

        self.assertEqual(status, 200, body)
        self.assertEqual(body["status"], "available")
        self.assertEqual(body["resourceStatus"], "unavailable")
        self.assertIs(body["contactedAnyone"], False)
        self.assertIs(body["assessment"]["contactedAnyone"], False)
        self.assertEqual(body["assessment"]["workflowDisposition"], "safety_first")
        self.assertFalse(body["assessment"]["legalWorkflowAllowed"])
        self.assertTrue(body["assessment"]["triggerEvidence"])
        self.assertTrue(all("sourcePath" in item and "sourceId" in item for item in body["assessment"]["triggerEvidence"]))
        self.assertTrue(all("sourceText" not in item for item in body["assessment"]["triggerEvidence"]))
        self.assertEqual(body["assessment"]["resources"], [])

    def test_document_review_preserves_page_provenance_without_serializing_upload_bytes(self) -> None:
        case = self.post_case("My landlord has not returned my security deposit.")
        pdf = make_pdf(["RENT AGREEMENT\nLandlord: Mira Shah\nSecurity deposit INR 30,000.\nClause 2: Tenant shall pay rent on time."])
        content_type, body = _multipart_file("agreement.pdf", pdf)

        status, response = _asgi_request(
            "POST",
            f"/cases/{case.id}/documents/review",
            raw_body=body,
            content_type=content_type,
        )

        self.assertEqual(status, 200, response)
        self.assertEqual(response["status"], "available")
        self.assertEqual(response["processingStatus"], "extracted")
        self.assertTrue(response["findings"])
        amount = next(item for item in response["findings"] if item["category"] == "amount")
        self.assertEqual(amount["value"], "30000")
        self.assertEqual(amount["provenance"][0]["documentId"], response["documentId"])
        self.assertEqual(amount["provenance"][0]["pageNumber"], 1)
        self.assertNotIn("text", amount["provenance"][0])
        self.assertNotIn("agreement.pdf", json.dumps(response))
        self.assertNotIn(pdf.hex(), json.dumps(response))

    def test_missing_cases_and_invalid_inputs_return_client_errors(self) -> None:
        missing_analysis, _ = _asgi_request("GET", "/cases/missing-case/analysis")
        missing_reasoning, _ = _asgi_request("GET", "/cases/missing-case/legal-reasoning")
        missing_journey, _ = _asgi_request("GET", "/cases/missing-case/journey/execution")
        missing_safety, _ = _asgi_request("POST", "/cases/missing-case/safety-support", {})
        invalid_case, _ = _asgi_request("POST", "/cases", {"initialStatement": "   "})
        invalid_safety, _ = _asgi_request(
            "POST", "/cases/missing-case/safety-support", {"immediateDanger": "maybe"}
        )

        self.assertEqual(missing_analysis, 404)
        self.assertEqual(missing_reasoning, 404)
        self.assertEqual(missing_journey, 404)
        self.assertEqual(missing_safety, 404)
        self.assertEqual(invalid_case, 422)
        self.assertEqual(invalid_safety, 422)

    def test_voice_status_reports_unavailable_providers_without_claiming_local_processing(self) -> None:
        service = VoiceCaseService()
        with patch.object(app.state, "voice_case_service", service):
            status, body = _asgi_request("GET", "/cases/voice/status")

        self.assertEqual(status, 200, body)
        self.assertFalse(body["speechToTextAvailable"])
        self.assertEqual(body["processingLocation"], "none")
        self.assertIsNone(body["speechToTextProvider"])
        self.assertFalse(body["textToSpeechAvailable"])
        self.assertEqual(body["textToSpeechProcessingLocation"], "none")

    def test_local_tts_unavailable_returns_service_unavailable(self) -> None:
        with patch.object(app.state, "voice_case_service", VoiceCaseService()):
            status, body = _asgi_request(
                "POST",
                "/cases/voice/synthesize",
                {"text": "Hello", "language": "english"},
            )

        self.assertEqual(status, 503, body)
        self.assertEqual(body["detail"], "Local speech output is unavailable.")


if __name__ == "__main__":
    unittest.main()
