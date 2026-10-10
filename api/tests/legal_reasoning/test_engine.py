from __future__ import annotations

import unittest
from dataclasses import replace
from datetime import datetime, timezone

from app.engines.legal_knowledge import (
    Authority,
    Jurisdiction as KnowledgeJurisdiction,
    KnowledgeRelationship,
    KnowledgeStatus,
    LegalProcedure,
    LegalProvision,
    LegalRule,
    RelationshipType,
    SourceReference,
)
from app.engines.legal_reasoning import REASON_CODE_MESSAGES, reason_about_case
from app.schemas.case_state import (
    CaseClaim,
    CaseFact,
    CaseMetadata,
    CaseState,
    EvidenceItem,
    EvidenceProvenance,
    Jurisdiction,
    LegalIssue,
)


RETRIEVED_AT = datetime(2026, 4, 5, 10, 30, tzinfo=timezone.utc)


def make_case(*, known_jurisdiction: bool = True, conflicts: list[str] | None = None) -> CaseState:
    return CaseState(
        id="case-reasoning-fixture",
        facts=[
            CaseFact(
                id="fact-supported",
                key="amount",
                value=125,
                status="evidence_supported",
                confidence="high",
                sourceIds=["evidence-receipt"],
                provenance=[EvidenceProvenance(
                    documentId="document-receipt",
                    pageNumber=2,
                    confidence=0.96,
                    status="evidence_supported",
                    extractionMethod="pdf_text",
                )],
            ),
            CaseFact(
                id="fact-user",
                key="request_made",
                value=True,
                status="user_reported",
                confidence="medium",
                sourceIds=["evidence-account"],
            ),
            CaseFact(
                id="fact-missing-source",
                key="delivery_date",
                value="2026-02-01",
                status="evidence_supported",
                confidence="high",
            ),
            CaseFact(
                id="fact-disputed",
                key="item_condition",
                value="damaged",
                status="conflicting",
                confidence="unknown",
            ),
        ],
        evidence=[
            EvidenceItem(
                id="evidence-receipt",
                type="receipt",
                title="Purchase receipt",
                source="document",
                status="evidence_supported",
                documentId="document-receipt",
                supportsClaimIds=["claim-supported", "claim-user"],
            ),
            EvidenceItem(
                id="evidence-account",
                type="message",
                title="User account of request",
                source="user",
                status="user_reported",
                conflictsWithClaimIds=["claim-disputed"],
            ),
            EvidenceItem(
                id="evidence-other-account",
                type="message",
                title="Other account",
                source="user",
                status="conflicting",
            ),
        ],
        claims=[
            CaseClaim(
                id="claim-supported",
                text="The receipt records a purchase for 125.",
                status="evidence_supported",
                evidenceIds=["evidence-receipt"],
            ),
            CaseClaim(
                id="claim-user",
                text="The seller was asked to replace the item.",
                status="user_reported",
                evidenceIds=["evidence-receipt"],
            ),
            CaseClaim(
                id="claim-disputed",
                text="The item arrived damaged.",
                status="conflicting",
                evidenceIds=["evidence-account"],
            ),
            CaseClaim(
                id="claim-no-source",
                text="The seller promised a replacement.",
                status="user_reported",
            ),
        ],
        jurisdiction=(
            Jurisdiction(country="Exampleland", state="North", district="River", basis="user_reported")
            if known_jurisdiction
            else Jurisdiction()
        ),
        legalIssues=[LegalIssue(id="issue-consumer", category="consumer", confidence="medium", rationale=["Recorded category."])],
        unknowns=["Was the item inspected at delivery?"],
        assumptions=["The seller received the message."],
        conflicts=conflicts or [],
        metadata=CaseMetadata(createdAt="2026-01-01T00:00:00+00:00", updatedAt="2026-04-01T00:00:00+00:00"),
    )


