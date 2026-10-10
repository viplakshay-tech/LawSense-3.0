from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.db import database
from app.engines.journey import JourneyStage, build_journey
from app.engines.safety import detect_safety_context
from app.schemas.case_state import CaseState
try:
    from .test_service_integration import _asgi_request
except ImportError:
    from test_service_integration import _asgi_request


FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"
SCENARIO_FIXTURES = tuple(sorted(FIXTURES_DIR.glob("*.json")))


def _load_scenarios() -> list[dict[str, object]]:
    return [json.loads(path.read_text(encoding="utf-8")) for path in SCENARIO_FIXTURES]


class DemoHarnessIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.db_path_patch = patch.object(database, "DB_PATH", Path(self.temp_dir.name) / "demo.db")
        self.db_path_patch.start()
        self.addCleanup(self.db_path_patch.stop)
        database.init_db()

    def test_fixture_set_is_complete_and_structured(self) -> None:
        scenarios = _load_scenarios()
        self.assertEqual(
            {scenario["scenario_id"] for scenario in scenarios},
            {
                "housing_security_deposit",
                "housing_security_deposit_hinglish",
                "housing_security_deposit_hindi",
                "unpaid_salary",
                "damaged_product_refund",
                "threatening_messages",
                "workplace_harassment",
                "debt_repayment_dispute",
                "incomplete_jurisdiction",
            },
        )
        for scenario in scenarios:
            with self.subTest(scenario=scenario["scenario_id"]):
                source = scenario["source"]
                expected = scenario["expected"]
                self.assertTrue(source["user_statement"].strip())
                self.assertTrue(source["language"])
                self.assertTrue(expected["issue_categories"])
                self.assertIn("parties", expected)
                self.assertIn("event_types", expected)
                self.assertIn("unknowns", expected)
                self.assertIn(expected["safety_state"]["context"], {"none", "sensitive", "potentially_unsafe", "urgent_safety_context"})
                # Legal analysis in these demo records remains issue-category only.
                self.assertFalse(any("section" in key.lower() or "conclusion" in key.lower() for key in expected))

    def test_health_endpoint(self) -> None:
        status, body = _asgi_request("GET", "/health")

        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["service"], "lawsense-api")

    def test_scenario_fixtures_flow_through_create_read_extraction_and_persistence(self) -> None:
        for scenario in _load_scenarios():
            with self.subTest(scenario=scenario["scenario_id"]):
                source = scenario["source"]
                expected = scenario["expected"]
                statement = source["user_statement"]
                status, body = _asgi_request(
                    "POST",
                    "/cases",
                    {"initialStatement": statement, "language": source["language"]},
                )
                self.assertEqual(status, 201, body)
                created = CaseState.model_validate(body)

                get_status, stored_body = _asgi_request("GET", f"/cases/{created.id}")
                self.assertEqual(get_status, 200, stored_body)
                stored = CaseState.model_validate(stored_body)
                self.assertEqual(stored, created)
                self.assertEqual(stored.initialStatement, statement)
                self.assertEqual(stored.metadata.language, source["language"])
                self.assertIsNotNone(stored.analysis)
                self.assertEqual(
                    stored.analysis.safety_context.context,
                    expected["safety_state"]["context"],
                )
                indexed_categories = {
                    "housing",
                    "consumer",
                    "employment",
                    "family",
                    "dowry_related_harassment",
                    "workplace_harassment",
                }
                has_seed_match = bool(indexed_categories & set(expected["issue_categories"]))
                self.assertEqual(
                    stored.analysis.legal_knowledge.status,
                    "records_found" if has_seed_match else "empty",
                )
                if has_seed_match:
                    self.assertTrue(stored.analysis.legal_knowledge.records)
                    self.assertTrue(all(
                        item.status == "verified"
                        and (item.source_url or any(source.source_url for source in item.provenance))
                        for item in stored.analysis.legal_knowledge.records
                    ))
                else:
                    self.assertEqual(stored.analysis.legal_knowledge.records, [])
                self.assertEqual(stored.analysis.journey.case_id, stored.id)

                actual_categories = {issue.category for issue in stored.legalIssues}
                self.assertTrue(set(expected["issue_categories"]).issubset(actual_categories))
                actual_parties = {(party.role, party.name) for party in stored.parties}
                for party in expected["parties"]:
                    self.assertIn((party["role"], party["name"]), actual_parties)
                actual_event_types = {event.type for event in stored.events}
                self.assertTrue(set(expected["event_types"]).issubset(actual_event_types))
                for unknown in expected["unknowns"]:
                    self.assertTrue(
                        any(unknown.casefold() in item.casefold() for item in stored.unknowns),
                        f"Expected unknown containing {unknown!r}; got {stored.unknowns!r}",
                    )

                source_evidence = next(item for item in stored.evidence if item.source == "user")
                self.assertEqual(source_evidence.status, "user_reported")
                self.assertTrue(source_evidence.extractedFacts)
                if expected["safety_state"]["indicator_categories"]:
                    safety = stored.analysis.safety_context
                    self.assertEqual(safety.assessment_status, "system_inferred")
                    self.assertTrue(safety.source_ids)
                    self.assertTrue(all(
                        source_evidence.id in indicator.source_ids
                        for indicator in safety.indicators
                    ))
                for fact_id in source_evidence.extractedFacts:
                    fact = next(item for item in stored.facts if item.id == fact_id)
                    self.assertIn(source_evidence.id, fact.sourceIds)

    def test_safety_engine_interface_matches_each_fixture(self) -> None:
        for scenario in _load_scenarios():
            with self.subTest(scenario=scenario["scenario_id"]):
                statement = scenario["source"]["user_statement"]
                expected = scenario["expected"]["safety_state"]
                assessment = detect_safety_context(statement)

                self.assertEqual(assessment.source_text, statement)
                self.assertEqual(assessment.context.value, expected["context"])
                self.assertEqual(assessment.urgency.value, expected["urgency"])
                actual_indicators = {indicator.category for indicator in assessment.indicators}
                self.assertTrue(set(expected["indicator_categories"]).issubset(actual_indicators))

    def test_journey_engine_interface_accepts_persisted_case_state(self) -> None:
        expected_stages = (
            JourneyStage.UNDERSTAND,
            JourneyStage.FACTS,
            JourneyStage.EVIDENCE,
            JourneyStage.LAW,
            JourneyStage.OPTIONS,
            JourneyStage.NEXT_STEP,
        )
        for scenario in _load_scenarios():
            with self.subTest(scenario=scenario["scenario_id"]):
                source = scenario["source"]
                status, body = _asgi_request(
                    "POST",
                    "/cases",
                    {"initialStatement": source["user_statement"], "language": source["language"]},
                )
                self.assertEqual(status, 201, body)
                case = CaseState.model_validate(body)
                journey = build_journey(case)

                self.assertEqual(journey.case_id, case.id)
                self.assertEqual(tuple(dict.fromkeys(step.stage for step in journey.steps)), expected_stages)
                self.assertTrue(journey.unknowns or journey.required_evidence)
                self.assertTrue(journey.possible_paths)
                self.assertTrue(all(path.status == "verification_required" for path in journey.possible_paths))
                self.assertTrue(all("verification required" in path.description.casefold() for path in journey.possible_paths))

                if scenario["scenario_id"] == "threatening_messages":
                    self.assertTrue(journey.escalation_points)
                    self.assertTrue(any(action.condition for action in journey.next_actions))
                if scenario["scenario_id"] == "incomplete_jurisdiction":
                    self.assertEqual(journey.jurisdiction_status, "unknown")
                    self.assertTrue(all(path.jurisdiction_required for path in journey.possible_paths))

    def test_case_routes_return_client_errors_for_invalid_and_missing_cases(self) -> None:
        invalid_status, _ = _asgi_request("POST", "/cases", {"initialStatement": ""})
        missing_status, _ = _asgi_request("GET", "/cases/not-a-saved-case")

        self.assertEqual(invalid_status, 422)
        self.assertEqual(missing_status, 404)

if __name__ == "__main__":
    unittest.main()
