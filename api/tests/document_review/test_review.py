from __future__ import annotations

import unittest

from app.engines.document_intelligence.models import (
    Classification,
    DocumentMetadata,
    DocumentProcessingStatus,
    DocumentResult,
    Evidence,
    EvidenceStatus,
    PageText,
)
from app.engines.document_review import review_document
from app.schemas.case_state import (
    CaseEvent,
    CaseFact,
    CaseMetadata,
    CaseState,
    Party,
)


def make_result(
    pages: list[PageText],
    evidence: list[Evidence] | None = None,
    *,
    category: str = "rent_agreement",
    signals: tuple[str, ...] = ("rent agreement",),
    status: DocumentProcessingStatus = DocumentProcessingStatus.EXTRACTED,
    errors: tuple[str, ...] = (),
) -> DocumentResult:
    return DocumentResult(
        document_id="doc-review-1",
        metadata=DocumentMetadata(
            filename="agreement.pdf",
            mime_type="application/pdf",
            extension=".pdf",
            file_size=100,
            page_count=len(pages),
            sha256="a" * 64,
            processing_timestamp="2026-10-08T00:00:00+00:00",
        ),
        classification=Classification(category, 0.74, signals),
        pages=tuple(pages),
        evidence=tuple(evidence or ()),
        status=status,
        errors=errors,
    )


def case_state(
    *,
    amount: int | None = None,
    event_date: str | None = None,
    landlord: str | None = None,
) -> CaseState:
    facts = []
    if amount is not None:
        facts.append(
            CaseFact(
                id="fact-amount", key="amount_inr", value=amount,
                status="user_reported", confidence="medium",
            )
        )
    events = []
    if event_date is not None:
        events.append(
            CaseEvent(
                id="event-date", type="agreement", description="Agreement date reported.",
                date=event_date, datePrecision="exact",
            )
        )
    parties = [Party(id="party-landlord", role="landlord", name=landlord)] if landlord else []
    return CaseState(
        id="case-1",
        facts=facts,
        events=events,
        parties=parties,
        metadata=CaseMetadata(createdAt="2026-10-08T00:00:00Z", updatedAt="2026-10-08T00:00:00Z"),
    )