def make_catalog() -> tuple[KnowledgeJurisdiction, Authority, LegalProvision, LegalRule, LegalProcedure]:
    jurisdiction = KnowledgeJurisdiction(
        id="jurisdiction-north-river",
        title="Exampleland / North / River",
        country="Exampleland",
        state="North",
        district="River",
        jurisdiction_basis="Fixture mapping record",
        status=KnowledgeStatus.VERIFIED,
        provenance=(SourceReference(
            source_id="geo-source",
            page_section_reference="fixture jurisdiction catalog",
            retrieval_time=RETRIEVED_AT,
        ),),
    )
    authority = Authority(
        id="authority-fixture",
        title="Fixture Consumer Office",
        status=KnowledgeStatus.VERIFIED,
        provenance=(SourceReference(
            source_id="fixture-source",
            page_section_reference="authority listing",
            retrieval_time=RETRIEVED_AT,
        ),),
    )
    provision = LegalProvision(
        id="provision-fixture",
        title="Fixture provision record",
        jurisdiction=jurisdiction.id,
        authority=authority.id,
        source="fixture-source",
        version="fixture-v1",
        document_id="document-fixture",
        provision_reference="section alpha",
        text="Fixture provision text supplied by the caller.",
        status=KnowledgeStatus.VERIFIED,
        provenance=(SourceReference(
            source_id="fixture-source",
            document_id="document-fixture",
            provision_id="provision-fixture",
            page_section_reference="section alpha",
            retrieval_time=RETRIEVED_AT,
        ),),
    )
    rule = LegalRule(
        id="rule-fixture",
        title="Fixture rule record",
        jurisdiction=jurisdiction.id,
        authority=authority.id,
        source="fixture-source",
        version="fixture-v1",
        provision_id=provision.id,
        rule_text="Fixture rule text; not a statement of real law.",
        status=KnowledgeStatus.VERIFIED,
        provenance=(SourceReference(
            source_id="fixture-source",
            document_id="document-fixture",
            provision_id="provision-fixture",
            page_section_reference="section alpha / rule",
            retrieval_time=RETRIEVED_AT,
        ),),
    )
    procedure = LegalProcedure(
        id="procedure-fixture",
        title="Fixture submission path",
        jurisdiction=jurisdiction.id,
        authority=authority.id,
        source="fixture-source",
        version="fixture-v1",
        related_provision_ids=(provision.id,),
        steps=("Fixture step one", "Fixture step two"),
        status=KnowledgeStatus.VERIFIED,
        provenance=(SourceReference(
            source_id="fixture-source",
            document_id="document-fixture",
            provision_id=provision.id,
            page_section_reference="fixture procedure",
            retrieval_time=RETRIEVED_AT,
        ),),
    )
    return jurisdiction, authority, provision, rule, procedure


def issue_link(provision: LegalProvision) -> KnowledgeRelationship:
    return KnowledgeRelationship(
        subject_id=provision.id,
        relationship=RelationshipType.PROVISION_ADDRESSES_ISSUE,
        object_id="issue-consumer",
        provenance=(SourceReference(
            source_id="fixture-source",
            provision_id=provision.id,
            page_section_reference="fixture issue mapping",
            retrieval_time=RETRIEVED_AT,
        ),),
    )


def procedure_link(procedure: LegalProcedure) -> KnowledgeRelationship:
    return KnowledgeRelationship(
        subject_id="consumer",
        relationship=RelationshipType.ISSUE_SUGGESTS_PROCEDURE,
        object_id=procedure.id,
        provenance=(SourceReference(
            source_id="fixture-source",
            provision_id="provision-fixture",
            page_section_reference="fixture procedure mapping",
            retrieval_time=RETRIEVED_AT,
        ),),
    )


class LegalReasoningEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.jurisdiction, self.authority, self.provision, self.rule, self.procedure = make_catalog()

    def test_empty_legal_knowledge_explicitly_returns_unavailable_grounding(self) -> None:
        result = reason_about_case(make_case())

        self.assertEqual(result.legal_knowledge_status, "unavailable")
        self.assertIn("LEGAL_KNOWLEDGE_UNAVAILABLE", result.reason_codes)
        blocked = next(item for item in result.blocked_conclusions if item.subject == "jurisdiction_specific_legal_grounding")
        self.assertIn("LEGAL_KNOWLEDGE_UNAVAILABLE", blocked.reason_codes)
        self.assertIn("unavailable", blocked.explanation)
        self.assertTrue(blocked.source_references)

    def test_unknown_jurisdiction_blocks_specific_conclusion_and_path(self) -> None:
        result = reason_about_case(
            make_case(known_jurisdiction=False),
            legal_knowledge_records=(self.provision, self.rule),
            procedure_records=(self.procedure,),
            authority_records=(self.authority,),
            jurisdiction_records=(self.jurisdiction,),
            relationships=(issue_link(self.provision), procedure_link(self.procedure)),
        )

        self.assertEqual(result.jurisdiction_status, "unknown")
        blocked = next(item for item in result.blocked_conclusions if item.subject == "jurisdiction_specific_conclusion")
        self.assertIn("JURISDICTION_UNKNOWN", blocked.reason_codes)
        self.assertEqual(result.possible_procedural_paths[0].status, "verification_required")
        self.assertIn("JURISDICTION_UNKNOWN", result.possible_procedural_paths[0].blocked_reason_codes)

    def test_supported_and_user_reported_findings_remain_separate(self) -> None:
        result = reason_about_case(make_case())

        supported_text = " ".join(item.text for item in result.supported_findings)
        reported_text = " ".join(item.text for item in result.user_reported_findings)
        self.assertIn("amount = 125", supported_text)
        self.assertIn("receipt records a purchase", supported_text)
        self.assertIn("seller was asked to replace", reported_text)
        self.assertNotIn("seller was asked to replace", supported_text)
        amount = next(item for item in result.supported_findings if "amount = 125" in item.text)
        self.assertTrue(any(ref.source_id == "document-receipt" and ref.page_number == 2 for ref in amount.source_references))
        user_claim = next(item for item in result.user_reported_findings if "asked to replace" in item.text)
        self.assertIn("USER_REPORT_ONLY", user_claim.reason_codes)

    def test_missing_or_non_document_provenance_does_not_become_supported(self) -> None:
        result = reason_about_case(make_case())

        self.assertFalse(any("delivery_date" in item.text for item in result.supported_findings))
        self.assertTrue(any("delivery_date" in item.description for item in result.evidence_gaps))
        self.assertTrue(all(item.source_references for item in result.supported_findings))

    def test_conflicting_records_are_preserved_without_selecting_a_winner(self) -> None:
        result = reason_about_case(make_case(conflicts=["One account says received; another disputes receipt."]))

        descriptions = " ".join(item.description for item in result.conflicts)
        self.assertIn("conflicting", descriptions)
        self.assertIn("disputes receipt", descriptions)
        self.assertIn("CONFLICT_UNRESOLVED", result.reason_codes)
        self.assertTrue(any("unresolved" in risk.description for risk in result.risks))
        self.assertFalse(any("damaged" in item.text for item in result.supported_findings))

    def test_explicitly_conflicting_evidence_blocks_supported_promotion(self) -> None:
        state = make_case()
        supported_fact = next(item for item in state.facts if item.id == "fact-supported")
        user_claim = next(item for item in state.claims if item.id == "claim-user")
        account = next(item for item in state.evidence if item.id == "evidence-account")
        state = state.model_copy(
            update={
                "facts": [
                    supported_fact.model_copy(update={"sourceIds": ["evidence-receipt", "evidence-other-account"]})
                    if item.id == supported_fact.id else item
                    for item in state.facts
                ],
                "claims": [
                    user_claim.model_copy(update={"status": "evidence_supported", "evidenceIds": ["evidence-receipt", "evidence-account"]})
                    if item.id == user_claim.id else item
                    for item in state.claims
                ],
                "evidence": [
                    account.model_copy(update={"conflictsWithClaimIds": [*account.conflictsWithClaimIds, "claim-user"]})
                    if item.id == account.id else item
                    for item in state.evidence
                ],
            }
        )

        result = reason_about_case(state)

        self.assertFalse(any("amount = 125" in item.text for item in result.supported_findings))
        self.assertFalse(any("asked to replace" in item.text for item in result.supported_findings))
        descriptions = " ".join(item.description for item in result.conflicts)
        self.assertIn("fact-supported", descriptions)
        self.assertIn("claim-user", descriptions)

    def test_only_explicit_source_linked_issue_records_are_reported(self) -> None:
        result = reason_about_case(
            make_case(),
            legal_knowledge_records=(self.provision, self.rule),
            jurisdiction_records=(self.jurisdiction,),
            relationships=(issue_link(self.provision),),
        )

        statements = {item.record_id: item for item in result.grounded_legal_statements}
        self.assertEqual(set(statements), {self.provision.id, self.rule.id})
        self.assertIn("Fixture rule text", statements[self.rule.id].text)
        self.assertTrue(all(any(ref.source_id == "fixture-source" for ref in item.source_references) for item in statements.values()))
        self.assertTrue(all("RULE_APPLICATION_NOT_PERFORMED" in step.reason_codes for step in result.reasoning_steps if "states:" in step.text))
        self.assertTrue(any(item.subject == "court_or_decision_maker_outcome" for item in result.blocked_conclusions))

    def test_issue_linked_procedure_is_only_a_verification_required_candidate(self) -> None:
        result = reason_about_case(
            make_case(),
            legal_knowledge_records=(self.provision, self.rule),
            procedure_records=(self.procedure,),
            authority_records=(self.authority,),
            jurisdiction_records=(self.jurisdiction,),
            relationships=(issue_link(self.provision), procedure_link(self.procedure)),
        )

        self.assertEqual(result.jurisdiction_status, "mapped")
        path = result.possible_procedural_paths[0]
        self.assertEqual(path.status, "verification_required")
        self.assertEqual(path.steps, self.procedure.steps)
        self.assertEqual(path.authority_record_id, self.authority.id)
        self.assertIn("PROCEDURAL_AVAILABILITY_NOT_ESTABLISHED", path.blocked_reason_codes)
        self.assertTrue(any(ref.source_id == "fixture-source" for ref in path.source_references))

    def test_procedure_can_be_linked_through_its_explicit_provision_reference(self) -> None:
        result = reason_about_case(
            make_case(),
            legal_knowledge_records=(self.provision, self.rule),
            procedure_records=(self.procedure,),
            authority_records=(self.authority,),
            jurisdiction_records=(self.jurisdiction,),
            relationships=(issue_link(self.provision),),
        )

        self.assertEqual(len(result.possible_procedural_paths), 1)
        path = result.possible_procedural_paths[0]
        self.assertEqual(path.procedure_record_id, self.procedure.id)
        self.assertTrue(any(ref.source_id == self.provision.id for ref in path.source_references))

    def test_jurisdiction_catalog_record_must_be_verified_and_cited(self) -> None:
        unverified = replace(self.jurisdiction, status=KnowledgeStatus.UNVERIFIED)
        result = reason_about_case(
            make_case(),
            legal_knowledge_records=(self.provision,),
            jurisdiction_records=(unverified,),
            relationships=(issue_link(self.provision),),
        )

        self.assertEqual(result.jurisdiction_status, "catalog_unverified")
        self.assertIn("JURISDICTION_RECORD_NOT_VERIFIED", result.grounded_legal_statements[0].reason_codes)

    def test_procedure_records_do_not_hide_empty_rule_grounding(self) -> None:
        result = reason_about_case(
            make_case(),
            procedure_records=(self.procedure,),
            authority_records=(self.authority,),
            jurisdiction_records=(self.jurisdiction,),
            relationships=(procedure_link(self.procedure),),
        )

        self.assertEqual(result.legal_knowledge_status, "unavailable")
        self.assertIn("LEGAL_KNOWLEDGE_UNAVAILABLE", result.reason_codes)
        self.assertEqual(len(result.possible_procedural_paths), 1)

    def test_procedures_without_an_explicit_issue_link_are_never_invented(self) -> None:
        result = reason_about_case(
            make_case(),
            procedure_records=(self.procedure,),
            authority_records=(self.authority,),
            jurisdiction_records=(self.jurisdiction,),
        )

        self.assertEqual(result.possible_procedural_paths, ())
        self.assertIn("PROCEDURE_ISSUE_LINK_MISSING", result.reason_codes)

    def test_jurisdiction_mismatch_blocks_legal_record(self) -> None:
        wrong_jurisdiction = KnowledgeJurisdiction(
            id="jurisdiction-other",
            title="Other location",
            country="Exampleland",
            state="South",
            district="River",
            jurisdiction_basis="Fixture mapping record",
            status=KnowledgeStatus.VERIFIED,
            provenance=self.jurisdiction.provenance,
        )
        result = reason_about_case(
            make_case(),
            legal_knowledge_records=(self.provision, self.rule),
            jurisdiction_records=(wrong_jurisdiction,),
            relationships=(issue_link(self.provision),),
        )

        self.assertEqual(result.jurisdiction_status, "unmapped")
        self.assertIn("JURISDICTION_RECORD_UNMAPPED", result.grounded_legal_statements[0].reason_codes)
        self.assertTrue(any(item.subject == "jurisdiction_specific_conclusion" for item in result.blocked_conclusions))

    def test_unverified_record_is_not_described_as_grounded(self) -> None:
        draft = replace(self.provision, status=KnowledgeStatus.UNVERIFIED)
        result = reason_about_case(
            make_case(),
            legal_knowledge_records=(draft,),
            jurisdiction_records=(self.jurisdiction,),
            relationships=(issue_link(draft),),
        )

        self.assertIn("KNOWLEDGE_RECORD_NOT_VERIFIED", result.grounded_legal_statements[0].reason_codes)
        self.assertNotEqual(result.legal_knowledge_status, "source_grounded_records_present")

    def test_missing_record_provenance_is_explicitly_blocked(self) -> None:
        record = LegalProvision(
            id="provision-no-source",
            title="Uncited provision fixture",
            jurisdiction=self.jurisdiction.id,
            authority=self.authority.id,
            source="fixture-source",
            version="fixture-v1",
            document_id="document-fixture",
            provision_reference="section beta",
            text="Uncited fixture text.",
            status=KnowledgeStatus.VERIFIED,
            provenance=(),
        )
        relationship = KnowledgeRelationship(
            subject_id=record.id,
            relationship=RelationshipType.PROVISION_ADDRESSES_ISSUE,
            object_id="issue-consumer",
        )
        result = reason_about_case(
            make_case(),
            legal_knowledge_records=(record,),
            jurisdiction_records=(self.jurisdiction,),
            relationships=(relationship,),
        )

        self.assertIn("SOURCE_PROVENANCE_MISSING", result.grounded_legal_statements[0].reason_codes)
        self.assertIn("RELATIONSHIP_SOURCE_UNAVAILABLE", result.grounded_legal_statements[0].reason_codes)

    def test_unknowns_and_assumptions_are_returned_as_open_questions(self) -> None:
        result = reason_about_case(make_case(), unknowns=("Was a written warranty provided?",), assumptions=("The package was sealed.",))

        texts = " ".join(item.text for item in result.unresolved_questions)
        self.assertIn("Was the item inspected at delivery?", texts)
        self.assertIn("Was a written warranty provided?", texts)
        self.assertIn("Verify assumption: The package was sealed.", texts)
        self.assertTrue(all(item.source_references for item in result.unresolved_questions))

    def test_effective_dates_are_not_silently_treated_as_current(self) -> None:
        dated = replace(self.provision, effective_from=datetime(2020, 1, 1).date())
        result = reason_about_case(
            make_case(),
            legal_knowledge_records=(dated,),
            jurisdiction_records=(self.jurisdiction,),
            relationships=(issue_link(dated),),
        )

        self.assertIn("EFFECTIVE_DATE_NOT_ASSESSED", result.grounded_legal_statements[0].reason_codes)

    def test_output_is_deterministic_for_repeated_identical_inputs(self) -> None:
        args = dict(
            legal_knowledge_records=(self.provision, self.rule),
            procedure_records=(self.procedure,),
            authority_records=(self.authority,),
            jurisdiction_records=(self.jurisdiction,),
            relationships=(procedure_link(self.procedure), issue_link(self.provision)),
        )
        first = reason_about_case(make_case(), **args)
        second = reason_about_case(make_case(), **args)

        self.assertEqual(first, second)

    def test_reason_codes_have_ui_explanations(self) -> None:
        result = reason_about_case(
            make_case(),
            legal_knowledge_records=(self.provision, self.rule),
            procedure_records=(self.procedure,),
            authority_records=(self.authority,),
            jurisdiction_records=(self.jurisdiction,),
            relationships=(issue_link(self.provision), procedure_link(self.procedure)),
        )

        codes = list(result.reason_codes) + list(result.uncertainty.reason_codes)
        for collection_name in (
            "reasoning_steps", "grounded_legal_statements", "supported_findings",
            "user_reported_findings", "unresolved_questions", "evidence_gaps",
            "conflicts", "risks", "possible_procedural_paths", "blocked_conclusions",
        ):
            for item in getattr(result, collection_name):
                codes.extend(getattr(item, "reason_codes", getattr(item, "blocked_reason_codes", ())))
        self.assertTrue(codes)
        self.assertTrue(all(code in REASON_CODE_MESSAGES for code in codes), sorted(set(codes) - REASON_CODE_MESSAGES.keys()))
        self.assertEqual(result.uncertainty.confidence, None)
        self.assertEqual(result.uncertainty.confidence_status, "not_scored")
        self.assertTrue(result.uncertainty.source_references)

    def test_duplicate_record_ids_with_different_content_are_rejected(self) -> None:
        altered = replace(self.provision, title="Different content under same ID")
        with self.assertRaises(ValueError):
            reason_about_case(
                make_case(),
                legal_knowledge_records=(self.provision, altered),
            )


if __name__ == "__main__":
    unittest.main()
