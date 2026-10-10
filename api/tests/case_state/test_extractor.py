from __future__ import annotations

import unittest

from app.engines.case_state import extract_case_state


class ExtractCaseStateTests(unittest.TestCase):
    def test_extracts_traceable_statements_events_issues_and_intent(self) -> None:
        state = extract_case_state(
            "My name is Asha Rao. My landlord is Ravi Shah. I live in Pune. "
            "My landlord refused to return my deposit on March 4, 2025. "
            "I want to recover the deposit.",
            case_id="case-1",
            source_id="account-1",
            created_at="2025-01-01T00:00:00+00:00",
        )

        self.assertEqual(state.person.name, "Asha Rao")
        self.assertEqual([(party.name, party.role) for party in state.parties], [
            ("Asha Rao", "client"),
            ("Ravi Shah", "landlord"),
        ])
        self.assertEqual(state.jurisdiction.city, "Pune")
        self.assertEqual(len(state.events), 1)
        self.assertEqual(state.events[0].type, "payment")
        self.assertEqual(state.events[0].date, "March 4, 2025")
        self.assertEqual(state.events[0].datePrecision, "exact")
        self.assertEqual(state.legalIssues[0].category, "housing")
        self.assertEqual(state.intent.objective, "recover the deposit")
        self.assertEqual(len(state.claims), 1)
        self.assertEqual(state.claims[0].evidenceIds, ["account-1"])
        self.assertEqual(state.evidence[0].extractedFacts, [fact.id for fact in state.facts])
        self.assertEqual(state.evidence[0].supportsClaimIds, [state.claims[0].id])

    def test_document_status_is_preserved_and_undated_events_are_unknown(self) -> None:
        state = extract_case_state(
            "The employer withheld wages. The employee reported the issue.",
            case_id="case-2",
            source_id="document-1",
            source_type="document",
        )

        self.assertEqual(state.evidence[0].source, "document")
        self.assertEqual(state.evidence[0].status, "evidence_supported")
        self.assertTrue(all(fact.status == "evidence_supported" for fact in state.facts))
        self.assertTrue(all(claim.status == "evidence_supported" for claim in state.claims))
        self.assertEqual(state.events[0].datePrecision, "unknown")
        self.assertTrue(any("dates" in unknown for unknown in state.unknowns))

    def test_system_source_is_marked_as_inferred(self) -> None:
        state = extract_case_state(
            "A hearing is scheduled for 2025.",
            case_id="case-3",
            source_id="system-1",
            source_type="system",
        )

        self.assertEqual(state.evidence[0].status, "system_inferred")
        self.assertEqual(state.facts[0].status, "system_inferred")
        self.assertEqual(state.events[0].date, "2025")
        self.assertEqual(state.events[0].datePrecision, "approximate")

    def test_hearsay_has_lower_confidence_and_duplicate_sentences_are_deduplicated(self) -> None:
        state = extract_case_state(
            "Someone told me the seller refused a refund. "
            "Someone told me the seller refused a refund.",
            case_id="case-4",
        )

        self.assertEqual(len(state.facts), 1)
        self.assertEqual(state.facts[0].confidence, "low")
        self.assertEqual(len(state.claims), 1)
        self.assertEqual(len(state.evidence[0].extractedFacts), 1)

    def test_ids_are_stable_for_same_case_source_and_content(self) -> None:
        args = {
            "text": "The landlord sent a notice in 2024.",
            "case_id": "case-5",
            "source_id": "notice-1",
            "created_at": "2025-01-01T00:00:00+00:00",
        }
        first = extract_case_state(**args)
        second = extract_case_state(**args)

        self.assertEqual([fact.id for fact in first.facts], [fact.id for fact in second.facts])
        self.assertEqual([event.id for event in first.events], [event.id for event in second.events])
        self.assertEqual(first.facts[0].id, "fact_2e924d92591f3fc9")

    def test_rejects_empty_input_and_invalid_source(self) -> None:
        with self.assertRaises(ValueError):
            extract_case_state("  ", case_id="case-6")
        with self.assertRaises(ValueError):
            extract_case_state("A statement.", case_id="case-6", source_type="unknown")

    def test_phase_1b_english_hinglish_and_hindi_housing_amounts(self) -> None:
        examples = (
            (
                "My landlord did not return my ₹30,000 security deposit.",
                "english",
            ),
            (
                "Mere landlord ne ₹30,000 security deposit wapas nahi kiya.",
                "hinglish",
            ),
            (
                "मेरे मकान मालिक ने तीस हजार रुपये की सुरक्षा जमा वापस नहीं की।",
                "hindi",
            ),
        )
        for index, (text, expected_language) in enumerate(examples, start=1):
            with self.subTest(language=expected_language):
                state = extract_case_state(text, case_id=f"housing-{index}", source_id=f"source-{index}")
                self.assertEqual(state.facts[0].value, text)
                self.assertEqual(state.metadata.language, expected_language)
                self.assertIn(30000, [fact.value for fact in state.facts if fact.key == "amount_inr"])
                self.assertIn("housing", [issue.category for issue in state.legalIssues])
                self.assertIn("landlord", [party.role for party in state.parties])
                amount_fact = next(fact for fact in state.facts if fact.key == "amount_inr")
                self.assertEqual(amount_fact.status, "system_inferred")
                self.assertEqual(amount_fact.sourceIds, [f"source-{index}"])

    def test_hinglish_location_and_noninferred_location(self) -> None:
        state = extract_case_state(
            "Main Jaipur mein rehta hoon. Mere landlord ne ₹30000 deposit wapas nahi kiya.",
            case_id="location-1",
        )
        self.assertEqual(state.jurisdiction.city, "Jaipur")
        self.assertEqual(state.jurisdiction.basis, "user_reported")

        no_location = extract_case_state(
            "Landlord ne deposit wapas nahi kiya.",
            case_id="location-2",
        )
        self.assertIsNone(no_location.jurisdiction.city)
        self.assertTrue(any("location" in unknown.lower() for unknown in no_location.unknowns))

        property_location = extract_case_state(
            "Property Jaipur mein hai.",
            case_id="location-property",
        )
        self.assertEqual(property_location.jurisdiction.city, "Jaipur")

        event_location = extract_case_state(
            "घटना जोधपुर में हुई।",
            case_id="location-event",
        )
        self.assertEqual(event_location.jurisdiction.city, "जोधपुर")

        landmark_only = extract_case_state(
            "My landlord met me at Amber Fort.",
            case_id="location-landmark",
        )
        self.assertIsNone(landmark_only.jurisdiction.city)

    def test_hindi_location_and_employment_variants(self) -> None:
        location = extract_case_state(
            "मैं जयपुर में रहता हूँ। घटना जयपुर में हुई।",
            case_id="location-3",
        )
        self.assertEqual(location.jurisdiction.city, "जयपुर")
        self.assertEqual(location.metadata.language, "hindi")

        hinglish = extract_case_state(
            "Boss ne meri 2 mahine ki salary nahi di.",
            case_id="employment-1",
        )
        self.assertEqual(hinglish.metadata.language, "hinglish")
        self.assertIn("employment", [issue.category for issue in hinglish.legalIssues])
        self.assertIn("employer", [party.role for party in hinglish.parties])
        self.assertTrue(hinglish.claims)

        hindi = extract_case_state(
            "मेरे नियोक्ता ने दो महीने का वेतन नहीं दिया।",
            case_id="employment-2",
        )
        self.assertEqual(hindi.metadata.language, "hindi")
        self.assertIn("employment", [issue.category for issue in hindi.legalIssues])
        self.assertIn("employer", [party.role for party in hindi.parties])
        self.assertTrue(hindi.claims)

        malik = extract_case_state(
            "Mere malik ne meri salary nahi di.",
            case_id="employment-malik",
        )
        self.assertIn("employer", [party.role for party in malik.parties])

    def test_consumer_and_threat_terms_in_hinglish_and_hindi(self) -> None:
        hinglish = extract_case_state(
            "Seller ne damaged phone bheja aur paise wapas nahi kar raha.",
            case_id="consumer-1",
        )
        self.assertIn("consumer", [issue.category for issue in hinglish.legalIssues])
        self.assertIn("seller", [party.role for party in hinglish.parties])
        self.assertTrue(hinglish.claims)

        hindi = extract_case_state(
            "दुकानदार ने खराब सामान दिया और पैसे वापस नहीं कर रहा।",
            case_id="consumer-2",
        )
        self.assertIn("consumer", [issue.category for issue in hindi.legalIssues])
        self.assertIn("seller", [party.role for party in hindi.parties])
        self.assertTrue(hindi.claims)

        hinglish_threat = extract_case_state(
            "Mujhe baar baar dhamki wale messages aa rahe hain.",
            case_id="threat-1",
        )
        self.assertTrue(any(event.type == "threat" for event in hinglish_threat.events))
        criminal_candidate = next(issue for issue in hinglish_threat.legalIssues if issue.category == "criminal")
        self.assertEqual(criminal_candidate.confidence, "low")
        self.assertIn("Candidate issue category", criminal_candidate.rationale[0])

        hindi_threat = extract_case_state(
            "वह मुझे लगातार धमकी दे रहा है।",
            case_id="threat-2",
        )
        self.assertTrue(any(event.type == "threat" for event in hindi_threat.events))
        criminal_candidate = next(issue for issue in hindi_threat.legalIssues if issue.category == "criminal")
        self.assertEqual(criminal_candidate.confidence, "low")
        self.assertIn("Candidate issue category", criminal_candidate.rationale[0])

    def test_document_mentions_do_not_create_uploaded_evidence(self) -> None:
        text = "Agreement aur payment receipt dono mere paas hain."
        state = extract_case_state(text, case_id="documents-1", source_id="account-1")

        self.assertEqual(state.facts[0].value, text)
        mentioned = {fact.value for fact in state.facts if fact.key == "document_mentioned"}
        self.assertEqual(mentioned, {"agreement", "receipt"})
        self.assertTrue(all(
            fact.status == "system_inferred"
            for fact in state.facts
            if fact.key == "document_mentioned"
        ))
        self.assertEqual(len(state.evidence), 1)
        self.assertEqual(state.evidence[0].source, "user")
        self.assertTrue(all(fact.id in state.evidence[0].extractedFacts for fact in state.facts))

    def test_document_derived_party_provenance_and_role_variants(self) -> None:
        state = extract_case_state(
            "Boss ne employee ko salary di nahi. Kirayedar ne malik ko complaint bheji. "
            "Seller ne buyer ko damaged product diya. Police ne company owner se baat ki.",
            case_id="party-roles",
            source_id="statement-1",
            source_type="document",
        )

        roles = {party.role: party for party in state.parties}
        for role in ("employer", "employee", "tenant", "landlord", "seller", "buyer", "police", "company", "owner"):
            self.assertIn(role, roles)
        self.assertTrue(all(
            party.attributes["roleStatus"] == "system_inferred"
            for party in state.parties
        ))
        self.assertTrue(all(
            party.attributes["nameStatus"] == "evidence_supported"
            for party in state.parties
            if party.name
        ))

    def test_housing_unknowns_are_relevant_and_avoid_duplicates(self) -> None:
        state = extract_case_state(
            "Landlord ne deposit wapas nahi kiya.",
            case_id="housing-unknowns",
        )

        unknown_text = " ".join(state.unknowns).lower()
        for expected in ("location", "date", "agreement", "reason", "proof"):
            self.assertIn(expected, unknown_text)
        self.assertEqual(len(state.unknowns), len(set(state.unknowns)))

        unrelated_housing = extract_case_state(
            "My landlord entered the house without permission.",
            case_id="housing-no-deposit",
        )
        unrelated_unknowns = " ".join(unrelated_housing.unknowns).lower()
        self.assertNotIn("deposit", unrelated_unknowns)
        self.assertNotIn("withholding", unrelated_unknowns)

    def test_multilingual_intent_is_preserved_without_translation(self) -> None:
        hinglish = extract_case_state(
            "Mujhe paise wapas chahiye.",
            case_id="intent-1",
        )
        self.assertEqual(hinglish.intent.objective, "paise wapas chahiye")

        hindi = extract_case_state(
            "मैं शिकायत करना चाहती हूँ।",
            case_id="intent-2",
        )
        self.assertEqual(hindi.intent.objective, "शिकायत करना चाहती हूँ")

        deposit = extract_case_state(
            "Deposit wapas chahiye.",
            case_id="intent-3",
        )
        self.assertEqual(deposit.intent.objective, "Deposit wapas chahiye")

    def test_multiple_rupee_amounts_and_date_formats(self) -> None:
        state = extract_case_state(
            "I paid ₹30,000 on 4 March 2025. The seller returned Rs. 1,500 on 04/03/2025.",
            case_id="dates-amounts",
        )

        self.assertEqual(
            [fact.value for fact in state.facts if fact.key == "amount_inr"],
            [30000, 1500],
        )
        self.assertEqual([event.date for event in state.events], ["4 March 2025", "04/03/2025"])
        hindi_date = extract_case_state(
            "मकान मालिक ने 4 मार्च 2025 को जमा वापस नहीं की।",
            case_id="dates-hindi",
        )
        self.assertEqual(hindi_date.events[0].date, "4 मार्च 2025")

        hyphen_date = extract_case_state(
            "The landlord sent a notice on 4-3-2025.",
            case_id="dates-hyphen",
        )
        self.assertEqual(hyphen_date.events[0].date, "4-3-2025")

    def test_all_supported_rupee_amount_styles_normalize_to_additional_facts(self) -> None:
        state = extract_case_state(
            "I paid ₹ 30,000. I paid Rs 30,000. I paid 30,000 रुपये. "
            "I paid 30000 rupees. I also paid tees hazaar rupaye.",
            case_id="amount-styles",
        )
        self.assertEqual(
            [fact.value for fact in state.facts if fact.key == "amount_inr"],
            [30000],
        )
        self.assertTrue(all(
            fact.status == "system_inferred"
            for fact in state.facts
            if fact.key == "amount_inr"
        ))

    def test_unknown_language_uses_supplied_value(self) -> None:
        state = extract_case_state("12345", case_id="language-unknown", language="en-custom")
        self.assertEqual(state.metadata.language, "en-custom")


if __name__ == "__main__":
    unittest.main()
