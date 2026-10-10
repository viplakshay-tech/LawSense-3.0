from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.engines.safety_support import (
    ImmediateDangerAnswer,
    ResourceCategory,
    SafetyUrgency,
    WomenSafetyDomain,
    WomenSafetyUrgency,
    orchestrate_safety_support,
)
from app.engines.legal_knowledge import InMemoryLegalKnowledgeStore
from app.routes.safety_support import SafetySupportRequest, assess_case_safety_support
from app.schemas.case_state import CaseMetadata, CasePerson, CaseState, Jurisdiction
from app.services.case_pipeline import CasePipelineRequest, run_case_pipeline


class WomenSafetyAssessmentTests(unittest.TestCase):
    def test_priority_domains_are_derived_from_shared_safety_signals(self) -> None:
        examples = {
            WomenSafetyDomain.DOMESTIC_ABUSE: "My husband beats me.",
            WomenSafetyDomain.SEXUAL_VIOLENCE: "Someone forced me to have sex without my consent.",
            WomenSafetyDomain.WORKPLACE_SEXUAL_HARASSMENT: (
                "My supervisor repeatedly sends unwanted sexual messages at work."
            ),
            WomenSafetyDomain.STALKING: "He keeps following me everywhere.",
            WomenSafetyDomain.THREATS_COERCION: "He threatened to hurt me.",
            WomenSafetyDomain.CYBER_HARASSMENT: (
                "Someone keeps threatening me through online messages."
            ),
            WomenSafetyDomain.INTIMATE_IMAGE_ABUSE: (
                "He blackmailed me with my private photos."
            ),
            WomenSafetyDomain.DOWRY_RELATED_ABUSE: (
                "My in-laws threatened me over dowry."
            ),
            WomenSafetyDomain.FINANCIAL_CONTROL_ABUSE: "He controls all my money.",
            WomenSafetyDomain.TRAFFICKING_EXPLOITATION: "They trafficked me and forced me to work.",
        }

        for expected, narrative in examples.items():
            with self.subTest(domain=expected.value):
                result = orchestrate_safety_support(narrative)
                self.assertIsNotNone(result.women_safety_context)
                context = result.women_safety_context
                self.assertIn(expected, context.domains)
                self.assertTrue(any(item.domain is expected for item in context.domain_evidence))
                self.assertTrue(all(item.status == "system_inferred" for item in context.domain_evidence))
                self.assertFalse(context.contacted_anyone)

    def test_all_five_women_safety_urgencies_are_represented(self) -> None:
        cases = (
            ("My landlord sent a rent notice.", None, WomenSafetyUrgency.NORMAL),
            ("He keeps following me everywhere.", None, WomenSafetyUrgency.CONCERNING),
            ("He threatened to kill me.", None, WomenSafetyUrgency.URGENT),
            ("I am in immediate danger right now.", None, WomenSafetyUrgency.IMMEDIATE_DANGER),
            ("A neutral statement.", "not_sure", WomenSafetyUrgency.NOT_SURE),
        )
        for narrative, answer, expected in cases:
            with self.subTest(urgency=expected.value):
                result = orchestrate_safety_support(narrative, immediate_danger=answer)
                self.assertEqual(result.women_safety_context.urgency, expected)

    def test_yes_no_and_not_sure_are_preserved_as_user_choices(self) -> None:
        expected = {
            ImmediateDangerAnswer.YES: WomenSafetyUrgency.IMMEDIATE_DANGER,
            ImmediateDangerAnswer.NO: WomenSafetyUrgency.NORMAL,
            ImmediateDangerAnswer.NOT_SURE: WomenSafetyUrgency.NOT_SURE,
        }
        for answer, urgency in expected.items():
            with self.subTest(answer=answer.value):
                result = orchestrate_safety_support("A neutral statement.", immediate_danger=answer)
                context = result.women_safety_context
                self.assertEqual(context.immediate_danger_answer, answer)
                self.assertEqual(context.urgency, urgency)
                self.assertFalse(context.contacted_anyone)
                self.assertTrue(all(not action.automatic_contact for action in context.actions))

    def test_intimate_image_guidance_never_requests_copying_or_sharing_images(self) -> None:
        result = orchestrate_safety_support(
            "He threatened to leak my intimate photos without consent.", language="en"
        )
        context = result.women_safety_context

        self.assertIn(WomenSafetyDomain.INTIMATE_IMAGE_ABUSE, context.domains)
        guidance = " ".join(context.evidence_preservation_guidance).casefold()
        self.assertIn("if safe", guidance)
        self.assertIn("do not create, download, forward, or share intimate images", guidance)
        self.assertTrue(any("only if it is safe" in item.casefold() for item in result.evidence_preservation_guidance))

    def test_context_maps_only_existing_case_issues_and_procedures_with_provenance(self) -> None:
        narrative = "My supervisor repeatedly sends unwanted sexual messages at work."
        source_reference = SimpleNamespace(
            source_id="source-workplace-harassment",
            retrieval_time="2026-10-08T10:00:00+00:00",
            source_url="https://example.invalid/workplace-harassment",
            provision_id="provision-example",
            page_section_reference="procedure record",
        )
        procedure = SimpleNamespace(
            id="procedure-workplace-harassment",
            type="legal_procedure",
            title="Workplace sexual harassment complaint procedure",
            reference="",
            source="source-workplace-harassment",
            jurisdiction="jurisdiction-india",
            provenance=(source_reference,),
            source_verification_status="verified",
            source_freshness_status="current",
            source_applicability_status="applicability_not_established",
            jurisdiction_match_status="matched",
        )
        case_state = CaseState.model_construct(
            id="case-workplace",
            initialStatement=narrative,
            legalIssues=[SimpleNamespace(
                id="issue-workplace",
                category="workplace_harassment",
                subcategory=None,
            )],
            analysis=SimpleNamespace(
                legal_knowledge=SimpleNamespace(records=(procedure,)),
            ),
            parties=[],
        )

        result = orchestrate_safety_support(narrative, case_state=case_state, jurisdiction="IN")
        context = result.women_safety_context
        mapping = next(
            item for item in context.legal_issue_mappings
            if item.domain is WomenSafetyDomain.WORKPLACE_SEXUAL_HARASSMENT
        )

        self.assertEqual(mapping.status, "matched_case_issue")
        self.assertEqual(mapping.candidate_issue_categories, ("workplace_harassment",))
        self.assertEqual(mapping.matched_case_issue_ids, ("issue-workplace",))
        self.assertEqual(mapping.source_record_ids, ("procedure-workplace-harassment",))
        self.assertEqual(context.procedures[0].record_id, "procedure-workplace-harassment")
        self.assertEqual(context.procedures[0].jurisdiction_match_status, "matched")
        self.assertEqual(context.legal_sources[0].source_id, "source-workplace-harassment")
        self.assertTrue(any(
            action.type.value == "review_legal_procedures"
            and "source-workplace-harassment" in action.source_ids
            for action in context.actions
        ))

    def test_case_summary_does_not_persist_immediate_danger_answer(self) -> None:
        result = orchestrate_safety_support(
            "A neutral statement.", immediate_danger=ImmediateDangerAnswer.YES
        )

        response_context = result.women_safety_context.as_dict()
        case_summary = result.women_safety_context.as_summary_dict()
        self.assertEqual(response_context["immediate_danger_answer"], "yes")
        self.assertNotIn("immediate_danger_answer", case_summary)
        self.assertFalse(any(
            action["type"] == "immediate_danger_check"
            for action in case_summary["actions"]
        ))
        self.assertNotIn("A neutral statement", repr(response_context))

    def test_official_resource_provenance_is_returned_without_automatic_contact(self) -> None:
        result = orchestrate_safety_support(
            "I am in immediate danger right now.", jurisdiction="IN", state="Maharashtra"
        )
        resource = next(item for item in result.resources if item.resource_id == "india-erss-112")
        payload = resource.as_dict()

        self.assertTrue(resource.official)
        self.assertEqual(payload["provenance"][0]["source_id"], "india-erss-112")
        self.assertEqual(payload["provenance"][0]["source_url"], "https://112.gov.in/")
        self.assertFalse(result.contacted_anyone)
        self.assertTrue(all(not item.automatic_contact for item in result.women_safety_context.actions))

    def test_canonical_case_analysis_includes_the_shared_women_safety_context(self) -> None:
        request = CasePipelineRequest(
            case_id="case-integrated-women-safety",
            initial_statement="My supervisor repeatedly sends unwanted sexual messages at work.",
            recorded_at="2026-10-09T00:00:00+00:00",
        )
        result = run_case_pipeline(
            request,
            legal_knowledge_repository=InMemoryLegalKnowledgeStore(),
        )

        summary = result.case_analysis.safety_context.women_safety_context
        self.assertIsNotNone(summary)
        self.assertIn("workplace_sexual_harassment", summary.domains)
        self.assertEqual(summary.urgency, "CONCERNING")
        self.assertIsNone(summary.immediate_danger_answer)
        self.assertNotIn("immediate_danger_check", {
            action.type for action in summary.actions
        })
        self.assertFalse(summary.contacted_anyone)


