from __future__ import annotations

import asyncio
import hashlib
import json
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from unittest.mock import patch

from app.db import database
from app.engines.document_intelligence import DocumentProcessingStatus, EvidenceStatus
from app.engines.legal_knowledge.models import KnowledgeItem, KnowledgeStatus, SourceReference
from app.engines.safety_support import ResourceCategory, orchestrate_safety_support
from app.main import app
from app.schemas.case_state import CaseState, Jurisdiction as CaseJurisdiction
from app.services.case_pipeline import run_persisted_case_pipeline
from app.services.document_service import (
    confirm_document_findings_for_case,
    integrate_document_evidence,
    process_document,
    review_stored_document_for_case,
    upload_document_for_case,
)
from app.services.legal_knowledge_service import get_provision, search_legal_knowledge
from document_intelligence.test_pipeline import make_pdf


class _LocalOCR:
    def extract_text(self, document_bytes: bytes, *, mime_type: str, page_number: int) -> str:
        return "Rent is INR 30,000 on 2025-03-04."


class _DepositOCR:
    def extract_text(self, document_bytes: bytes, *, mime_type: str, page_number: int) -> str:
        return "Security deposit INR 30,000 on 2025-03-04."


def _asgi_request(
    method: str,
    path: str,
    payload: dict[str, object] | None = None,
    *,
    raw_body: bytes | None = None,
    content_type: str = "application/json",
) -> tuple[int, object]:
    """Send one HTTP request through FastAPI without an external test client."""
    body = (
        raw_body
        if raw_body is not None
        else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if payload is not None
        else b""
    )
    sent_request = False
    response_status = 500
    response_chunks: list[bytes] = []

    async def receive() -> dict[str, object]:
        nonlocal sent_request
        if sent_request:
            return {"type": "http.disconnect"}
        sent_request = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: dict[str, object]) -> None:
        nonlocal response_status
        if message["type"] == "http.response.start":
            response_status = int(message["status"])
        elif message["type"] == "http.response.body":
            response_chunks.append(message.get("body", b""))  # type: ignore[arg-type]

    parsed_path = urlsplit(path)
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": parsed_path.path,
        "raw_path": parsed_path.path.encode("ascii"),
        "query_string": parsed_path.query.encode("ascii"),
        "root_path": "",
        "headers": [(b"host", b"testserver"), (b"content-type", content_type.encode("ascii"))],
        "client": ("testclient", 123),
        "server": ("testserver", 80),
        "state": {},
    }
    asyncio.run(app(scope, receive, send))
    response_body = b"".join(response_chunks)
    return response_status, json.loads(response_body) if response_body else None


def _multipart_file(filename: str, content: bytes) -> tuple[str, bytes]:
    boundary = "LawSenseTestBoundary"
    body = (
        f"--{boundary}\r\n".encode("ascii")
        + f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode("ascii")
        + b"Content-Type: application/octet-stream\r\n\r\n"
        + content
        + f"\r\n--{boundary}--\r\n".encode("ascii")
    )
    return f"multipart/form-data; boundary={boundary}", body


class ServiceIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.db_path = Path(self.temp_dir.name) / "integration.db"
        self.db_path_patch = patch.object(database, "DB_PATH", self.db_path)
        self.db_path_patch.start()
        self.addCleanup(self.db_path_patch.stop)
        self.document_data = Path(self.temp_dir.name) / "data"
        self.document_data.mkdir()
        self.document_data_patch = patch("app.services.document_service.DATA_DIR", self.document_data)
        self.document_data_patch.start()
        self.addCleanup(self.document_data_patch.stop)
        database.init_db()

    def post_case(self, statement: str, **fields: str | None) -> CaseState:
        payload: dict[str, object] = {
            "initialStatement": statement,
            "title": None,
            "language": None,
            "personName": None,
            **fields,
        }
        status, body = _asgi_request("POST", "/cases", payload)
        self.assertEqual(status, 201, body)
        return CaseState.model_validate(body)

    def get_case(self, case_id: str) -> CaseState:
        status, body = _asgi_request("GET", f"/cases/{case_id}")
        self.assertEqual(status, 200, body)
        return CaseState.model_validate(body)

    def test_social_safety_examples_keep_issues_safety_unknowns_and_evidence_separate(self) -> None:
        examples = (
            (
                "A",
                "Mere husband dowry ke liye mujhe baar baar threaten karte hain.",
                "dowry_related_harassment",
                "dowry_related_threat_concern",
            ),
            (
                "B",
                "Mujhe office mein repeatedly unwanted sexual messages aa rahe hain.",
                "workplace_harassment",
                "workplace_sexual_harassment_concern",
            ),
            (
                "C",
                "Someone is threatening to leak my private photos.",
                "cyber_abuse",
                "blackmail",
            ),
            (
                "D",
                "Minor child ke saath sexual abuse ka suspicion hai.",
                "child_protection",
                "child_safety_concern",
            ),
            (
                "E",
                "Landlord ne security deposit return nahi kiya.",
                "housing",
                None,
            ),
            (
                "F",
                "Seller ne damaged phone diya aur refund nahi kar raha.",
                "consumer",
                None,
            ),
        )
        for label, statement, issue_category, safety_indicator in examples:
            with self.subTest(example=label):
                case = self.post_case(statement)
                stored = self.get_case(case.id)
                self.assertEqual(stored.initialStatement, statement)
                self.assertIn(issue_category, {item.category for item in stored.legalIssues})
                self.assertEqual(stored.evidence[0].status, "user_reported")
                self.assertEqual(stored.evidence[0].source, "user")
                self.assertIsNotNone(stored.analysis)
                self.assertIsNotNone(stored.analysis.decision_scenario)
                self.assertIn("Verification required", stored.analysis.decision_scenario.legal_information_status)
                if safety_indicator:
                    self.assertEqual(stored.analysis.safety_context.context, "potentially_unsafe")
                    self.assertIn(
                        safety_indicator,
                        {item.category for item in stored.analysis.safety_context.indicators},
                    )
                    self.assertIn(
                        "potentially unsafe",
                        (stored.analysis.safety_context.recommended_safety_prompt or "").casefold(),
                    )
                else:
                    self.assertEqual(stored.analysis.safety_context.context, "none")
                self.assertTrue(stored.unknowns)

    def test_legal_twin_api_returns_engine_graph_and_point_in_time_snapshots(self) -> None:
        case = self.post_case(
            "My landlord refused to return my security deposit on 2025-02-15."
        )

        twin_status, twin_body = _asgi_request("GET", f"/cases/{case.id}/twin")

        self.assertEqual(twin_status, 200, twin_body)
        self.assertEqual(twin_body["caseId"], case.id)
        self.assertTrue(twin_body["timeline"])
        node_ids = {item["id"] for item in twin_body["snapshot"]["nodes"]}
        self.assertIn("evidence:initial-statement", node_ids)
        self.assertTrue(any(item["kind"] == "EVENT" for item in twin_body["snapshot"]["nodes"]))
        self.assertTrue(any(
            item["kind"] == "PROCEDURE"
            and item["properties"].get("record_type") == "journey_possible_path"
            and item["status"] == "unknown"
            for item in twin_body["snapshot"]["nodes"]
        ))
        self.assertTrue(any(
            item["kind"] == "ACTION" and item["status"] == "system_inferred"
            for item in twin_body["snapshot"]["nodes"]
        ))
        evidence_node = next(item for item in twin_body["snapshot"]["nodes"] if item["id"] == "evidence:initial-statement")
        self.assertEqual(evidence_node["status"], "user_reported")
        self.assertTrue(evidence_node["provenance"])

        captured_at = datetime.fromisoformat(case.metadata.createdAt)
        before_capture = (captured_at.replace(hour=0, minute=0, second=0, microsecond=0)).date()
        earlier_status, earlier = _asgi_request(
            "GET",
            f"/cases/{case.id}/twin/snapshot?{urlencode({'as_of': before_capture.isoformat()})}",
        )
        current_status, current = _asgi_request(
            "GET",
            f"/cases/{case.id}/twin/snapshot?{urlencode({'as_of': captured_at.isoformat()})}",
        )

        self.assertEqual(earlier_status, 200, earlier)
        self.assertEqual(current_status, 200, current)
        self.assertLess(len(earlier["nodes"]), len(current["nodes"]))
        self.assertEqual(current["caseId"], case.id)
        self.assertTrue(current["limitations"])

        delta_query = urlencode({
            "from_as_of": before_capture.isoformat(),
            "to_as_of": captured_at.isoformat(),
        })
        delta_status, delta = _asgi_request("GET", f"/cases/{case.id}/twin/delta?{delta_query}")
        self.assertEqual(delta_status, 200, delta)
        self.assertEqual(delta["caseId"], case.id)
        self.assertIsInstance(delta["addedNodeIds"], list)
        self.assertIsInstance(delta["impactedEdgeIds"], list)

    def test_legal_twin_includes_procedure_and_authority_records_only_when_returned(self) -> None:
        source = SourceReference(
            source_id="test-source-record",
            retrieval_time=datetime.now().astimezone(),
        )
        authority = KnowledgeItem(
            id="test-authority-record",
            title="Test authority record",
            type="authority",
            status=KnowledgeStatus.UNVERIFIED,
            provenance=(source,),
        )
        procedure = KnowledgeItem(
            id="test-procedure-record",
            title="Test procedure record",
            type="legal_procedure",
            authority=authority.id,
            status=KnowledgeStatus.UNVERIFIED,
            provenance=(source,),
        )
        with patch("app.services.case_pipeline.search_legal_knowledge", return_value=(authority, procedure)):
            case = self.post_case("Seller ne damaged phone diya aur refund nahi kar raha.")
            status, body = _asgi_request("GET", f"/cases/{case.id}/twin")

        self.assertEqual(status, 200, body)
        nodes = body["snapshot"]["nodes"]
        self.assertIn("procedure:test-procedure-record", {item["id"] for item in nodes})
        self.assertIn("authority:test-authority-record", {item["id"] for item in nodes})
        self.assertEqual(
            next(item for item in nodes if item["id"] == "procedure:test-procedure-record")["status"],
            "unknown",
        )
        self.assertTrue(any(
            edge["kind"] == "PROCEDURE_AVAILABLE_AT_AUTHORITY"
            and edge["sourceId"] == "procedure:test-procedure-record"
            and edge["targetId"] == "authority:test-authority-record"
            for edge in body["snapshot"]["edges"]
        ))

    def test_post_cases_creates_a_canonical_case_state(self) -> None:
        case = self.post_case("My landlord withheld my rent deposit.")

        self.assertIsInstance(case, CaseState)
        self.assertTrue(case.id)
        self.assertEqual(case.evidence[0].source, "user")
        self.assertIsNotNone(case.analysis)

    def test_consumer_support_category_does_not_break_case_creation(self) -> None:
        statement = "I bought a defective phone, requested a refund, and the seller refused."

        assessment = orchestrate_safety_support(
            statement,
            jurisdiction="IN",
            requested_resource_categories=["CONSUMER_SUPPORT"],
        )
        self.assertEqual(assessment.resource_categories, (ResourceCategory.CONSUMER_SUPPORT,))
        with self.assertRaises(ValueError):
            orchestrate_safety_support(statement, requested_resource_categories=["unrelated_category"])

        case = self.post_case(statement)

        self.assertEqual(case.initialStatement, statement)
        self.assertIsNotNone(case.analysis)

    def test_case_clarification_answers_update_case_and_close_the_grounded_question(self) -> None:
        case = self.post_case("My landlord withheld my security deposit.")
        status, queue = _asgi_request("GET", f"/cases/{case.id}/clarification")

        self.assertEqual(status, 200, queue)
        self.assertEqual(queue["caseId"], case.id)
        self.assertTrue(queue["questions"])
        question = queue["questions"][0]
        self.assertTrue(question["sources"])
        self.assertTrue(all(source["text"].strip() for source in question["sources"]))
        answer_by_category = {
            "jurisdiction": "Pune, Maharashtra, India",
            "dates": "The events occurred in March 2025.",
            "parties": "The landlord is Ravi.",
            "objective": "I want to understand options for recovering the deposit.",
            "evidence": "I have the rental agreement and payment receipt.",
            "safety": "I am not sure.",
            "other": "I do not know yet.",
        }
        answer = answer_by_category[question["category"]]
        answer_status, answer_body = _asgi_request(
            "POST",
            f"/cases/{case.id}/clarification/{question['id']}/answer",
            {"answer": answer},
        )

        self.assertEqual(answer_status, 200, answer_body)
        updated = CaseState.model_validate(answer_body)
        self.assertEqual(updated.initialStatement, case.initialStatement)
        self.assertIsNotNone(updated.analysis)
        self.assertEqual(updated.analysis.journey.case_id, case.id)
        if question["category"] == "jurisdiction":
            self.assertEqual(updated.jurisdiction.locationText, answer)
            self.assertEqual(updated.jurisdiction.basis, "user_reported")
            self.assertEqual(updated.analysis.journey.jurisdiction_status, "known")
        answer_fact = next(fact for fact in updated.facts if f"clarificationQuestionId={question['id']}" in (fact.notes or ""))
        self.assertEqual(answer_fact.value, answer)
        self.assertEqual(answer_fact.status, "user_reported")
        answer_evidence = next(item for item in updated.evidence if answer_fact.id in item.extractedFacts)
        self.assertEqual(answer_evidence.source, "user")
        self.assertEqual(answer_evidence.status, "user_reported")
        refreshed_unknown_ids = {item.id for item in updated.analysis.journey.unknowns}
        self.assertTrue(all(
            source["sourceId"] not in refreshed_unknown_ids
            for source in question["sources"]
            if source["sourceType"] == "journey"
        ))

        refreshed_status, refreshed = _asgi_request("GET", f"/cases/{case.id}/clarification")
        self.assertEqual(refreshed_status, 200, refreshed)
        self.assertNotIn(question["id"], {item["id"] for item in refreshed["questions"]})
        self.assertEqual(self.get_case(case.id), updated)

    def test_case_clarification_skip_keeps_unknown_and_does_not_add_fact(self) -> None:
        case = self.post_case("My landlord withheld my security deposit.")
        status, queue = _asgi_request("GET", f"/cases/{case.id}/clarification")
        self.assertEqual(status, 200, queue)
        question = queue["questions"][0]
        original_fact_ids = {fact.id for fact in case.facts}
        original_evidence_ids = {item.id for item in case.evidence}
        original_unknowns = list(case.unknowns)

        skip_status, body = _asgi_request(
            "POST",
            f"/cases/{case.id}/clarification/{question['id']}/skip",
        )

        self.assertEqual(skip_status, 200, body)
        skipped = CaseState.model_validate(body)
        self.assertEqual(skipped.unknowns, original_unknowns)
        self.assertEqual({fact.id for fact in skipped.facts}, original_fact_ids)
        self.assertEqual({item.id for item in skipped.evidence}, original_evidence_ids)
        self.assertIn(question["id"], skipped.skippedClarificationIds)
        self.assertIsNotNone(skipped.analysis)
        self.assertEqual(skipped.analysis.journey.jurisdiction_status, "unknown")

        refreshed_status, refreshed = _asgi_request("GET", f"/cases/{case.id}/clarification")
        self.assertEqual(refreshed_status, 200, refreshed)
        self.assertNotIn(question["id"], {item["id"] for item in refreshed["questions"]})
        self.assertEqual(self.get_case(case.id), skipped)

        review_status, review_queue = _asgi_request(
            "GET",
            f"/cases/{case.id}/clarification?include_skipped=true",
        )
        self.assertEqual(review_status, 200, review_queue)
        skipped_question = next(item for item in review_queue["questions"] if item["id"] == question["id"])

        answer_status, answer_body = _asgi_request(
            "POST",
            f"/cases/{case.id}/clarification/{skipped_question['id']}/answer",
            {"answer": "Pune"},
        )
        self.assertEqual(answer_status, 200, answer_body)
        answered = CaseState.model_validate(answer_body)
        self.assertNotIn(question["id"], answered.skippedClarificationIds)
        self.assertTrue(any(
            fact.status == "user_reported"
            and f"clarificationQuestionId={question['id']}" in (fact.notes or "")
            for fact in answered.facts
        ))
        self.assertEqual(self.get_case(case.id), answered)

    def test_requested_landlord_examples_run_end_to_end(self) -> None:
        examples = (
            "Mere landlord ne ₹30,000 security deposit return nahi kiya. Agreement bhi hai.",
            "My landlord did not return my ₹30,000 security deposit. I have the rental agreement.",
        )
        for statement in examples:
            with self.subTest(statement=statement):
                created = self.post_case(statement)
                stored = self.get_case(created.id)

                self.assertEqual(stored.initialStatement, statement)
                self.assertIn("housing", [issue.category for issue in stored.legalIssues])
                self.assertIn(30000, [fact.value for fact in stored.facts if fact.key == "amount_inr"])
                self.assertIsNotNone(stored.analysis)
                self.assertEqual(stored.analysis.safety_context.context, "none")
                self.assertEqual(stored.analysis.legal_knowledge.status, "records_found")
                knowledge = stored.analysis.legal_knowledge.records
                self.assertTrue(knowledge)
                record = next(item for item in knowledge if item.type == "legal_provision")
                self.assertEqual(record.status, "verified")
                self.assertTrue(record.authority)
                self.assertTrue(record.source)
                self.assertEqual(
                    record.reference,
                    "Section 11(1)(a)–(b) and Section 11(2); commencement under Section 1(3)",
                )
                self.assertTrue(record.version)
                self.assertTrue(record.source_url.startswith((
                    "https://indiacode.gov.in/",
                    "https://www.indiacode.nic.in/",
                    "https://cdnbbsr.s3waas.gov.in/",
                    "https://udd.uk.gov.in/document/uttarakhand-tenancy-act-2021/",
                )), f"Unexpected/non-canonical source URL: {record.source_url!r}")
                self.assertEqual(record.authority_tier, "TIER_1_PRIMARY_OFFICIAL")
                self.assertTrue(record.provenance)
                self.assertEqual(record.jurisdiction, "jurisdiction-uttarakhand")
                self.assertEqual(record.jurisdiction_label, "India, Uttarakhand")
                self.assertEqual(record.jurisdiction_match_status, "unknown")
                self.assertEqual(record.source_verification_status, "verified")
                self.assertEqual(record.source_freshness_status, "unknown")
                self.assertEqual(record.source_applicability_status, "applicability_not_established")
                self.assertTrue(any("commencement" in (item.page_section_reference or "") for item in record.provenance))
                self.assertEqual(stored.analysis.journey.case_id, stored.id)
                self.assertEqual(stored.analysis.journey.jurisdiction_status, "unknown")
                self.assertEqual(
                    tuple(dict.fromkeys(step.stage for step in stored.analysis.journey.steps)),
                    ("UNDERSTAND", "FACTS", "EVIDENCE", "LAW", "OPTIONS", "NEXT_STEP"),
                )
                self.assertTrue(all(path.status == "verification_required" for path in stored.analysis.journey.possible_paths))
                self.assertEqual(stored, created)

    def test_landlord_source_candidate_reports_mismatch_for_maharashtra(self) -> None:
        case = self.post_case("Mere landlord ne ₹30,000 security deposit return nahi kiya. Agreement bhi hai.")
        case.jurisdiction = CaseJurisdiction(
            country="India",
            state="Maharashtra",
            city="Pune",
            basis="user_reported",
        )

        result = run_persisted_case_pipeline(case)

        record = next(
            item for item in result.case_analysis.legal_knowledge.records
            if item.id == "provision-uttarakhand-tenancy-act-2021-section-11-security-deposit"
        )
        self.assertEqual(record.jurisdiction_label, "India, Uttarakhand")
        self.assertEqual(record.jurisdiction_match_status, "mismatch")
        self.assertEqual(record.status, "verified")
        self.assertEqual(record.source_verification_status, "verified")
        self.assertEqual(record.source_freshness_status, "unknown")
        self.assertEqual(record.source_applicability_status, "applicability_not_established")
        self.assertTrue(any(
            item.subject == "jurisdiction_specific_conclusion"
            for item in result.legal_reasoning.blocked_conclusions
        ))


    def test_initial_statement_is_preserved_exactly(self) -> None:
        statement = " MERE LANDLORD ne ₹30,000 security deposit wapas nahi kiya.\n"

        case = self.post_case(statement)

        self.assertEqual(case.initialStatement, statement)
        self.assertEqual(self.get_case(case.id).initialStatement, statement)

    def test_extraction_output_is_persisted(self) -> None:
        case = self.post_case("My landlord withheld my ₹30,000 deposit on March 4, 2025.")
        stored = self.get_case(case.id)

        self.assertEqual(stored, case)
        self.assertIn("housing", [issue.category for issue in stored.legalIssues])
        self.assertIn(30000, [fact.value for fact in stored.facts if fact.key == "amount_inr"])
        self.assertTrue(stored.events)

    def test_get_cases_returns_the_same_persisted_case(self) -> None:
        created = self.post_case(
            "The seller refused my refund.",
            title="Refund request",
            language="english",
            personName="Asha Rao",
        )

        retrieved = self.get_case(created.id)

        self.assertEqual(retrieved.model_dump(), created.model_dump())
        self.assertEqual(retrieved.initialStatement, "The seller refused my refund.")
        self.assertEqual(retrieved.title, "Refund request")
        self.assertEqual(retrieved.person.name, "Asha Rao")

    def test_older_sqlite_case_without_analysis_still_loads(self) -> None:
        created = self.post_case("My landlord did not return my deposit.")
        old_payload = created.model_dump(mode="json")
        old_payload.pop("analysis")
        for evidence in old_payload["evidence"]:
            evidence.pop("processingStatus", None)
        with database.get_connection() as connection:
            connection.execute(
                "UPDATE cases SET state_json = ? WHERE id = ?",
                (json.dumps(old_payload), created.id),
            )
            connection.commit()

        stored = self.get_case(created.id)

        self.assertIsNone(stored.analysis)
        self.assertEqual(stored.initialStatement, created.initialStatement)

    def test_document_service_invokes_local_processing_interface(self) -> None:
        image = b"\x89PNG\r\n\x1a\n" + b"fixture image data"

        result = process_document(image, "statement.png", ocr_backend=_LocalOCR())

        self.assertEqual(result.status, DocumentProcessingStatus.EXTRACTED)
        self.assertEqual(result.pages[0].extraction_method, "ocr")
        amount = next(item for item in result.evidence if item.field == "amount")
        self.assertEqual(amount.value, "30000")
        self.assertEqual(amount.status, EvidenceStatus.EVIDENCE_SUPPORTED)

    def test_document_evidence_maps_into_case_state_without_storing_page_text(self) -> None:
        case = self.post_case("My landlord did not return my ₹40,000 security deposit.")
        pdf = make_pdf(["Security deposit INR 30,000 on 2025-03-04."])
        uploaded = upload_document_for_case(case.id, pdf, "deposit.pdf")
        assert uploaded is not None
        pending, result, document = uploaded

        document_row = next(item for item in pending.evidence if item.documentId == result.document_id)
        self.assertEqual(document_row.status, "unknown")
        self.assertEqual(document_row.extractedFacts, [])
        self.assertEqual(document.reviewStatus, "awaiting_confirmation")
        self.assertFalse(any(
            source.documentId == result.document_id
            for fact in pending.facts
            for source in fact.provenance
        ))

        review = review_stored_document_for_case(case.id, result.document_id)
        assert review is not None
        amount_finding = next(
            finding for finding in review.findings
            if finding.category == "amount" and finding.nature == "extraction"
        )
        self.assertTrue(review.conflicts)
        updated = confirm_document_findings_for_case(case.id, result.document_id, [amount_finding.id])
        assert updated is not None

        document_row = next(item for item in updated.evidence if item.documentId == result.document_id)
        document_amount = next(
            fact for fact in updated.facts
            if fact.sourceIds == [document_row.id] and fact.key == "amount_inr"
        )
        self.assertEqual(document_row.status, "conflicting")
        self.assertEqual(document_row.processingStatus, "extracted")
        self.assertEqual(document_amount.status, "conflicting")
        self.assertEqual(document_amount.value, "30000")
        self.assertEqual(document_amount.provenance[0].status, "conflicting")
        self.assertEqual(document_amount.provenance[0].pageNumber, 1)
        self.assertEqual(document_amount.provenance[0].confidence, 0.88)
        self.assertTrue(document_amount.provenance[0].confirmedByUser)
        self.assertTrue(document_row.extractedFacts)
        self.assertEqual(updated.documents[0].reviewStatus, "confirmed")
        self.assertEqual(updated.documents[0].confirmationHistory[0].findingIds, [amount_finding.id])
        self.assertTrue(any("amount_inr" in item for item in updated.conflicts))
        self.assertEqual(updated.initialStatement, case.initialStatement)
        self.assertNotIn("Security deposit INR 30,000", str(updated.model_dump()))

        reopened_review = review_stored_document_for_case(case.id, result.document_id)
        assert reopened_review is not None
        reopened_amount = next(
            finding for finding in reopened_review.findings
            if finding.category == "amount" and finding.nature == "extraction"
        )
        confirmed_again = confirm_document_findings_for_case(
            case.id,
            result.document_id,
            [reopened_amount.id],
        )
        assert confirmed_again is not None
        document_facts = [
            fact for fact in confirmed_again.facts
            if any(source.documentId == result.document_id for source in fact.provenance)
        ]
        self.assertEqual(len(document_facts), 1)
        self.assertEqual(len(confirmed_again.documents[0].confirmationHistory), 2)
        self.assertEqual(document_facts[0].status, "conflicting")

        database.save_case(confirmed_again)
        stored = database.get_case(confirmed_again.id)
        self.assertEqual(stored, confirmed_again)
        self.assertEqual(stored.analysis.journey.case_id, stored.id)

    def test_document_without_ocr_is_attached_as_needs_ocr_not_fake_text(self) -> None:
        case = self.post_case("My landlord did not return my security deposit.")
        image = b"\xff\xd8\xff" + b"fixture image data"

        with patch.dict(os.environ, {"LAW_SENSE_OCR_PROVIDER": "none"}):
            result = process_document(image, "scan.jpg", document_id="scan-doc-1")
        updated = integrate_document_evidence(case, result)

        self.assertEqual(result.status, DocumentProcessingStatus.OCR_REQUIRED)
        document_row = next(item for item in updated.evidence if item.documentId == result.document_id)
        self.assertEqual(document_row.processingStatus, "ocr_required")
        self.assertEqual(document_row.status, "unknown")
        self.assertEqual(document_row.extractedFacts, [])

    def test_legal_knowledge_service_uses_the_local_authoritative_seed(self) -> None:
        results = search_legal_knowledge("housing")
        self.assertIn(
            "provision-uttarakhand-tenancy-act-2021-section-11-security-deposit",
            {item.id for item in results},
        )
        self.assertIsNotNone(get_provision("provision-uttarakhand-tenancy-act-2021-section-11-security-deposit"))
        self.assertIsNone(get_provision("provision-not-loaded"))

    def test_missing_ocr_backend_does_not_create_fake_evidence(self) -> None:
        image = b"\xff\xd8\xff" + b"fixture image data"

        with patch.dict(os.environ, {"LAW_SENSE_OCR_PROVIDER": "none"}):
            result = process_document(image, "scan.jpg")

        self.assertEqual(result.status, DocumentProcessingStatus.OCR_REQUIRED)
        self.assertEqual(result.pages[0].text, "")
        self.assertEqual(result.evidence, ())
        self.assertTrue(any("no local OCR backend" in error for error in result.errors))

    def test_multipart_pdf_upload_persists_document_and_page_provenance(self) -> None:
        case = self.post_case("My landlord did not return my security deposit.")
        pdf = make_pdf(["Rental agreement.", "Rent is INR 30,000 on 2025-03-04."])
        content_type, body = _multipart_file("rental.pdf", pdf)

        status, response = _asgi_request(
            "POST",
            f"/cases/{case.id}/documents",
            raw_body=body,
            content_type=content_type,
        )

        self.assertEqual(status, 201, response)
        self.assertEqual(response["processingStatus"], "extracted")
        self.assertEqual(response["document"]["filename"], "rental.pdf")
        self.assertEqual(response["document"]["mimeType"], "application/pdf")
        self.assertEqual(response["document"]["sha256"], hashlib.sha256(pdf).hexdigest())
        self.assertEqual(response["document"]["pageCount"], 2)
        amount = next(item for item in response["extractedValues"] if item["field"] == "amount_inr")
        self.assertEqual(amount["value"], "30000")
        self.assertEqual(amount["provenance"]["documentId"], response["documentId"])
        self.assertEqual(amount["provenance"]["pageNumber"], 2)
        self.assertEqual(amount["provenance"]["confidence"], 0.88)
        self.assertEqual(amount["provenance"]["status"], "unknown")

        stored = self.get_case(case.id)
        self.assertEqual(stored.documents[0].sha256, hashlib.sha256(pdf).hexdigest())
        self.assertEqual([page.pageNumber for page in stored.documents[0].pages], [1, 2])
        self.assertEqual(stored.documents[0].reviewStatus, "awaiting_confirmation")
        self.assertFalse(any(
            source.documentId == response["documentId"]
            for fact in stored.facts
            for source in fact.provenance
        ))

        review_status, review = _asgi_request(
            "GET",
            f"/cases/{case.id}/documents/{response['documentId']}/review",
        )
        self.assertEqual(review_status, 200, review)
        amount_finding = next(
            item for item in review["findings"]
            if item["category"] == "amount" and item["nature"] == "extraction"
        )
        self.assertEqual(amount_finding["provenance"][0]["pageNumber"], 2)
        confirm_status, confirmed_body = _asgi_request(
            "POST",
            f"/cases/{case.id}/documents/{response['documentId']}/confirm",
            {"findingIds": [amount_finding["id"]]},
        )
        self.assertEqual(confirm_status, 200, confirmed_body)

        stored = CaseState.model_validate(confirmed_body)
        fact = next(
            fact for fact in stored.facts
            if fact.key == "amount_inr"
            and any(source.documentId == response["documentId"] for source in fact.provenance)
        )
        self.assertEqual(fact.provenance[0].documentId, response["documentId"])
        self.assertEqual(fact.provenance[0].pageNumber, 2)
        self.assertTrue(fact.provenance[0].confirmedByUser)
        self.assertEqual(
            [fact.key for fact in stored.facts if any(source.documentId == response["documentId"] for source in fact.provenance)],
            ["amount_inr"],
        )
        stored_files = list((self.document_data / "documents").rglob("*"))
        self.assertEqual([path for path in stored_files if path.is_file()][0].read_bytes(), pdf)

    def test_multipart_image_upload_reports_ocr_unavailable_without_fabricating_text(self) -> None:
        case = self.post_case("My landlord did not return my security deposit.")
        image = b"\x89PNG\r\n\x1a\n" + b"local image fixture"
        content_type, body = _multipart_file("scan.png", image)

        with patch.dict(os.environ, {"LAW_SENSE_OCR_PROVIDER": "none"}):
            status, response = _asgi_request(
                "POST",
                f"/cases/{case.id}/documents",
                raw_body=body,
                content_type=content_type,
            )

        self.assertEqual(status, 201, response)
        self.assertEqual(response["processingStatus"], "ocr_required")
        self.assertEqual(response["extractedValues"], [])
        self.assertIn("no local OCR backend", " ".join(response["document"]["errors"]))
        stored = self.get_case(case.id)
        self.assertEqual(stored.documents[0].processingStatus, "ocr_required")
        document_evidence = next(item for item in stored.evidence if item.documentId == response["documentId"])
        self.assertEqual(document_evidence.status, "unknown")
        self.assertEqual(document_evidence.processingStatus, "ocr_required")
        self.assertEqual(document_evidence.extractedFacts, [])

    def test_multipart_jpg_and_jpeg_uploads_are_supported(self) -> None:
        case = self.post_case("A case statement.")
        image = b"\xff\xd8\xff" + b"local JPEG fixture"

        for extension in ("jpg", "jpeg"):
            with self.subTest(extension=extension):
                content_type, body = _multipart_file(f"photo.{extension}", image)
                status, response = _asgi_request(
                    "POST",
                    f"/cases/{case.id}/documents",
                    raw_body=body,
                    content_type=content_type,
                )

                self.assertEqual(status, 201, response)
                self.assertEqual(response["document"]["mimeType"], "image/jpeg")
                self.assertEqual(response["document"]["extension"], f".{extension}")
                self.assertEqual(response["processingStatus"], "ocr_required")

        self.assertEqual(len(self.get_case(case.id).documents), 2)

    def test_bad_signature_is_rejected_without_storage(self) -> None:
        case = self.post_case("A case statement.")
        content_type, body = _multipart_file("not-a-pdf.pdf", b"ordinary text")

        status, response = _asgi_request(
            "POST",
            f"/cases/{case.id}/documents",
            raw_body=body,
            content_type=content_type,
        )

        self.assertEqual(status, 422)
        self.assertIn("supported PDF", response["detail"])
        self.assertEqual(self.get_case(case.id).documents, [])
        self.assertFalse((self.document_data / "documents").exists())

    def test_unreadable_pdf_is_persisted_with_failed_processing_status(self) -> None:
        case = self.post_case("A case statement.")
        pdf = b"%PDF-1.4\nnot a readable page tree"
        content_type, body = _multipart_file("broken.pdf", pdf)

        status, response = _asgi_request(
            "POST",
            f"/cases/{case.id}/documents",
            raw_body=body,
            content_type=content_type,
        )

        self.assertEqual(status, 201, response)
        self.assertEqual(response["processingStatus"], "failed")
        self.assertEqual(response["extractedValues"], [])
        stored = self.get_case(case.id)
        self.assertEqual(stored.documents[0].processingStatus, "failed")
        self.assertEqual(stored.documents[0].pageCount, 0)
        self.assertTrue(stored.documents[0].errors)

    def test_default_legal_repository_returns_source_verified_records(self) -> None:
        results = search_legal_knowledge("deposit", filters={"type": "legal_provision"})

        self.assertTrue(results)
        self.assertTrue(all(item.status is KnowledgeStatus.VERIFIED for item in results))
        self.assertIsNone(get_provision("section-1"))

    def test_multilingual_extraction_remains_intact(self) -> None:
        examples = (
            ("My landlord did not return my ₹30,000 security deposit.", "english"),
            ("Mere landlord ne ₹30,000 security deposit wapas nahi kiya.", "hinglish"),
            ("मेरे मकान मालिक ने तीस हजार रुपये की सुरक्षा जमा वापस नहीं की।", "hindi"),
        )

        for index, (statement, language) in enumerate(examples):
            with self.subTest(language=language):
                case = self.post_case(statement, language=language)
                self.assertEqual(case.initialStatement, statement)
                self.assertEqual(case.metadata.language, language)
                self.assertIn("housing", [issue.category for issue in case.legalIssues])

    def test_provenance_statuses_survive_sqlite_round_trip(self) -> None:
        case = self.post_case("My landlord refused to return my ₹30,000 deposit.")

        stored = self.get_case(case.id)
        source_evidence = stored.evidence[0]
        statement_fact = next(fact for fact in stored.facts if fact.key == "statement")
        amount_fact = next(fact for fact in stored.facts if fact.key == "amount_inr")

        self.assertEqual(source_evidence.status, "user_reported")
        self.assertEqual(statement_fact.status, "user_reported")
        self.assertEqual(statement_fact.sourceIds, [source_evidence.id])
        self.assertEqual(amount_fact.status, "system_inferred")
        self.assertEqual(amount_fact.sourceIds, [source_evidence.id])
        self.assertIn(statement_fact.id, source_evidence.extractedFacts)
        self.assertIn(amount_fact.id, source_evidence.extractedFacts)


if __name__ == "__main__":
    unittest.main()
