from __future__ import annotations

import unittest

from app.engines.safety_support import (
    AssessmentContext,
    ImmediateDangerAnswer,
    EmptyOfficialResourceRegistry,
    IndiaOfficialResourceRegistry,
    InMemoryOfficialResourceRegistry,
    OfficialResource,
    ResourceCategory,
    ResourceAvailabilityStatus,
    ResourceVerificationStatus,
    SafetySupportTrack,
    SafetyLanguage,
    SafetySituation,
    SafetySupportOrchestrator,
    SafetyUrgency,
    WorkflowDisposition,
    orchestrate_safety_support,
)


class SafetySupportOrchestratorTests(unittest.TestCase):
    def test_requested_situations_are_contextualized(self) -> None:
        examples = {
            SafetySituation.DOMESTIC_VIOLENCE: "My husband beats me.",
            SafetySituation.THREATS: "He threatened to hurt me.",
            SafetySituation.STALKING: "He keeps following me everywhere.",
            SafetySituation.SEXUAL_HARASSMENT_VIOLENCE: "My manager sends sexual messages and harasses me.",
            SafetySituation.BLACKMAIL: "He blackmailed me with my private photos.",
            SafetySituation.COERCIVE_CONTROL: "My partner controls who I meet and won't let me see friends.",
            SafetySituation.FORCED_ISOLATION: "She won't let me meet my friends.",
            SafetySituation.FINANCIAL_CONTROL: "He controls all my money.",
            SafetySituation.WORKPLACE_HARASSMENT: "My supervisor repeatedly sends unwanted messages at work.",
            SafetySituation.CHILD_SAFETY: "I am worried my child may be neglected and unsafe.",
            SafetySituation.ELDER_ABUSE: "My elderly father is denied his medicine and neglected.",
            SafetySituation.EXPLOITATION: "They forced me to work without pay.",
            SafetySituation.CYBER_HARASSMENT: "Someone keeps threatening me through online messages.",
        }
        for expected, narrative in examples.items():
            with self.subTest(situation=expected.value):
                result = orchestrate_safety_support(narrative)
                self.assertIn(expected, result.situations)
                self.assertTrue(result.trigger_evidence)
                self.assertIsNotNone(result.user_facing_safety_prompt)
                self.assertEqual(result.context, AssessmentContext.POTENTIALLY_UNSAFE)

    def test_immediate_danger_overrides_ordinary_legal_workflow(self) -> None:
        result = orchestrate_safety_support(
            "I am in immediate danger right now.", immediate_danger=ImmediateDangerAnswer.NO
        )

        self.assertEqual(result.urgency, SafetyUrgency.URGENT)
        self.assertEqual(result.workflow_disposition, WorkflowDisposition.SAFETY_FIRST)
        self.assertFalse(result.legal_workflow_allowed)
        self.assertIn("Pause the ordinary legal workflow", result.safe_next_step_sequence[0])

    def test_not_sure_is_supported_and_routes_to_safety_first(self) -> None:
        result = orchestrate_safety_support(
            "I am not sure if I am safe.", immediate_danger="not_sure", language="hinglish"
        )

        self.assertEqual(result.context, AssessmentContext.UNCERTAIN)
        self.assertEqual(result.urgency, SafetyUrgency.ELEVATED)
        self.assertFalse(result.legal_workflow_allowed)
        self.assertEqual(result.language, SafetyLanguage.HINGLISH)
        self.assertIn("NOT_SURE", result.user_facing_safety_prompt or "")
        self.assertTrue(any(
            item.category == "immediate_danger_self_report" and item.origin == "user_response"
            for item in result.trigger_evidence
        ))

    def test_localization_infers_hindi_and_hinglish_and_accepts_explicit_choice(self) -> None:
        hindi = orchestrate_safety_support("वह मेरा पीछा करता है और मुझे धमकी देता है।")
        hinglish = orchestrate_safety_support("Woh mera peecha karta hai aur dhamki deta hai.")
        explicit = orchestrate_safety_support("He keeps following me.", language="hi")

        self.assertEqual(hindi.language, SafetyLanguage.HINDI)
        self.assertIn("क्या आप", hindi.user_facing_safety_prompt or "")
        self.assertEqual(hinglish.language, SafetyLanguage.HINGLISH)
        self.assertIn("Kya aap", hinglish.user_facing_safety_prompt or "")
        self.assertEqual(explicit.language, SafetyLanguage.HINDI)

    def test_evidence_and_uncertainty_are_traceable_and_nonjudgmental(self) -> None:
        narrative = "My husband beats me."
        payload = orchestrate_safety_support(narrative).as_dict()

        self.assertEqual(payload["trigger_evidence"][0]["source_text"], narrative)
        self.assertIn("not a diagnosis", " ".join(payload["uncertainty"]))
        self.assertIn("does not determine guilt", " ".join(payload["uncertainty"]))

    def test_registry_resources_are_filtered_by_official_status_category_and_jurisdiction(self) -> None:
        official = OfficialResource(
            name="Official local emergency resource",
            category=ResourceCategory.EMERGENCY,
            jurisdiction="IN",
            official=True,
            url="https://official.example.invalid/support",
            phone="000",
        )
        unofficial = OfficialResource(
            name="Unverified resource",
            category=ResourceCategory.EMERGENCY,
            jurisdiction="IN",
            official=False,
            url="https://unverified.example.invalid",
            phone="111",
        )
        wrong_region = OfficialResource(
            name="Other region",
            category=ResourceCategory.EMERGENCY,
            jurisdiction="XX",
            official=True,
            phone="222",
        )
        engine = SafetySupportOrchestrator(
            InMemoryOfficialResourceRegistry((official, unofficial, wrong_region))
        )

        result = engine.assess("I am in immediate danger right now.", jurisdiction="IN")

        self.assertEqual(result.resources, (official,))
        self.assertEqual(result.resources[0].phone, "000")

    def test_static_india_catalog_returns_verified_official_emergency_resource(self) -> None:
        result = orchestrate_safety_support(
            "I am in immediate danger right now.",
            jurisdiction="IN",
            state="Maharashtra",
        )

        emergency = next(item for item in result.resources if item.category is ResourceCategory.EMERGENCY)
        self.assertEqual(emergency.name, "Emergency Response Support System (ERSS)")
        self.assertEqual(emergency.phone, "112")
        self.assertEqual(emergency.verification_status.value, "verified_official")
        self.assertEqual(emergency.jurisdiction, "IN")
        self.assertEqual(emergency.jurisdiction_scope, "countrywide")
        self.assertTrue(emergency.source_url.startswith("https://112.gov.in/"))
        self.assertIn(ResourceCategory.POLICE_OFFICIAL, emergency.categories)
        self.assertFalse(result.contacted_anyone)

    def test_verified_source_urls_are_https_only_and_provenance_uses_the_safe_source(self) -> None:
        resource = OfficialResource(
            name="Official listing",
            resource_id="official-test",
            category=ResourceCategory.EMERGENCY,
            jurisdiction="IN",
            official=True,
            url="https://112.gov.in/",
            source_url="https://112.gov.in/about",
        )
        payload = resource.as_dict()
        self.assertEqual(payload["url"], "https://112.gov.in/")
        self.assertEqual(payload["source_url"], "https://112.gov.in/about")
        self.assertEqual(payload["provenance"][0]["source_url"], "https://112.gov.in/about")

        unsafe_source = OfficialResource(
            name="Listing with an unsafe source",
            resource_id="unsafe-source-test",
            category=ResourceCategory.EMERGENCY,
            jurisdiction="IN",
            official=True,
            url="javascript:alert(1)",
            source_url="http://112.gov.in/about",
        ).as_dict()
        self.assertIsNone(unsafe_source["url"])
        self.assertIsNone(unsafe_source["source_url"])
        self.assertIsNone(unsafe_source["provenance"][0]["source_url"])

    def test_registry_can_mark_a_resource_unavailable_without_exposing_contact_data(self) -> None:
        unavailable = OfficialResource(
            name="Unavailable emergency listing",
            category=ResourceCategory.EMERGENCY,
            jurisdiction="IN",
            official=False,
            verification_status=ResourceVerificationStatus.UNAVAILABLE,
            url="https://unavailable.example.invalid/",
            phone="999",
        )
        engine = SafetySupportOrchestrator(InMemoryOfficialResourceRegistry((unavailable,)))

        result = engine.assess("I am in immediate danger right now.", jurisdiction="IN")

        self.assertEqual(result.resources, ())
        availability = next(
            item for item in result.resource_availability
            if item.category is ResourceCategory.EMERGENCY
        )
        self.assertEqual(availability.status, ResourceAvailabilityStatus.UNAVAILABLE)
        self.assertNotIn("unavailable.example.invalid", repr(result.as_dict()))
        self.assertNotIn("999", repr(result.as_dict()))
        self.assertIsNone(unavailable.as_dict()["phone"])

    def test_jurisdiction_mismatch_is_reported_without_returning_wrong_region_resource(self) -> None:
        resource = OfficialResource(
            name="Official emergency resource",
            category=ResourceCategory.EMERGENCY,
            jurisdiction="IN",
            official=True,
            url="https://official.example.invalid/",
            phone="000",
        )
        engine = SafetySupportOrchestrator(InMemoryOfficialResourceRegistry((resource,)))

        result = engine.assess("I am in immediate danger right now.", jurisdiction="XX")

        self.assertEqual(result.resources, ())
        availability = next(
            item for item in result.resource_availability
            if item.category is ResourceCategory.EMERGENCY
        )
        self.assertEqual(availability.status, ResourceAvailabilityStatus.JURISDICTION_MISMATCH)
        self.assertNotIn("official.example.invalid", repr(result.as_dict()))

    def test_unverified_resource_is_marked_and_contact_details_are_withheld(self) -> None:
        candidate = OfficialResource(
            name="Unverified emergency listing",
            category=ResourceCategory.EMERGENCY,
            jurisdiction="IN",
            official=False,
            verification_status=ResourceVerificationStatus.UNVERIFIED,
            url="https://unverified.example.invalid/",
            phone="999",
        )
        engine = SafetySupportOrchestrator(InMemoryOfficialResourceRegistry((candidate,)))

        result = engine.assess("I am in immediate danger right now.", jurisdiction="IN")

        self.assertEqual(result.resources, ())
        availability = next(
            item for item in result.resource_availability
            if item.category is ResourceCategory.EMERGENCY
        )
        self.assertEqual(availability.status, ResourceAvailabilityStatus.UNVERIFIED)
        self.assertNotIn("unverified.example.invalid", repr(result.as_dict()))
        self.assertNotIn("999", repr(result.as_dict()))
        self.assertIsNone(candidate.as_dict()["url"])

    def test_not_sure_preserves_immediate_danger_support_track(self) -> None:
        result = orchestrate_safety_support(
            "I am not sure if I am safe.",
            immediate_danger=ImmediateDangerAnswer.NOT_SURE,
            jurisdiction="IN",
            state="Delhi",
        )

        self.assertEqual(result.context, AssessmentContext.UNCERTAIN)
        self.assertEqual(result.support_tracks, (SafetySupportTrack.IMMEDIATE_DANGER,))
        self.assertIn(ResourceCategory.EMERGENCY, result.resource_categories)
        self.assertIn(ResourceCategory.POLICE_OFFICIAL, result.resource_categories)
        self.assertFalse(result.contacted_anyone)

    def test_workplace_and_online_situation_can_return_multiple_resource_categories(self) -> None:
        result = orchestrate_safety_support(
            "My supervisor repeatedly sends unwanted messages at work. "
            "Someone keeps threatening me through online messages.",
            jurisdiction="IN",
            state="Karnataka",
        )

        self.assertIn(SafetySituation.WORKPLACE_HARASSMENT, result.situations)
        self.assertIn(SafetySituation.CYBER_HARASSMENT, result.situations)
        self.assertIn(ResourceCategory.WORKPLACE_HARASSMENT, result.resource_categories)
        self.assertIn(ResourceCategory.CYBERCRIME, result.resource_categories)
        self.assertTrue(any(
            item.category is ResourceCategory.WORKPLACE_HARASSMENT
            and item.status is ResourceAvailabilityStatus.UNAVAILABLE
            for item in result.resource_availability
        ))
        self.assertTrue(any(
            item.category is ResourceCategory.CYBERCRIME
            and item.status is ResourceAvailabilityStatus.VERIFIED_OFFICIAL
            for item in result.resource_availability
        ))

    def test_no_resource_found_is_explicit_and_does_not_invent_contact_details(self) -> None:
        result = SafetySupportOrchestrator(EmptyOfficialResourceRegistry()).assess(
            "I am in immediate danger right now.", jurisdiction="IN"
        )

        self.assertTrue(result.resource_categories)
        self.assertTrue(result.resource_availability)
        self.assertTrue(all(
            item.status is ResourceAvailabilityStatus.UNAVAILABLE
            for item in result.resource_availability
        ))
        self.assertEqual(result.resources, ())
        self.assertNotIn("http", repr(result.as_dict()))

    def test_women_helpline_is_not_returned_for_a_state_marked_unavailable(self) -> None:
        result = orchestrate_safety_support(
            "My husband beats me.", jurisdiction="IN", state="West Bengal"
        )

        self.assertFalse(any(item.phone == "181" for item in result.resources))
        self.assertTrue(any(item.phone == "1098" for item in result.resources))
        child_helpline = next(item for item in result.resources if item.phone == "1098")
        self.assertIn("selected railway stations", child_helpline.accessibility_options.casefold())
        availability = next(
            item for item in result.resource_availability
            if item.category is ResourceCategory.WOMEN_CHILD_PROTECTION
        )
        # Child Helpline remains available under this category; the assessment
        # does not claim that the Women Helpline itself is available here.
        self.assertEqual(availability.status, ResourceAvailabilityStatus.VERIFIED_OFFICIAL)
        women_record = next(
            item for item in IndiaOfficialResourceRegistry().lookup(
                jurisdiction="IN", state="West Bengal",
                categories=(ResourceCategory.WOMEN_CHILD_PROTECTION,),
            )
            if item.phone == "181"
        )
        self.assertEqual(women_record.excluded_states, ("West Bengal",))
        eligibility = next(
            item for item in result.resource_eligibility
            if item.resource_id == "india-women-helpline-181"
        )
        self.assertEqual(eligibility.status, ResourceAvailabilityStatus.STATE_NOT_APPLICABLE)
        self.assertEqual(
            eligibility.source_url,
            "https://www.wcd.gov.in/offerings/women--helpline--scheme",
        )

    def test_women_helpline_availability_is_unknown_without_a_recorded_state(self) -> None:
        result = orchestrate_safety_support(
            "My husband beats me.", jurisdiction="IN"
        )

        self.assertFalse(any(item.phone == "181" for item in result.resources))
        eligibility = next(
            item for item in result.resource_eligibility
            if item.resource_id == "india-women-helpline-181"
        )
        self.assertEqual(eligibility.status, ResourceAvailabilityStatus.JURISDICTION_UNSPECIFIED)
        self.assertEqual(
            eligibility.source_url,
            "https://www.wcd.gov.in/offerings/women--helpline--scheme",
        )

    def test_registry_selects_consumer_helpline_only_when_requested(self) -> None:
        result = orchestrate_safety_support(
            "I want information about a defective product refund.",
            jurisdiction="IN",
            requested_resource_categories=(ResourceCategory.CONSUMER_SUPPORT,),
        )

        helpline = next(
            item for item in result.resources
            if item.resource_id == "india-national-consumer-helpline-1915"
        )
        self.assertEqual(helpline.phone, "1915")
        self.assertEqual(helpline.alternate_phone, "1800-11-4000")
        self.assertIn("national holidays", helpline.availability_note)
        self.assertEqual(
            helpline.source_url,
            "https://consumerhelpline.gov.in/public/index.php/contact",
        )

    def test_she_box_is_selected_for_workplace_sexual_harassment_only(self) -> None:
        sexual = orchestrate_safety_support(
            "My supervisor repeatedly sends unwanted sexual messages at work.",
            jurisdiction="IN",
            state="Maharashtra",
        )
        general = orchestrate_safety_support(
            "My supervisor repeatedly sends unwanted messages at work.",
            jurisdiction="IN",
            state="Maharashtra",
        )

        self.assertTrue(any(item.resource_id == "india-she-box" for item in sexual.resources))
        self.assertFalse(any(item.resource_id == "india-she-box" for item in general.resources))

    def test_general_government_grievance_is_explicitly_requested(self) -> None:
        result = orchestrate_safety_support(
            "I want information about a public authority grievance.",
            jurisdiction="IN",
            requested_resource_categories=(ResourceCategory.GOVERNMENT_GRIEVANCE,),
        )

        self.assertEqual(result.context, AssessmentContext.NONE)
        self.assertIn(ResourceCategory.GOVERNMENT_GRIEVANCE, result.resource_categories)
        self.assertTrue(any(item.name.startswith("Centralized Public Grievance") for item in result.resources))

    def test_empty_registry_does_not_create_contact_details_and_no_one_is_contacted(self) -> None:
        result = SafetySupportOrchestrator(EmptyOfficialResourceRegistry()).assess(
            "I am in immediate danger right now."
        )

        self.assertEqual(result.resources, ())
        self.assertFalse(result.contacted_anyone)
        self.assertNotIn("http", repr(result.as_dict()))
        self.assertFalse(any("call" in item.casefold() for item in result.escalation_options))

    def test_safe_evidence_guidance_does_not_require_collection(self) -> None:
        result = orchestrate_safety_support("He blackmailed me with my private photos.")

        self.assertTrue(any("only if it is safe" in item.casefold() for item in result.evidence_preservation_guidance))
        self.assertTrue(any("do not put yourself at risk" in item.casefold() for item in result.evidence_preservation_guidance))

    def test_unmapped_detector_indicator_still_retains_elevated_screening_state(self) -> None:
        result = orchestrate_safety_support("He won't stop calling me.")

        self.assertEqual(result.context, AssessmentContext.POTENTIALLY_UNSAFE)
        self.assertEqual(result.urgency, SafetyUrgency.ELEVATED)
        self.assertTrue(result.trigger_evidence)
        self.assertIsNotNone(result.user_facing_safety_prompt)

    def test_case_context_from_existing_case_aware_detector_is_used(self) -> None:
        from app.schemas.case_state import CaseState, CaseMetadata, Party

        narrative = "I suspect sexual abuse of a child."
        case_state = CaseState(
            id="case-1",
            initialStatement=narrative,
            parties=[Party(id="child-1", role="child")],
            metadata=CaseMetadata(createdAt="2026-01-01", updatedAt="2026-01-01"),
        )
        result = SafetySupportOrchestrator().assess(narrative, case_state=case_state)

        self.assertIn(SafetySituation.CHILD_SAFETY, result.situations)
        self.assertTrue(any(item.category == "child_safety_concern" for item in result.trigger_evidence))

    def test_unmatched_text_has_no_safety_prompt_and_is_not_a_finding_of_safety(self) -> None:
        result = orchestrate_safety_support("My landlord sent a rent notice.")

        self.assertEqual(result.context, AssessmentContext.NONE)
        self.assertIsNone(result.user_facing_safety_prompt)
        self.assertTrue(any("does not confirm" in item for item in result.uncertainty))
        self.assertEqual(result.workflow_disposition, WorkflowDisposition.ORDINARY_LEGAL)

    def test_sensitive_disclosure_gets_a_gentle_optional_prompt(self) -> None:
        result = orchestrate_safety_support("I feel uncomfortable sharing this.")

        self.assertEqual(result.context, AssessmentContext.SENSITIVE)
        self.assertIn("Share only what feels comfortable", result.user_facing_safety_prompt or "")
        self.assertTrue(any("skip or pause" in item for item in result.safe_next_step_sequence))

    def test_invalid_answers_and_empty_input_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            orchestrate_safety_support("A statement", immediate_danger="maybe")
        with self.assertRaises(ValueError):
            orchestrate_safety_support("  ")
        with self.assertRaises(ValueError):
            orchestrate_safety_support("A statement", language="fr")


if __name__ == "__main__":
    unittest.main()
