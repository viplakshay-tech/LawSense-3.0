from __future__ import annotations

from dataclasses import replace
import unittest

from app.engines.case_state import extract_case_state
from app.engines.decision_simulator import VERIFICATION_REQUIRED, simulate_decision
from app.engines.journey import PossiblePath, build_journey
from app.schemas.case_state import EvidenceItem


class DecisionSimulatorTests(unittest.TestCase):
    def _state(self, text: str, case_id: str):
        return extract_case_state(
            text,
            case_id=case_id,
            created_at="2026-01-01T00:00:00+00:00",
        )

    def _simulate(self, text: str, case_id: str):
        state = self._state(text, case_id)
        journey = build_journey(state)
        return state, journey, simulate_decision(state, journey)

    def test_landlord_deposit_keeps_candidate_unverified_and_lists_records(self) -> None:
        state, _journey, scenario = self._simulate(
            "My landlord kept my ₹30,000 deposit after I moved out.",
            "sim-housing",
        )

        self.assertEqual(scenario.case_id, state.id)
        self.assertIn("housing/security-deposit", scenario.current_state)
        self.assertTrue(scenario.paths)
        self.assertTrue(all(path.status == "verification_required" for path in scenario.paths))
        self.assertTrue(all(path.description == VERIFICATION_REQUIRED for path in scenario.paths))
        evidence = " ".join(item.item for item in scenario.required_evidence).casefold()
        self.assertIn("deposit", evidence)
        self.assertTrue(scenario.required_documents)

    def test_unpaid_salary_has_pay_records_and_jurisdiction_blocker(self) -> None:
        state, _journey, scenario = self._simulate(
            "My employer has not paid my wages for two months.",
            "sim-salary",
        )

        evidence = " ".join(item.item for item in scenario.required_evidence).casefold()
        self.assertIn("pay statements", evidence)
        self.assertTrue(any("jurisdiction is unknown" in item.description for item in scenario.blocking_conditions))
        self.assertIn("Confirm the country", scenario.next_action)

    def test_consumer_refund_has_transaction_and_condition_records(self) -> None:
        _state, _journey, scenario = self._simulate(
            "The seller sent a damaged phone and has not refunded me.",
            "sim-consumer",
        )

        evidence = " ".join(item.item for item in scenario.required_evidence).casefold()
        self.assertIn("receipt", evidence)
        self.assertIn("condition", evidence)
        self.assertTrue(scenario.unknowns)
        self.assertEqual(scenario.legal_information_status, VERIFICATION_REQUIRED)

    def test_incomplete_case_is_returned_with_clarification_blocker(self) -> None:
        _state, _journey, scenario = self._simulate(
            "Something happened and I need help understanding it.",
            "sim-incomplete",
        )

        self.assertIn("not contain enough information", scenario.current_state)
        self.assertTrue(any("issue type is not established" in item.description for item in scenario.blocking_conditions))
        self.assertIn("Clarify what happened", scenario.next_action)
        self.assertTrue(scenario.paths)

    def test_conflicting_evidence_is_reported_without_resolving_it(self) -> None:
        state = self._state(
            "My landlord kept my deposit after I moved out.",
            "sim-conflicting",
        )
        state.evidence.append(EvidenceItem(
            id="evidence-conflict",
            type="message",
            title="Conflicting deposit message",
            source="document",
            status="conflicting",
        ))
        journey = build_journey(state)

        scenario = simulate_decision(state, journey)

        self.assertTrue(any("conflicting facts or evidence" in item.description for item in scenario.risks))
        self.assertTrue(any(item.related_to == "conflicting_evidence" for item in scenario.unknowns))
        self.assertTrue(any("need review" in item.description for item in scenario.blocking_conditions))
        self.assertIn("Review the conflicting records", scenario.next_action)
        self.assertTrue(all(path.status == "verification_required" for path in scenario.paths))

    def test_empty_legal_knowledge_and_repeated_calls_are_deterministic(self) -> None:
        state = self._state("My employer withheld my salary.", "sim-empty-knowledge")
        journey = build_journey(state)

        first = simulate_decision(state, journey)
        second = simulate_decision(state, journey)

        self.assertEqual(first, second)
        self.assertEqual(first.legal_information_status, VERIFICATION_REQUIRED)
        self.assertTrue(all(path.status == "verification_required" for path in first.paths))

    def test_multiple_journey_candidates_are_preserved_without_ranking(self) -> None:
        state = self._state("My landlord kept my deposit.", "sim-candidates")
        journey = build_journey(state)
        journey = replace(journey, possible_paths=(
            PossiblePath(id="candidate-a", label="Candidate from journey A", description="Source supplied."),
            PossiblePath(id="candidate-b", label="Candidate from journey B", description="Source supplied."),
        ))

        scenario = simulate_decision(state, journey)

        self.assertEqual(tuple(path.label for path in scenario.paths), ("Candidate from journey A", "Candidate from journey B"))
        self.assertTrue(all(path.status == "verification_required" for path in scenario.paths))
        self.assertTrue(all(path.description == VERIFICATION_REQUIRED for path in scenario.paths))
        self.assertFalse(hasattr(scenario, "win_probability"))
        self.assertFalse(hasattr(scenario, "success_percentage"))
        self.assertFalse(hasattr(scenario, "guaranteed_result"))

    def test_journey_must_belong_to_case_state(self) -> None:
        state = self._state("My employer withheld my salary.", "sim-case-a")
        other_state = self._state("My landlord kept my deposit.", "sim-case-b")

        with self.assertRaisesRegex(ValueError, "must belong"):
            simulate_decision(state, build_journey(other_state))


if __name__ == "__main__":
    unittest.main()
