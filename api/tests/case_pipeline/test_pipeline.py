from __future__ import annotations

import json
import unittest
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from app.engines.legal_knowledge import (
    Authority,
    InMemoryLegalKnowledgeStore,
    Jurisdiction as KnowledgeJurisdiction,
    KnowledgeRelationship,
    KnowledgeStatus,
    LegalDocument,
    LegalProvision,
    LegalSource,
    RelationshipType,
    SourceAuthorityTier,
    SourceReference,
)
from app.engines.legal_reasoning import reason_about_case
from app.engines.legal_twin.models import InformationStatus
from app.engines.document_review import review_document
from app.schemas.case_state import CaseFact, EvidenceItem, EvidenceProvenance, Jurisdiction
from app.services.case_pipeline import (
    CasePipelineDependencies,
    CasePipelineDocument,
    CasePipelineRequest,
    build_analysis_timeline,
    build_evidence_context,
    retrieve_legal_knowledge,
    run_case_pipeline,
    run_persisted_case_pipeline,
)
from app.services.clarification import (
    apply_clarification_answer,
    build_clarification_questions,
    skip_clarification_question,
)
from app.services.case_pipeline import (
    _assess_safety,
    _build_journey_with_safety,
    _process_document_deterministically,
)
from app.engines.case_state import extract_case_state
from app.engines.journey_execution import create_execution
from app.services.document_service import integrate_document_evidence


RECORDED_AT = "2026-04-05T10:30:00+00:00"
FIXTURES = Path(__file__).parents[1] / "fixtures"
RETRIEVED_AT = datetime(2026, 1, 15, 12, 0, tzinfo=timezone.utc)


def make_pdf(page_texts: list[str]) -> bytes:
    """Build a small deterministic PDF without an external PDF writer."""
    page_ids = [3 + 2 * index for index in range(len(page_texts))]
    content_ids = [page_id + 1 for page_id in page_ids]
    font_id = 3 + 2 * len(page_texts)
    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: ("<< /Type /Pages /Kids [" + " ".join(f"{item} 0 R" for item in page_ids) + f"] /Count {len(page_ids)} >>").encode("ascii"),
        font_id: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    for page_id, content_id, text in zip(page_ids, content_ids, page_texts):
        objects[page_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>"
        ).encode("ascii")
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode("ascii")
        objects[content_id] = f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"

    result = bytearray(b"%PDF-1.4\n")
    offsets = [0] * (max(objects) + 1)
    for object_id in sorted(objects):
        offsets[object_id] = len(result)
        result.extend(f"{object_id} 0 obj\n".encode("ascii"))
        result.extend(objects[object_id])
        result.extend(b"\nendobj\n")
    xref_offset = len(result)
    result.extend(f"xref\n0 {len(offsets)}\n".encode("ascii"))
    result.extend(b"0000000000 65535 f \n")
    for object_id in range(1, len(offsets)):
        result.extend(f"{offsets[object_id]:010d} 00000 n \n".encode("ascii"))
    result.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(result)


def make_request(statement: str, *, case_id: str = "pipeline-case", documents=(), **kwargs) -> CasePipelineRequest:
    return CasePipelineRequest(
        case_id=case_id,
        initial_statement=statement,
        recorded_at=RECORDED_AT,
        documents=tuple(documents),
        **kwargs,
    )