class DocumentReviewTests(unittest.TestCase):
    def test_reuses_upstream_amount_and_date_evidence(self) -> None:
        text = "RENT AGREEMENT\nRent: INR 30,000 per month. Dated March 4, 2025."
        evidence = [
            Evidence(
                document_id="doc-review-1", page_number=1, text="Rent: INR 30,000 per month.",
                field="amount", value="30000", confidence=0.88, source="document",
                status=EvidenceStatus.EVIDENCE_SUPPORTED, extraction_method="pypdf",
            ),
            Evidence(
                document_id="doc-review-1", page_number=1, text="Dated March 4, 2025.",
                field="date", value="March 4, 2025", confidence=0.86, source="document",
                status=EvidenceStatus.EVIDENCE_SUPPORTED, extraction_method="pypdf",
            ),
        ]
        review = review_document(
            make_result([PageText(1, text, "pypdf")], evidence),
        )

        amount = next(item for item in review.findings if item.category == "amount")
        date = next(item for item in review.findings if item.category == "date")
        self.assertEqual(amount.value, "30000")
        self.assertEqual(amount.confidence, 0.88)
        self.assertEqual(amount.provenance[0].extraction_method, "pypdf")
        self.assertEqual(amount.upstream_status, EvidenceStatus.EVIDENCE_SUPPORTED.value)
        self.assertEqual(amount.provenance[0].page_number, 1)
        self.assertEqual(amount.provenance[0].location.start, text.index("Rent:"))
        self.assertEqual(date.value, "March 4, 2025")
        self.assertEqual(date.nature, "extraction")
        self.assertEqual(review.document_type.value, "rent_agreement")
        self.assertEqual(review.document_type.nature, "interpretation")

    def test_extracts_parties_identifiers_clauses_obligations_notices_terms_and_evidence_candidates(self) -> None:
        text = (
            "RENT AGREEMENT\n"
            "Landlord: Mira Shah\nTenant: Kiran Das\n"
            "Between Kiran Das and Mira Shah.\n"
            "Case No: CV-2025-17.\n"
            "Clause 2: Tenant shall pay rent on time.\n"
            "A written notice period of 30 days applies.\n"
            "Security deposit is refundable. Signed by both witnesses; bank statement attached."
        )
        review = review_document(make_result([PageText(1, text, "pypdf")]))
        categories = {item.category for item in review.findings}

        self.assertIn("party", categories)
        self.assertIn("identifier", categories)
        self.assertIn("clause", categories)
        self.assertIn("obligation", categories)
        self.assertIn("notice", categories)
        self.assertIn("important_term", categories)
        self.assertIn("evidence_candidate", categories)
        landlord = next(
            item for item in review.findings
            if item.category == "party" and item.value.get("role") == "landlord"
        )
        self.assertEqual(landlord.value["name"], "Mira Shah")
        self.assertEqual(landlord.nature, "extraction")
        self.assertEqual(landlord.provenance[0].page_number, 1)
        self.assertEqual(
            text[landlord.provenance[0].location.start:landlord.provenance[0].location.end],
            "Mira Shah",
        )
        obligation = next(item for item in review.findings if item.category == "obligation")
        self.assertEqual(obligation.nature, "interpretation")
        self.assertIn("shall pay", obligation.text)
        evidence_candidate = next(item for item in review.findings if item.category == "evidence_candidate")
        self.assertIn("does not verify", evidence_candidate.note)

    def test_every_finding_has_confidence_source_and_provenance(self) -> None:
        review = review_document(
            make_result([PageText(1, "RENT AGREEMENT\nRent: INR 900. Clause 1: Tenant shall pay.", "pypdf")])
        )
        self.assertTrue(review.findings)
        for finding in review.findings:
            with self.subTest(category=finding.category, value=finding.value):
                self.assertTrue(finding.source)
                self.assertTrue(finding.provenance)
                self.assertGreaterEqual(finding.confidence, 0.0)
                self.assertLessEqual(finding.confidence, 1.0)
                self.assertIn(finding.nature, {"extraction", "interpretation"})

    def test_reports_unknown_document_type_and_missing_fields_from_readable_text(self) -> None:
        review = review_document(
            make_result(
                [PageText(1, "An unlabelled paper with no recognizable review fields.", "pypdf")],
                category="unknown", signals=(),
            )
        )
        self.assertEqual(review.document_type.value, "unknown")
        self.assertEqual(review.document_type.status, "uncertain")
        gaps = [item for item in review.missing_or_uncertain if item.category == "extraction_gap"]
        self.assertTrue(gaps)
        self.assertTrue(any(item.value.get("category") == "party" for item in gaps))
        self.assertTrue(all("does not establish" in item.note for item in gaps))

    def test_ocr_required_page_remains_explicit_and_has_no_invented_page_text(self) -> None:
        result = make_result(
            [PageText(1, "", "none", DocumentProcessingStatus.OCR_REQUIRED)],
            category="unknown", signals=(), status=DocumentProcessingStatus.OCR_REQUIRED,
            errors=("Page 1: OCR is required for this page, but no local OCR backend is configured.",),
        )
        review = review_document(result)
        page_gap = next(
            item for item in review.missing_or_uncertain
            if item.category == "extraction_gap" and item.value.get("category") == "page_text"
        )
        self.assertEqual(page_gap.provenance[0].page_number, 1)
        self.assertIsNone(page_gap.provenance[0].text)
        self.assertIsNone(page_gap.text)
        self.assertEqual(review.processing_status, "ocr_required")
        self.assertEqual(review.errors, result.errors)
        self.assertFalse(any(item.category in {"party", "amount", "date", "clause"} for item in review.findings))

    def test_flags_single_comparable_amount_date_and_party_mismatches_as_potential(self) -> None:
        text = "RENT AGREEMENT\nLandlord: Mira Shah\nRent is INR 30,000. Dated March 4, 2025."
        evidence = [
            Evidence(
                document_id="doc-review-1", page_number=1, text="Rent is INR 30,000.",
                field="amount", value="30000", confidence=0.88, source="document",
                status=EvidenceStatus.EVIDENCE_SUPPORTED, extraction_method="pypdf",
            ),
            Evidence(
                document_id="doc-review-1", page_number=1, text="Dated March 4, 2025.",
                field="date", value="March 4, 2025", confidence=0.86, source="document",
                status=EvidenceStatus.EVIDENCE_SUPPORTED, extraction_method="pypdf",
            ),
        ]
        review = review_document(
            make_result([PageText(1, text, "pypdf")], evidence),
            case_state(amount=25000, event_date="2025-03-05", landlord="Mira Rao"),
        )
        conflicts = review.conflicts
        self.assertEqual({item.value["field"] for item in conflicts}, {"amount", "date", "party:landlord"})
        for conflict in conflicts:
            self.assertEqual(conflict.status, "potential_conflict")
            self.assertEqual(conflict.nature, "interpretation")
            self.assertIn("document", {item.source for item in conflict.provenance})
            self.assertIn("case_state", {item.source for item in conflict.provenance})
            self.assertTrue(any(item.page_number == 1 for item in conflict.provenance))

    def test_does_not_flag_matching_values_or_ambiguous_multiple_amounts_as_conflicts(self) -> None:
        text = "RENT AGREEMENT\nRent is INR 30,000. Deposit is INR 50,000."
        evidence = [
            Evidence(
                document_id="doc-review-1", page_number=1, text="Rent is INR 30,000.",
                field="amount", value="30000", confidence=0.88, source="document",
                status=EvidenceStatus.EVIDENCE_SUPPORTED, extraction_method="pypdf",
            ),
            Evidence(
                document_id="doc-review-1", page_number=1, text="Deposit is INR 50,000.",
                field="amount", value="50000", confidence=0.88, source="document",
                status=EvidenceStatus.EVIDENCE_SUPPORTED, extraction_method="pypdf",
            ),
        ]
        review = review_document(make_result([PageText(1, text, "pypdf")], evidence), case_state(amount=30000))
        self.assertEqual(review.conflicts, ())

    def test_ocr_gaps_do_not_create_extraction_gaps_for_unreadable_categories(self) -> None:
        result = make_result(
            [PageText(1, "", "none", DocumentProcessingStatus.OCR_REQUIRED)],
            category="unknown", signals=(), status=DocumentProcessingStatus.OCR_REQUIRED,
        )
        review = review_document(result)
        page_gap = next(
            item for item in review.missing_or_uncertain
            if item.category == "extraction_gap" and item.value.get("category") == "page_text"
        )
        self.assertEqual(page_gap.value["result"], "ocr_required")
        self.assertFalse(any("not_found_in_available_text" in str(item.value) for item in review.findings))

    def test_failed_page_is_reported_as_failed_not_as_an_ocr_gap(self) -> None:
        result = make_result(
            [PageText(1, "", "none", DocumentProcessingStatus.FAILED)],
            category="unknown", signals=(), status=DocumentProcessingStatus.FAILED,
            errors=("Page 1: Local extraction failed.",),
        )
        review = review_document(result)
        page_gap = next(
            item for item in review.missing_or_uncertain
            if item.category == "extraction_gap" and item.value.get("category") == "page_text"
        )
        self.assertEqual(page_gap.value["result"], "failed")
        self.assertIn("Local extraction failed", page_gap.note)

    def test_identifier_mismatch_is_reported_with_both_sources(self) -> None:
        text = "COURT CASE\nCase No: CV-2025-17."
        result = make_result(
            [PageText(1, text, "pypdf")], category="court_document", signals=("court",)
        )
        state = CaseState(
            id="case-1",
            facts=[CaseFact(
                id="fact-case-number", key="case_number", value="CV-2025-18",
                status="user_reported", confidence="medium",
            )],
            metadata=CaseMetadata(createdAt="2026-10-08T00:00:00Z", updatedAt="2026-10-08T00:00:00Z"),
        )
        review = review_document(result, state)
        conflict = next(item for item in review.conflicts if item.value["field"] == "identifier:case")
        self.assertEqual(conflict.value["document_value"], "CV-2025-17")
        self.assertEqual(conflict.value["case_state_value"], "CV-2025-18")
        self.assertEqual({item.source for item in conflict.provenance}, {"document", "case_state"})


if __name__ == "__main__":
    unittest.main()
