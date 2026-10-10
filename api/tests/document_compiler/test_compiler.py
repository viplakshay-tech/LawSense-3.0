from __future__ import annotations

import unittest

from app.engines.document_compiler.compiler import (
    case_fingerprint,
    confirm_document_draft,
    create_document_draft,
    create_document_package,
    edit_document_draft,
    mark_stale,
    prepare_export,
)
from app.engines.document_compiler.models import DocumentFieldStatus, DocumentReviewState
from app.schemas.case_state import (
    CaseDocument,
    CaseDocumentPage,
    CaseEvent,
    CaseFact,
    CaseMetadata,
    CasePerson,
    CaseState,
    EvidenceItem,
    EvidenceProvenance,
    Jurisdiction,
)
from app.schemas.case_analysis import (
    CaseAnalysis,
    JourneySummary,
    LegalKnowledgeRecordSummary,
    LegalKnowledgeSummary,
    SafetyContextSummary,
)


def make_case() -> CaseState:
    return CaseState(
        id="document-case-1",
        initialStatement="My landlord has not returned my security deposit after I moved out.",
        person=CasePerson(name="Nora Applicant", contact="nora@example.test"),
        facts=[CaseFact(
            id="fact-deposit",
            key="deposit_amount",
            value="30000 INR",
            status="evidence_supported",
            confidence="high",
            sourceIds=["evidence-receipt"],
            provenance=[EvidenceProvenance(
                documentId="doc-receipt",
                pageNumber=1,
                confidence=0.93,
                status="evidence_supported",
                extractionMethod="pdf_text",
                confirmedByUser=True,
                confirmedAt="2026-10-08T10:00:00+00:00",
            )],
        )],
        events=[CaseEvent(
            id="event-payment",
            type="payment",
            description="The deposit was paid.",
            date="2025-02-10",
            datePrecision="exact",
            evidenceIds=["evidence-receipt"],
        )],
        evidence=[EvidenceItem(
            id="evidence-receipt",
            type="receipt",
            title="Deposit receipt",
            source="document",
            status="evidence_supported",
            documentId="doc-receipt",
        )],
        documents=[CaseDocument(
            id="doc-receipt",
            filename="deposit-receipt.pdf",
            mimeType="application/pdf",
            extension=".pdf",
            fileSize=640,
            sha256="a" * 64,
            pageCount=1,
            processingTimestamp="2026-10-08T09:00:00+00:00",
            processingStatus="extracted",
            classification="receipt",
            classificationConfidence=0.91,
            pages=[CaseDocumentPage(
                pageNumber=1,
                extractionMethod="pdf_text",
                processingStatus="extracted",
                textLength=50,
            )],
            reviewStatus="confirmed",
        )],
        jurisdiction=Jurisdiction(country="India", state="Uttarakhand", basis="user_reported"),
        metadata=CaseMetadata(createdAt="2026-01-01T00:00:00+00:00", updatedAt="2026-10-08T10:00:00+00:00"),
    )