class WomenSafetyRouteTests(unittest.TestCase):
    def test_route_uses_country_and_state_for_official_resource_filtering(self) -> None:
        narrative = "My husband beats me."
        case_state = CaseState(
            id="case-route",
            initialStatement=narrative,
            person=CasePerson(),
            jurisdiction=Jurisdiction(country="India", state="Maharashtra", basis="user_reported"),
            metadata=CaseMetadata(createdAt="2026-10-09T00:00:00Z", updatedAt="2026-10-09T00:00:00Z"),
        )

        with patch("app.routes.safety_support.get_case_state", return_value=case_state):
            response = assess_case_safety_support(
                "case-route", SafetySupportRequest(immediate_danger="no")
            )

        self.assertEqual(response.resource_status, "available")
        names = {resource.get("name") for resource in response.assessment.resources}
        self.assertIn("Women Helpline", names)
        self.assertEqual(response.assessment.women_safety_context.jurisdiction, "IN")
        self.assertEqual(response.assessment.women_safety_context.state, "Maharashtra")
        self.assertFalse(response.contacted_anyone)
        self.assertFalse(response.assessment.women_safety_context.contacted_anyone)

    def test_route_returns_requested_consumer_resource_from_the_registry(self) -> None:
        case_state = CaseState(
            id="consumer-route",
            initialStatement="I want a refund for a defective product.",
            person=CasePerson(),
            jurisdiction=Jurisdiction(country="India", state="Maharashtra", basis="user_reported"),
            metadata=CaseMetadata(createdAt="2026-10-09T00:00:00Z", updatedAt="2026-10-09T00:00:00Z"),
        )

        with patch("app.routes.safety_support.get_case_state", return_value=case_state):
            response = assess_case_safety_support(
                "consumer-route",
                SafetySupportRequest(requested_resource_categories=[ResourceCategory.CONSUMER_SUPPORT]),
            )

        helpline = next(
            item for item in response.assessment.resources
            if item.get("resource_id") == "india-national-consumer-helpline-1915"
        )
        self.assertEqual(helpline.get("phone"), "1915")
        self.assertEqual(helpline.get("verification_status"), "verified_official")
        self.assertEqual(response.contacted_anyone, False)

    def test_route_withholds_181_in_west_bengal_and_returns_source_only_fallback(self) -> None:
        case_state = CaseState(
            id="women-west-bengal-route",
            initialStatement="My husband beats me.",
            person=CasePerson(),
            jurisdiction=Jurisdiction(country="India", state="West Bengal", basis="user_reported"),
            metadata=CaseMetadata(createdAt="2026-10-09T00:00:00Z", updatedAt="2026-10-09T00:00:00Z"),
        )

        with patch("app.routes.safety_support.get_case_state", return_value=case_state):
            response = assess_case_safety_support("women-west-bengal-route", SafetySupportRequest())

        self.assertFalse(any(item.get("phone") == "181" for item in response.assessment.resources))
        restricted = next(
            item for item in response.assessment.resource_eligibility
            if item.get("resource_id") == "india-women-helpline-181"
        )
        self.assertEqual(restricted.get("status"), "state_not_applicable")
        self.assertEqual(restricted.get("state"), "West Bengal")
        self.assertEqual(
            restricted.get("source_url"),
            "https://www.wcd.gov.in/offerings/women--helpline--scheme",
        )
        self.assertIsNone(restricted.get("phone"))
        self.assertIsNone(restricted.get("url"))


if __name__ == "__main__":
    unittest.main()
