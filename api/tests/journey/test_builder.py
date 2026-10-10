from __future__ import annotations

import unittest

from app.engines.case_state import extract_case_state
from app.engines.journey import (
    LEGAL_KNOWLEDGE_REQUIRED,
    JourneyStage,
    build_journey,
)


class BuildJourneyTests(unittest.TestCase):
    def _state(self, text: str, case_id: str):
        return extract_case_state(
            text,
            case_id=case_id,
            created_at="2026-01-01T00:00:00+00:00",
        )

    def test_housing_deposit_journey_requests_facts_and_records(self) -> None:
        state = self._state(
            "My landlord did not return my ₹30,000 security deposit.",
            "journey-housing",
        )

        journey = build_journey(state)

        self.assertIn("housing/security-deposit", journey.current_situation)
        self.assertEqual(journey.jurisdiction_status, "unknown")
        questions = " ".join(item.question for item in journey.unknowns).casefold()
        self.assertIn("agreement", questions)
        self.assertIn("reason", questions)
        evidence = " ".join(item.item for item in journey.required_evidence).casefold()
        for expected in ("payment record", "messages", "move-in", "deposit"):
            self.assertIn(expected, evidence)
        self.assertTrue(journey.required_documents)
        self.assertEqual(journey.possible_paths[0].description, LEGAL_KNOWLEDGE_REQUIRED)

    def test_employment_journey_is_fact_and_record_oriented(self) -> None:
        state = self._state(
            "My employer has not paid my wages for April 2026.",
            "journey-employment",
        )

        journey = build_journey(state)

        self.assertIn("employment/pay", journey.current_situation)
        self.assertTrue(any("employment terms" in item.question for item in journey.unknowns))
        evidence = " ".join(item.item for item in journey.required_evidence).casefold()
        self.assertIn("pay statements", evidence)
        self.assertIn("communications", evidence)

    def test_consumer_journey_collects_transaction_and_product_context(self) -> None:
        state = self._state(
            "The seller sent a damaged phone and has not refunded me.",
            "journey-consumer",
        )

        journey = build_journey(state)

        self.assertIn("consumer", journey.current_situation)
        questions = " ".join(item.question for item in journey.unknowns).casefold()
        self.assertIn("purchased", questions)
        self.assertIn("response", questions)
        evidence = " ".join(item.item for item in journey.required_evidence).casefold()
        self.assertIn("receipt", evidence)
        self.assertIn("condition", evidence)

    def test_threat_sensitive_journey_has_conditional_safety_escalation(self) -> None:
        state = self._state(
            "Someone has repeatedly threatened me in messages.",
            "journey-threat",
        )

        journey = build_journey(state)

        self.assertIn("safety status is unknown", journey.current_situation)
        self.assertEqual(len(journey.escalation_points), 1)
        self.assertIn("immediate danger", journey.escalation_points[0].escalation_trigger)
        self.assertTrue(any(action.condition and "local emergency services" in action.condition for action in journey.next_actions))
        evidence = " ".join(item.item for item in journey.required_evidence).casefold()
        self.assertIn("screenshots", evidence)
        self.assertIn("voicemail", evidence)

    def test_incomplete_case_still_has_all_pipeline_stages(self) -> None:
        state = self._state("Something happened and I need help understanding it.", "journey-incomplete")

        journey = build_journey(state)

        self.assertIn("does not contain enough information", journey.current_situation)
        self.assertTrue(journey.unknowns)
        self.assertEqual(
            tuple(dict.fromkeys(step.stage for step in journey.steps)),
            (
                JourneyStage.UNDERSTAND,
                JourneyStage.FACTS,
                JourneyStage.EVIDENCE,
                JourneyStage.LAW,
                JourneyStage.OPTIONS,
                JourneyStage.NEXT_STEP,
            ),
        )
        self.assertEqual(journey.steps_for(JourneyStage.LAW)[0].description, LEGAL_KNOWLEDGE_REQUIRED)
        self.assertEqual(journey.steps_for(JourneyStage.OPTIONS)[0].description, LEGAL_KNOWLEDGE_REQUIRED)

    def test_unknown_jurisdiction_blocks_procedural_route_claims(self) -> None:
        state = self._state("My landlord kept my deposit after I moved out.", "journey-no-jurisdiction")

        journey = build_journey(state)

        self.assertEqual(journey.jurisdiction_status, "unknown")
        self.assertTrue(any("country, state, district, or city" in item.question for item in journey.unknowns))
        self.assertTrue(all(path.jurisdiction_required for path in journey.possible_paths))
        self.assertTrue(all(path.status == "verification_required" for path in journey.possible_paths))
        self.assertEqual(journey.legal_knowledge_status, LEGAL_KNOWLEDGE_REQUIRED)

    def test_identical_case_state_produces_identical_journey(self) -> None:
        state = self._state("My landlord did not return my deposit.", "journey-deterministic")

        self.assertEqual(build_journey(state), build_journey(state))


if __name__ == "__main__":
    unittest.main()