class DocumentCompilerTests(unittest.TestCase):
    def test_material_fact_has_evidence_and_page_provenance_in_field_and_document(self) -> None:
        draft = create_document_draft(make_case(), "formal-demand-representation")

        amount = draft.fields["deposit_amount"]
        self.assertEqual(amount.value, "30000 INR")
        self.assertEqual(amount.status, DocumentFieldStatus.EVIDENCE_SUPPORTED)
        self.assertEqual(amount.sourceFactIds, ["fact-deposit"])
        self.assertEqual(amount.sourceEvidenceIds, ["evidence-receipt"])
        self.assertEqual(amount.provenance[0].sourceId, "evidence-receipt")
        self.assertEqual(amount.provenance[1].documentId, "doc-receipt")
        self.assertEqual(amount.provenance[1].pageNumber, 1)
        self.assertIn("[F:deposit_amount]", draft.content)
        self.assertTrue(any(item.factId == "fact-deposit" and item.fieldId == "deposit_amount" for item in draft.factMappings))

    def test_missing_required_values_are_marked_without_fabricating_facts(self) -> None:
        draft = create_document_draft(make_case(), "complaint-draft")

        self.assertEqual(draft.fields["document_date"].status, DocumentFieldStatus.MISSING)
        self.assertEqual(draft.fields["document_date"].missingMarker, "[MISSING INFORMATION: Date]")
        self.assertIn("[MISSING INFORMATION: Date]", draft.content)
        self.assertIn("[MISSING INFORMATION: Recipient name or office]", draft.content)
        self.assertNotIn("2026-10-09", draft.content)
        self.assertIn("[MISSING INFORMATION: Requested action]", draft.content)

    def test_competing_case_facts_are_preserved_as_conflict_without_selection(self) -> None:
        case_state = make_case()
        case_state.facts.extend([
            CaseFact(id="fact-amount-a", key="refund_amount", value="10000", status="user_reported", confidence="medium", sourceIds=["evidence-receipt"]),
            CaseFact(id="fact-amount-b", key="claim_amount", value="12000", status="user_reported", confidence="medium", sourceIds=["evidence-receipt"]),
        ])

        draft = create_document_draft(case_state, "complaint-draft")
        field = draft.fields["claimed_amount"]

        self.assertEqual(field.status, DocumentFieldStatus.CONFLICTING)
        self.assertIsNone(field.value)
        self.assertEqual({item.value for item in field.conflicts}, {"10000", "12000"})
        self.assertEqual({item.sourceFactIds[0] for item in field.conflicts}, {"fact-amount-a", "fact-amount-b"})
        self.assertIn("[CONFLICT: Claimed amount has competing recorded values]", draft.content)
        self.assertTrue(any(item.fieldId == "claimed_amount" for item in draft.conflicts))

    def test_conflicts_block_export_even_after_user_review(self) -> None:
        case_state = make_case()
        case_state.facts.extend([
            CaseFact(id="fact-amount-a", key="refund_amount", value="10000", status="user_reported", confidence="medium", sourceIds=["evidence-receipt"]),
            CaseFact(id="fact-amount-b", key="claim_amount", value="12000", status="user_reported", confidence="medium", sourceIds=["evidence-receipt"]),
        ])
        draft = create_document_draft(case_state, "complaint-draft")
        reviewed = confirm_document_draft(draft, case_state, acknowledge_missing_information=True)

        export_document = prepare_export(reviewed, case_state)

        self.assertEqual(export_document.status, "blocked")
        self.assertTrue(any("conflicts" in item for item in export_document.blockers))

    def test_selecting_one_competing_value_does_not_silently_resolve_conflict(self) -> None:
        case_state = make_case()
        case_state.facts.extend([
            CaseFact(id="fact-amount-a", key="refund_amount", value="10000", status="user_reported", confidence="medium", sourceIds=["evidence-receipt"]),
            CaseFact(id="fact-amount-b", key="claim_amount", value="12000", status="user_reported", confidence="medium", sourceIds=["evidence-receipt"]),
        ])

        draft = create_document_draft(case_state, "complaint-draft", included_fact_ids=["fact-amount-a"])

        field = draft.fields["claimed_amount"]
        self.assertEqual(field.status, DocumentFieldStatus.CONFLICTING)
        self.assertIsNone(field.value)
        self.assertEqual({item.value for item in field.conflicts}, {"10000", "12000"})
        reviewed = confirm_document_draft(draft, case_state, acknowledge_missing_information=True)
        self.assertEqual(prepare_export(reviewed, case_state).status, "blocked")

    def test_selected_competing_fallback_facts_stay_conflicted_in_templates_without_direct_field(self) -> None:
        case_state = make_case()
        case_state.facts.extend([
            CaseFact(id="fact-amount-a", key="refund_amount", value="10000", status="user_reported", confidence="medium", sourceIds=["evidence-receipt"]),
            CaseFact(id="fact-amount-b", key="claim_amount", value="12000", status="user_reported", confidence="medium", sourceIds=["evidence-receipt"]),
        ])

        draft = create_document_draft(case_state, "evidence-index", included_fact_ids=["fact-amount-a"])

        field = draft.fields["selected_case_facts"]
        self.assertEqual(field.status, DocumentFieldStatus.CONFLICTING)
        self.assertIsNone(field.value)
        self.assertEqual({item.value for item in field.conflicts}, {"10000", "12000"})
        self.assertIn("fact-amount-b", field.sourceFactIds)
        self.assertEqual(prepare_export(
            confirm_document_draft(draft, case_state, acknowledge_missing_information=True),
            case_state,
        ).status, "blocked")

    def test_selected_fact_edits_are_exact_and_keep_original_provenance(self) -> None:
        draft = create_document_draft(
            make_case(),
            "evidence-index",
            included_fact_ids=["fact-deposit"],
            fact_edits={"fact-deposit": "Reviewed wording: 31,000 INR"},
        )
        field = draft.fields["selected_case_facts"]

        self.assertEqual(field.value, "Deposit amount: Reviewed wording: 31,000 INR")
        self.assertEqual(field.sourceFactIds, ["fact-deposit"])
        self.assertIn("evidence-receipt", field.sourceEvidenceIds)
        self.assertTrue(any(item.sourceType == "document" and item.pageNumber == 1 for item in field.provenance))
        self.assertTrue(any(item.sourceType == "user_edit" and item.sourceId == "case-fact-edit:fact-deposit" for item in field.provenance))
        self.assertIn("Reviewed wording: 31,000 INR", draft.content)
        self.assertNotIn("30000 INR", draft.content)
        self.assertTrue(all(item.factId == "fact-deposit" for item in draft.factMappings))

    def test_selected_unmapped_fact_is_not_dropped_or_mixed_into_narrative(self) -> None:
        case_state = make_case()
        case_state.facts.append(CaseFact(
            id="fact-custom-detail", key="move_out_condition", value="The unit was clean.",
            status="evidence_supported", confidence="high", sourceIds=["evidence-receipt"],
        ))
        draft = create_document_draft(
            case_state,
            "formal-demand-representation",
            included_fact_ids=["fact-custom-detail"],
            fact_edits={"fact-custom-detail": "The move-out inspection described the unit as clean."},
        )

        field = draft.fields["selected_case_facts"]
        self.assertIn("The move-out inspection described the unit as clean.", field.value or "")
        self.assertEqual(field.sourceFactIds, ["fact-custom-detail"])
        self.assertEqual(draft.fields["case_narrative"].value, None)
        self.assertTrue(any(item.factId == "fact-custom-detail" for item in draft.factMappings))

    def test_fact_without_evidence_is_flagged_and_blocks_export(self) -> None:
        case_state = make_case()
        case_state.facts.append(CaseFact(
            id="fact-unlinked-amount",
            key="claim_amount",
            value="50000",
            status="user_reported",
            confidence="medium",
        ))
        draft = create_document_draft(case_state, "complaint-draft")
        amount = draft.fields["claimed_amount"]

        self.assertEqual(amount.status, DocumentFieldStatus.UNSUPPORTED)
        self.assertIn("claimed_amount", draft.unsupportedMaterialFactIds)
        self.assertIn("[UNSUPPORTED MATERIAL FACT", draft.content)
        confirmed = confirm_document_draft(draft, case_state, acknowledge_missing_information=True)
        export_document = prepare_export(confirmed, case_state)
        self.assertEqual(export_document.status, "blocked")
        self.assertTrue(any("supporting evidence" in item for item in export_document.blockers))

    def test_stale_draft_is_detected_and_cannot_be_confirmed_or_exported(self) -> None:
        case_state = make_case()
        draft = create_document_draft(case_state, "evidence-index")
        changed_case = case_state.model_copy(update={"title": "Updated title"})

        stale = mark_stale(draft, changed_case)
        self.assertEqual(stale.reviewState, DocumentReviewState.STALE)
        self.assertNotEqual(case_fingerprint(case_state), case_fingerprint(changed_case))
        with self.assertRaisesRegex(ValueError, "case changed"):
            confirm_document_draft(stale, changed_case, acknowledge_missing_information=True)
        self.assertEqual(prepare_export(stale, changed_case).status, "blocked")

    def test_user_confirmation_is_required_and_missing_information_acknowledgement_is_explicit(self) -> None:
        case_state = make_case()
        draft = create_document_draft(case_state, "complaint-draft")
        with self.assertRaisesRegex(ValueError, "explicitly acknowledge"):
            confirm_document_draft(draft, case_state, acknowledge_missing_information=False)

        confirmed = confirm_document_draft(draft, case_state, acknowledge_missing_information=True)
        self.assertEqual(confirmed.reviewState, DocumentReviewState.REVIEWED)
        self.assertTrue(confirmed.confirmedAt)
        self.assertTrue(confirmed.missingInformationAcknowledged)
        self.assertEqual(prepare_export(confirmed, case_state).status, "ready")

    def test_edits_revoke_confirmation_and_keep_user_edit_provenance(self) -> None:
        case_state = make_case()
        draft = create_document_draft(case_state, "evidence-index")
        confirmed = confirm_document_draft(draft, case_state, acknowledge_missing_information=False)

        edited = edit_document_draft(
            confirmed,
            case_state,
            field_values={"evidence_items": "Deposit receipt · reviewed by me"},
            legal_source_ids={},
        )

        self.assertEqual(edited.reviewState, DocumentReviewState.DRAFT)
        self.assertIsNone(edited.confirmedAt)
        self.assertEqual(edited.fields["evidence_items"].status, DocumentFieldStatus.USER_AUTHORED)
        self.assertTrue(any(item.sourceType == "user_edit" for item in edited.fields["evidence_items"].provenance))
        self.assertEqual(prepare_export(edited, case_state).status, "blocked")

    def test_document_package_contains_all_seven_initial_types_from_one_case_snapshot(self) -> None:
        package = create_document_package(make_case())

        self.assertEqual(len(package.documents), 7)
        self.assertEqual(len({item.templateId for item in package.documents}), 7)
        self.assertTrue(all(item.sourceCaseFingerprint == package.sourceCaseFingerprint for item in package.documents))
        self.assertEqual(
            {item.documentType.value for item in package.documents},
            {
                "formal_demand_representation", "complaint_draft", "grievance_application",
                "notice_response", "supporting_statement_chronology", "evidence_index", "filing_checklist",
            },
        )

    def test_legal_wording_requires_traceable_verified_legal_source(self) -> None:
        case_state = make_case()
        with self.assertRaisesRegex(ValueError, "verified legal source"):
            create_document_draft(
                case_state,
                "complaint-draft",
                field_values={"legal_text": "A provision applies."},
            )

    def test_legal_wording_keeps_verified_source_provenance(self) -> None:
        case_state = make_case()
        case_state.analysis = CaseAnalysis(
            safetyContext=SafetyContextSummary(context="none", confidence="high", urgency="none"),
            legalKnowledge=LegalKnowledgeSummary(status="records_found", records=[LegalKnowledgeRecordSummary(
                id="legal-source-1",
                title="Official Act source",
                type="legal_document",
                status="verified",
                reference="Act No. 12 of 2025, section 4",
                sourceUrl="https://example.gov/act",
                sourceVerificationStatus="verified",
            )]),
            journey=JourneySummary(
                id="journey-1",
                caseId=case_state.id,
                currentSituation="Recorded dispute",
                jurisdictionStatus="known",
                legalKnowledgeStatus="available",
            ),
        )

        draft = create_document_draft(
            case_state,
            "complaint-draft",
            field_values={"legal_text": "User-supplied wording referring to section 4."},
            legal_source_ids={"legal_text": "legal-source-1"},
        )
        legal_field = draft.fields["legal_text"]
        provenance = next(item for item in legal_field.provenance if item.sourceType == "legal_source")

        self.assertEqual(legal_field.value, "User-supplied wording referring to section 4.")
        self.assertEqual(provenance.sourceId, "legal-source-1")
        self.assertEqual(provenance.reference, "Act No. 12 of 2025, section 4")
        self.assertEqual(provenance.sourceUrl, "https://example.gov/act")

    def test_user_selected_facts_are_the_only_case_facts_mapped(self) -> None:
        draft = create_document_draft(
            make_case(),
            "formal-demand-representation",
            included_fact_ids=["initial-statement"],
        )

        self.assertIsNone(draft.fields["deposit_amount"].value)
        self.assertEqual(draft.fields["case_narrative"].value, "My landlord has not returned my security deposit after I moved out.")
        self.assertEqual([item.factId for item in draft.factMappings], ["initialStatement"])


if __name__ == "__main__":
    unittest.main()

