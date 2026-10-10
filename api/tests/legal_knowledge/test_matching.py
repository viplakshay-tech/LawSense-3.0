from __future__ import annotations

import unittest

from app.engines.legal_twin import EdgeType, NodeType, build_legal_twin
from app.services.case_pipeline import CasePipelineRequest, run_case_pipeline


class LegalMatchTests(unittest.TestCase):
    def test_case_analysis_returns_explainable_candidates_and_official_aid_links(self) -> None:
        result = run_case_pipeline(CasePipelineRequest(
            case_id="case-law-match-consumer",
            initial_statement="I bought a defective phone and the seller refused my refund after I asked.",
            recorded_at="2026-10-10T04:00:00+00:00",
        ))
        summary = result.case_analysis.legal_knowledge

        consumer = [item for item in summary.law_matches if item.jurisdiction["classification"] == "central"]
        self.assertTrue(consumer)
        match = next(item for item in consumer if item.provision_reference == "Section 2(10)")
        self.assertIn(match.evidence_assessment, {"plausible", "unclear"})
        self.assertIn("user_reported", {fact.status for fact in match.supporting_facts})
        self.assertEqual(match.source["verification_status"], "verified")
        self.assertTrue(match.source["url"].startswith((
            "https://indiacode.gov.in/",
            "https://www.indiacode.nic.in/",
        )))
        self.assertTrue(match.missing_facts)
        self.assertNotIn("score", match.model_dump())
        self.assertLessEqual(len(match.clarifying_questions), 3)
        self.assertFalse(any("property" in question.casefold() for question in match.clarifying_questions))
        self.assertEqual(match.official_filing_links["status"], "not_found_in_verified_procedure_records")
        self.assertTrue(any(item.id == "nalsa-legal-aid-application" for item in summary.support_resources))
        self.assertTrue(any(item.id == "nalsa-womens-assistance" for item in summary.support_resources))

    def test_candidate_survives_unknown_jurisdiction_and_links_into_legal_twin(self) -> None:
        result = run_case_pipeline(CasePipelineRequest(
            case_id="case-law-match-twin",
            initial_statement="My landlord kept the rental security deposit after I moved out.",
            recorded_at="2026-10-10T04:00:00+00:00",
        ))
        analysis = result.case_analysis
        self.assertTrue(analysis.legal_knowledge.law_matches)
        candidate = analysis.legal_knowledge.law_matches[0]
        self.assertEqual(candidate.jurisdiction["match_status"], "unknown")
        self.assertEqual(candidate.evidence_assessment, "plausible")

        result.case_state.analysis = analysis
        twin = build_legal_twin(result.case_state)
        law_node = next(
            node for node in twin.nodes.values()
            if node.kind is NodeType.LAW and node.properties.get("record_id") == candidate.candidate_id
        )
        self.assertIn("law_candidate_match", law_node.properties)
        self.assertEqual(law_node.properties["source_applicability_status"], "applicability_not_established")
        self.assertTrue(any(
            edge.source_id == law_node.id and edge.kind is EdgeType.RELATES_TO
            for edge in twin.edges.values()
        ))

    def test_wage_candidate_surfaces_gazette_transition_caution_without_date(self) -> None:
        result = run_case_pipeline(CasePipelineRequest(
            case_id="case-law-match-wage-transition",
            initial_statement="My employer has not paid my wages for two months.",
            recorded_at="2026-10-10T04:00:00+00:00",
        ))
        match = next(
            item for item in result.case_analysis.legal_knowledge.law_matches
            if item.candidate_id == "provision-code-on-wages-2019-section-17"
        )
        self.assertEqual(match.evidence_assessment, "plausible")
        self.assertIn("21 November 2025", match.temporal_limitation)
        self.assertIn("section 69", match.temporal_limitation)
        self.assertIn("S.O. 5322(E)", match.temporal_limitation)
        self.assertTrue(any(
            link["url"] == "https://egazette.gov.in/WriteReadData/2025/267885.pdf"
            for link in match.official_source_links
        ))

    def test_workplace_harassment_uses_posh_sources_not_generic_wage_match(self) -> None:
        result = run_case_pipeline(CasePipelineRequest(
            case_id="case-posh-synthetic-demo",
            initial_statement=(
                "In Bengaluru, India, a woman employee reports that a supervisor repeatedly "
                "sent unwanted sexual messages after she asked him to stop. She kept a screenshot. "
                "Unknown: employer headcount, incident dates, whether an Internal Committee exists, "
                "and whether a written complaint was made."
            ),
            recorded_at="2026-10-10T04:00:00+00:00",
        ))
        case = result.case_state
        matches = result.case_analysis.legal_knowledge.law_matches

        self.assertEqual(case.jurisdiction.country, "India")
        self.assertEqual(case.jurisdiction.city, "Bengaluru")
        self.assertIn("workplace_harassment", {issue.category for issue in case.legalIssues})
        self.assertTrue(any(item.candidate_id == "provision-posh-2013-section-3" for item in matches))
        self.assertFalse(any(item.candidate_id == "provision-code-on-wages-2019-section-17" for item in matches))
        self.assertFalse(any(
            item.id == "provision-code-on-wages-2019-section-17"
            for item in result.case_analysis.legal_knowledge.records
        ))
        posh = next(item for item in matches if item.candidate_id == "provision-posh-2013-section-3")
        self.assertEqual(posh.jurisdiction["match_status"], "matched")
        self.assertTrue(any("Internal Committee" in question for question in posh.clarifying_questions))
        self.assertTrue(any("written complaint" in question for question in posh.clarifying_questions))
        self.assertTrue(any("date" in question for question in posh.clarifying_questions))

    def test_browser_workplace_harassment_scenario_does_not_attach_unmatched_wage_provision(self) -> None:
        result = run_case_pipeline(CasePipelineRequest(
            case_id="case-posh-browser-synthetic-demo",
            initial_statement=(
                "SYNTHETIC TEST ONLY: At a fictional workplace in Pune, a coworker sent "
                "repeated unwanted sexual messages after I asked them to stop on 8 October 2026. "
                "I saved screenshots and asked the workplace contact for help. I want to understand "
                "safety options and what information is still unknown."
            ),
            recorded_at="2026-10-10T04:00:00+00:00",
        ))
        matches = result.case_analysis.legal_knowledge.law_matches
        record_ids = {item.id for item in result.case_analysis.legal_knowledge.records}

        self.assertTrue(any(item.candidate_id == "provision-posh-2013-section-3" for item in matches))
        self.assertFalse(any(item.candidate_id == "provision-code-on-wages-2019-section-17" for item in matches))
        self.assertNotIn("provision-code-on-wages-2019-section-17", record_ids)
        self.assertTrue(all(
            fact.status == "user_reported"
            for match in matches
            for fact in match.supporting_facts
        ))


if __name__ == "__main__":
    unittest.main()