class CasePipelineTests(unittest.TestCase):
    def _fixture(self, name: str) -> dict:
        return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))

    def _run_fixture(self, name: str):
        fixture = self._fixture(name)
        request = make_request(
            fixture["source"]["user_statement"],
            case_id=f"fixture-{fixture['scenario_id']}",
            language=fixture["source"].get("language"),
        )
        # These existing fixture assertions exercise the pipeline with an
        # explicitly empty repository. Default-seed behavior is covered below.
        return fixture, run_case_pipeline(
            request,
            legal_knowledge_repository=InMemoryLegalKnowledgeStore(),
        )

    def test_persisted_pipeline_reuses_case_state_and_preserves_record_identity(self) -> None:
        case = extract_case_state(
            "My landlord kept my deposit. I want to understand my options.",
            case_id="persisted-case",
            source_id="initial-statement",
            created_at=RECORDED_AT,
        )
        case.initialStatement = "My landlord kept my deposit. I want to understand my options."
        case.metadata.updatedAt = "2026-04-06T11:45:00+00:00"
        case.unknowns.append("The response date remains unknown.")
        before = case.model_dump(mode="json")

        def unexpected_extraction(*args, **kwargs):
            raise AssertionError("Persisted-case analysis must not re-extract the original statement.")

        result = run_persisted_case_pipeline(
            case,
            dependencies=replace(
                CasePipelineDependencies(),
                case_state_extractor=unexpected_extraction,
            ),
        )

        self.assertEqual(case.model_dump(mode="json"), before)
        self.assertEqual(result.case_state.id, "persisted-case")
        self.assertEqual(result.case_state.metadata.createdAt, before["metadata"]["createdAt"])
        self.assertEqual(result.case_state.metadata.updatedAt, before["metadata"]["updatedAt"])
        self.assertEqual(result.case_state.unknowns, case.unknowns)
        self.assertEqual(result.case_state.analysis, result.case_analysis)
        self.assertEqual(result.legal_reasoning.user_objective, case.intent.objective)
        objective_finding = next(
            item for item in result.legal_reasoning.user_reported_findings
            if item.text.startswith("User-stated objective:")
        )
        self.assertEqual(objective_finding.source_references[0].status, "user_reported")
        self.assertEqual(
            result.stage_order,
            (
                "CASE_STATE", "CONFIRMED_DOCUMENT_EVIDENCE", "EVIDENCE_CONTEXT",
                "LEGAL_KNOWLEDGE_RETRIEVAL", "LEGAL_REASONING", "SAFETY_SUPPORT",
                "JOURNEY_PLANNING", "JOURNEY_EXECUTION", "DECISION_SIMULATION",
                "LEGAL_TWIN", "NEXT_ACTION",
            ),
        )
        provisions = [
            item for item in result.case_analysis.legal_knowledge.records
            if item.type == "legal_provision"
        ]
        self.assertTrue(provisions)
        self.assertTrue(all(item.source_verification_status == "verified" for item in provisions))
        self.assertTrue(all(item.source_freshness_status == "unknown" for item in provisions))
        self.assertTrue(all(
            item.source_applicability_status == "applicability_not_established"
            for item in provisions
        ))

    def test_skipped_clarification_does_not_change_journey_or_legal_reasoning(self) -> None:
        case = extract_case_state(
            "My landlord kept my deposit.",
            case_id="skipped-clarification-case",
            source_id="initial-statement",
            created_at=RECORDED_AT,
        )
        case.initialStatement = "My landlord kept my deposit."
        question = build_clarification_questions(case, journey_unknowns=(), limit=None).next_question
        self.assertIsNotNone(question)
        assert question is not None

        before = run_persisted_case_pipeline(
            case,
            legal_knowledge_repository=InMemoryLegalKnowledgeStore(),
        )
        skipped = skip_clarification_question(
            case,
            question,
            journey_unknowns=(),
            skipped_at="2026-04-06T10:30:00+00:00",
        )
        after = run_persisted_case_pipeline(
            skipped,
            legal_knowledge_repository=InMemoryLegalKnowledgeStore(),
        )

        self.assertEqual(after.case_state.unknowns, before.case_state.unknowns)
        self.assertEqual(after.legal_reasoning, before.legal_reasoning)
        self.assertEqual(after.journey_plan, before.journey_plan)
        self.assertEqual(after.decision_scenario, before.decision_scenario)
        self.assertEqual(after.case_analysis, before.case_analysis)
        self.assertFalse(any(fact.key.startswith("clarification_") for fact in after.case_state.facts))
        self.assertFalse(any(
            record.kind == "fact" and record.text.startswith("clarification_")
            for record in after.evidence_context.user_reported
        ))

    def test_persisted_pipeline_removes_legacy_unanswered_clarification_fact(self) -> None:
        case = extract_case_state(
            "My landlord kept my deposit.",
            case_id="legacy-unanswered-clarification-case",
            source_id="initial-statement",
            created_at=RECORDED_AT,
        )
        case.initialStatement = "My landlord kept my deposit."
        question = build_clarification_questions(case, journey_unknowns=(), limit=None).next_question
        self.assertIsNotNone(question)
        assert question is not None
        legacy = apply_clarification_answer(case, question, "Pune")
        legacy.facts[-1].value = "Pata nahi"
        legacy.facts[-1].status = "unknown"
        legacy.facts[-1].confidence = "unknown"
        legacy.jurisdiction = Jurisdiction()
        legacy.unknowns = []

        result = run_persisted_case_pipeline(
            legacy,
            legal_knowledge_repository=InMemoryLegalKnowledgeStore(),
        )

        self.assertFalse(any(fact.id.startswith("clarification_fact_") for fact in result.case_state.facts))
        self.assertFalse(any(item.type == "clarification_response" for item in result.case_state.evidence))
        self.assertTrue(any("location" in item.casefold() for item in result.case_state.unknowns))
        self.assertIn(question.id, result.case_state.skippedClarificationIds)

    def test_existing_landlord_consumer_employment_and_safety_fixtures(self) -> None:
        fixture_names = (
            "housing_security_deposit",
            "damaged_product_refund",
            "unpaid_salary",
            "threatening_messages",
            "workplace_harassment",
        )
        for name in fixture_names:
            with self.subTest(fixture=name):
                fixture, result = self._run_fixture(name)
                expected = fixture["expected"]
                self.assertEqual(
                    {item.category for item in result.case_state.legalIssues},
                    set(expected["issue_categories"]),
                )
                self.assertEqual(
                    {(item.role, item.name) for item in result.case_state.parties},
                    {(item["role"], item["name"]) for item in expected["parties"]},
                )
                self.assertEqual(
                    {item.type for item in result.case_state.events},
                    set(expected["event_types"]),
                )
                recorded_unknowns = " ".join(result.case_state.unknowns).casefold()
                for fragment in expected["unknowns"]:
                    self.assertIn(fragment.casefold(), recorded_unknowns)
                self.assertEqual(result.safety_result.context.value, expected["safety_state"]["context"])
                self.assertEqual(result.safety_result.urgency.value, expected["safety_state"]["urgency"])
                observed_indicators = {
                    item.category
                    for item in result.safety_result.trigger_evidence
                    if item.origin == "narrative"
                }
                self.assertTrue(set(expected["safety_state"]["indicator_categories"]) <= observed_indicators)
                self.assertEqual(result.document_findings, ())
                self.assertEqual(result.legal_knowledge.records, ())
                self.assertEqual(result.legal_reasoning.legal_knowledge_status, "unavailable")
                self.assertEqual(result.analysis_timeline.case_id, result.case_state.id)

    def test_user_reports_inferences_unknowns_and_allegations_keep_their_status(self) -> None:
        _, landlord = self._run_fixture("housing_security_deposit")
        amount = next(item for item in landlord.case_state.facts if item.key == "amount_inr")
        self.assertEqual(amount.status, "system_inferred")
        self.assertTrue(any(item.id == amount.id for item in landlord.evidence_context.inferred))
        self.assertTrue(landlord.evidence_context.user_reported)
        self.assertTrue(landlord.evidence_context.unknown)
        self.assertFalse(landlord.evidence_context.evidence_supported)

        _, workplace = self._run_fixture("workplace_harassment")
        self.assertTrue(any(
            item.key == "statement" and item.status == "user_reported"
            for item in workplace.case_state.facts
        ))
        self.assertTrue(all(item.status == "user_reported" for item in workplace.case_state.claims))
        self.assertFalse(workplace.evidence_context.evidence_supported)
        self.assertTrue(any(
            reference.status == "user_reported"
            for finding in workplace.legal_reasoning.user_reported_findings
            for reference in finding.source_references
        ))

    def test_pipeline_runs_stages_in_order_and_injected_functions_are_used(self) -> None:
        calls: list[str] = []
        defaults = CasePipelineDependencies()

        def tapped(name, function):
            def run(*args, **kwargs):
                calls.append(name)
                return function(*args, **kwargs)
            return run

        dependencies = replace(
            defaults,
            case_state_extractor=tapped("case_state", extract_case_state),
            evidence_context_builder=tapped("context", build_evidence_context),
            safety_assessor=tapped("safety", _assess_safety),
            legal_knowledge_retriever=tapped("knowledge", retrieve_legal_knowledge),
            legal_reasoner=tapped("reasoning", reason_about_case),
            journey_builder=tapped("journey", _build_journey_with_safety),
            journey_executor=tapped("execution", create_execution),
            analysis_timeline_builder=tapped("timeline", build_analysis_timeline),
        )
        result = run_case_pipeline(make_request("My landlord kept my deposit."), dependencies=dependencies)

        self.assertEqual(calls, ["case_state", "context", "safety", "knowledge", "reasoning", "journey", "execution", "timeline"])
        self.assertEqual(
            result.stage_order,
            (
                "USER_INPUT",
                "CASE_STATE",
                "EVIDENCE_CONTEXT",
                "SAFETY_SUPPORT",
                "LEGAL_KNOWLEDGE_RETRIEVAL",
                "LEGAL_REASONING",
                "JOURNEY_PLANNING",
                "JOURNEY_EXECUTION",
                "ANALYSIS_TIMELINE",
            ),
        )

    def test_unconfirmed_document_extraction_stays_pending_while_review_shows_conflicts(self) -> None:
        statement = "My landlord withheld my ₹30,000 security deposit."
        document = CasePipelineDocument(
            filename="rent.pdf",
            content=make_pdf(["Rent deposit: INR 20,000 on March 4, 2025."]),
        )
        request = make_request(statement, documents=(document,))
        calls: list[str] = []
        defaults = CasePipelineDependencies()

        def process(data: bytes, filename: str, document_id: str):
            calls.append("process")
            return _process_document_deterministically(data, filename, document_id)

        def integrate(case_state, document_result):
            calls.append("integrate")
            return integrate_document_evidence(case_state, document_result)

        first = run_case_pipeline(request, dependencies=replace(
            defaults,
            document_processor=process,
            document_integrator=integrate,
        ))
        second = run_case_pipeline(request)

        self.assertEqual(calls, ["process", "integrate"])
        self.assertEqual(first.to_json(), second.to_json())
        self.assertEqual(first.stage_order[3:6], (
            "DOCUMENT_INTELLIGENCE",
            "EVIDENCE_CONTEXT_REFRESH",
            "SAFETY_SUPPORT",
        ))
        self.assertEqual(len(first.document_findings), 1)
        result = first.document_findings[0]
        self.assertEqual(result.metadata.processing_timestamp, RECORDED_AT)
        self.assertTrue(result.evidence)
        review = review_document(result, first.case_state)
        amount = next(item for item in review.findings if item.category == "amount" and item.nature == "extraction")
        self.assertEqual(amount.status, "extracted")
        self.assertEqual(amount.provenance[0].document_id, result.document_id)
        self.assertEqual(amount.provenance[0].page_number, 1)
        self.assertTrue(review.conflicts)
        self.assertFalse(any(
            source.documentId == result.document_id
            for fact in first.case_state.facts
            for source in fact.provenance
        ))
        document_evidence = next(item for item in first.case_state.evidence if item.documentId == result.document_id)
        self.assertEqual(document_evidence.status, "unknown")
        self.assertEqual(document_evidence.extractedFacts, [])
        self.assertFalse(first.evidence_context.conflicting)
        self.assertFalse(any(item.reason_codes == ("CONFLICT_UNRESOLVED",) for item in first.legal_reasoning.conflicts))
        self.assertTrue(any(item.source_type == "document" and item.page_number == 1 for item in first.provenance))
        self.assertEqual(first.case_state.documents[0].sha256, result.metadata.sha256)
        self.assertEqual(first.case_state.metadata.updatedAt, RECORDED_AT)

    def test_all_six_information_statuses_remain_separate(self) -> None:
        defaults = CasePipelineDependencies()

        def extractor(text: str, **kwargs):
            case_state = extract_case_state(text, **kwargs)
            case_state.assumptions.append("Test assumption remains unverified.")
            case_state.facts.append(CaseFact(
                id="confirmed-document-fact",
                key="confirmed_document_field",
                value="confirmed value",
                status="evidence_supported",
                confidence="high",
                sourceIds=["confirmed-document-evidence"],
                provenance=[EvidenceProvenance(
                    documentId="confirmed-test-document",
                    pageNumber=1,
                    confidence=0.9,
                    status="evidence_supported",
                    extractionMethod="test-fixture",
                    confirmedByUser=True,
                    confirmedAt=RECORDED_AT,
                )],
            ))
            case_state.evidence.append(EvidenceItem(
                id="confirmed-document-evidence",
                type="test-document",
                title="User-confirmed test document",
                source="document",
                status="evidence_supported",
                documentId="confirmed-test-document",
                extractedFacts=["confirmed-document-fact"],
                processingStatus="extracted",
            ))
            case_state.conflicts.append("A separately recorded conflict remains unresolved.")
            return case_state

        request = make_request(
            "My landlord withheld my ₹30,000 security deposit.",
            documents=(CasePipelineDocument(
                filename="rent.pdf",
                content=make_pdf(["Rent deposit: INR 20,000 on March 4, 2025."]),
            ),),
        )
        result = run_case_pipeline(request, dependencies=replace(defaults, case_state_extractor=extractor))

        groups = (
            result.evidence_context.user_reported,
            result.evidence_context.evidence_supported,
            result.evidence_context.inferred,
            result.evidence_context.assumptions,
            result.evidence_context.unknown,
            result.evidence_context.conflicting,
        )
        self.assertTrue(all(groups))
        self.assertTrue(any(item.status == "user_reported" for item in groups[0]))
        self.assertTrue(any(item.status == "evidence_supported" for item in groups[1]))
        self.assertTrue(any(item.status == "system_inferred" for item in groups[2]))
        self.assertTrue(all(item.status == "assumption" for item in groups[3]))
        self.assertTrue(all(item.status == "unknown" for item in groups[4]))
        self.assertTrue(any(item.status == "conflicting" for item in groups[5]))
        self.assertTrue(any("Test assumption" in item.text for item in groups[3]))

    def test_scan_without_local_ocr_stays_unknown_without_fabricated_text_or_evidence(self) -> None:
        scan = CasePipelineDocument(
            filename="scan.png",
            content=b"\x89PNG\r\n\x1a\nfixture image bytes",
        )
        result = run_case_pipeline(make_request("My employer owes my salary.", documents=(scan,)))

        finding = result.document_findings[0]
        self.assertEqual(finding.status.value, "ocr_required")
        self.assertEqual(finding.pages[0].text, "")
        self.assertEqual(finding.evidence, ())
        self.assertEqual(result.case_state.documents[0].processingStatus, "ocr_required")
        document_evidence = next(item for item in result.case_state.evidence if item.documentId == finding.document_id)
        self.assertEqual(document_evidence.status, "unknown")
        self.assertEqual(document_evidence.extractedFacts, [])

    def test_unreadable_supported_document_is_reported_as_failed_without_extracted_evidence(self) -> None:
        broken_pdf = CasePipelineDocument(
            filename="broken.pdf",
            content=b"%PDF-1.4\nnot an object",
        )
        result = run_case_pipeline(make_request("A statement about a dispute.", documents=(broken_pdf,)))

        finding = result.document_findings[0]
        self.assertEqual(finding.status.value, "failed")
        self.assertEqual(finding.evidence, ())
        self.assertTrue(finding.errors)
        self.assertEqual(result.case_state.documents[0].processingStatus, "failed")
        evidence = next(item for item in result.case_state.evidence if item.documentId == finding.document_id)
        self.assertEqual(evidence.status, "unknown")

    def test_immediate_danger_blocks_ordinary_actions_and_safety_actions_are_prioritized(self) -> None:
        result = run_case_pipeline(make_request(
            "My employer has not paid my salary.",
            immediate_danger="yes",
        ))

        self.assertFalse(result.safety_result.legal_workflow_allowed)
        self.assertEqual(result.safety_result.workflow_disposition.value, "safety_first")
        self.assertTrue(any(item.code == "safety_first_workflow" for item in result.blockers))
        self.assertTrue(result.next_actions)
        self.assertTrue(all(item.source == "safety_support" for item in result.next_actions))
        self.assertIn("immediate_danger", {item.source_id for item in result.provenance})

    def test_empty_knowledge_does_not_create_law_procedures_or_outcome_predictions(self) -> None:
        _, result = self._run_fixture("damaged_product_refund")

        self.assertEqual(result.legal_knowledge.records, ())
        self.assertEqual(result.legal_reasoning.grounded_legal_statements, ())
        self.assertEqual(result.legal_reasoning.possible_procedural_paths, ())
        self.assertTrue(any(
            item.subject == "court_or_decision_maker_outcome"
            and "No court or decision-maker outcome is predicted" in item.explanation
            for item in result.legal_reasoning.blocked_conclusions
        ))

    def test_default_pipeline_retrieves_seeded_official_material_by_issue(self) -> None:
        cases = (
            ("My landlord kept my security deposit.", "housing", "provision-uttarakhand-tenancy-act-2021-section-11-security-deposit"),
            ("I bought a phone from a seller. It arrived damaged, and the seller refused my refund.", "consumer", "provision-consumer-protection-2019-section-39-1-c"),
            ("My employer has not paid my salary.", "employment", "provision-code-on-wages-2019-section-17"),
            ("My supervisor repeatedly sent unwanted sexual messages at work.", "workplace_harassment", "provision-posh-2013-section-9"),
            ("My husband threatens me at home.", "family", "provision-domestic-violence-2005-section-18"),
        )
        for statement, category, provision_id in cases:
            with self.subTest(category=category):
                result = run_case_pipeline(make_request(statement))
                issue_categories = {item.category for item in result.case_state.legalIssues}
                self.assertIn(category, issue_categories)
                records = {item.id: item for item in result.legal_knowledge.records}
                self.assertIn(provision_id, records)
                self.assertTrue(records[provision_id].provenance)
                self.assertIsNotNone(records[provision_id].source_url)

    def test_matching_local_legal_record_is_retrieved_with_its_original_text_and_provenance(self) -> None:
        authority = Authority(id="authority-consumer", title="Fixture authority", status=KnowledgeStatus.VERIFIED)
        jurisdiction = KnowledgeJurisdiction(
            id="jurisdiction-fixture",
            title="Fixture jurisdiction",
            country="Fixture country",
            state="Fixture state",
            district="Fixture district",
            jurisdiction_basis="Test fixture",
            status=KnowledgeStatus.VERIFIED,
            provenance=(SourceReference(
                source_id="source-consumer",
                page_section_reference="fixture jurisdiction entry",
                retrieval_time=RETRIEVED_AT,
            ),),
        )
        source = LegalSource(
            id="source-consumer",
            title="Fixture source",
            authority=authority.id,
            authority_tier=SourceAuthorityTier.TIER_1_PRIMARY_OFFICIAL,
        )
        document = LegalDocument(
            id="document-consumer",
            title="Fixture document",
            jurisdiction=jurisdiction.id,
            authority=authority.id,
            source=source.id,
            version="fixture-v1",
            status=KnowledgeStatus.VERIFIED,
            provenance=(SourceReference(
                source_id=source.id,
                document_id="document-consumer",
                page_section_reference="fixture document",
                retrieval_time=RETRIEVED_AT,
            ),),
        )
        provision_text = "Test-only source statement: this record concerns consumer refunds."
        provision = LegalProvision(
            id="provision-consumer",
            title="Consumer fixture provision",
            jurisdiction=jurisdiction.id,
            authority=authority.id,
            source=source.id,
            version="fixture-v1",
            document_id=document.id,
            provision_reference="fixture section",
            text=provision_text,
            search_text="consumer refund fixture",
            status=KnowledgeStatus.VERIFIED,
            provenance=(SourceReference(
                source_id=source.id,
                document_id=document.id,
                provision_id="provision-consumer",
                page_section_reference="fixture section",
                retrieval_time=RETRIEVED_AT,
            ),),
        )
        relation = KnowledgeRelationship(
            subject_id=provision.id,
            relationship=RelationshipType.PROVISION_ADDRESSES_ISSUE,
            object_id="consumer",
            provenance=(SourceReference(
                source_id=source.id,
                provision_id=provision.id,
                page_section_reference="fixture issue index",
                retrieval_time=RETRIEVED_AT,
            ),),
        )
        repository = InMemoryLegalKnowledgeStore()
        repository.add_many((authority, jurisdiction, source, document, provision))
        repository.add_relationship(relation)

        result = run_case_pipeline(
            make_request("I bought a phone from a seller. It arrived damaged, and the seller refused my refund."),
            legal_knowledge_repository=repository,
        )

        self.assertIn(provision.id, {item.id for item in result.legal_knowledge.records})
        statement = next(item for item in result.legal_reasoning.grounded_legal_statements if item.record_id == provision.id)
        self.assertEqual(statement.text, provision_text)
        self.assertTrue(any(ref.source_id == source.id for ref in statement.source_references))
        self.assertIn("JURISDICTION_UNKNOWN", statement.reason_codes)

    def test_analysis_timeline_preserves_report_status_and_timeline_provenance(self) -> None:
        _, result = self._run_fixture("threatening_messages")

        self.assertTrue(result.analysis_timeline.timeline)
        event = result.analysis_timeline.timeline[0]
        self.assertEqual(event.status, InformationStatus.USER_REPORTED.value)
        self.assertTrue(event.provenance)
        user_source_id = result.case_state.evidence[0].id
        self.assertTrue(any(item.source_id == user_source_id for item in event.provenance))
        self.assertEqual(result.analysis_timeline.snapshot.case_id, result.case_state.id)
        self.assertTrue(result.analysis_timeline.snapshot.limitations)

    def test_invalid_input_is_rejected_before_any_stage_runs(self) -> None:
        with self.assertRaises(ValueError):
            run_case_pipeline(make_request("  "))
        with self.assertRaises(ValueError):
            run_case_pipeline(replace(make_request("A statement."), recorded_at="not-a-date"))
        with self.assertRaises(ValueError):
            run_case_pipeline(make_request(
                "A statement.",
                documents=(
                    CasePipelineDocument("one.pdf", b"%PDF-1.4", "same"),
                    CasePipelineDocument("two.pdf", b"%PDF-1.4", "same"),
                ),
            ))


if __name__ == "__main__":
    unittest.main()
