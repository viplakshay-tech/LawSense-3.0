from __future__ import annotations

import unittest

from app.engines.safety import SafetyCategory, SafetyUrgency, detect_safety_context


class SafetyDetectorTests(unittest.TestCase):
    def test_repeated_hinglish_threat_messages_are_potentially_unsafe(self) -> None:
        text = "Mujhe baar baar dhamki wale messages aa rahe hain."
        result = detect_safety_context(text)

        self.assertEqual(result.context, SafetyCategory.POTENTIALLY_UNSAFE)
        self.assertEqual(result.urgency, SafetyUrgency.ELEVATED)
        self.assertIn("threat", {item.category for item in result.indicators})
        self.assertEqual(result.source_text, text)
        self.assertEqual(result.indicators[0].source_text, text)
        self.assertIn("may indicate", result.recommended_safety_prompt or "")

    def test_conditional_hinglish_money_threat_is_detected(self) -> None:
        result = detect_safety_context("Usne bola agar paise nahi diye to dekh lena.")

        self.assertEqual(result.context, SafetyCategory.POTENTIALLY_UNSAFE)
        self.assertIn("threat", {item.category for item in result.indicators})
        self.assertTrue(any("dekh lena" in item.matched_text.lower() for item in result.indicators))

    def test_english_immediate_danger_is_urgent(self) -> None:
        result = detect_safety_context("I am in immediate danger right now; he is outside with a knife.")

        self.assertEqual(result.context, SafetyCategory.URGENT_SAFETY_CONTEXT)
        self.assertEqual(result.urgency, SafetyUrgency.URGENT)
        self.assertIn("immediate_danger", {item.category for item in result.indicators})
        self.assertIsNotNone(result.recommended_safety_prompt)

    def test_hindi_forced_isolation_and_financial_control(self) -> None:
        result = detect_safety_context(
            "वह मुझे दोस्तों से मिलने नहीं देता और मेरी पूरी तनख्वाह ले लेता है।"
        )

        categories = {item.category for item in result.indicators}
        self.assertIn("forced_isolation", categories)
        self.assertIn("financial_control", categories)
        self.assertEqual(result.context, SafetyCategory.POTENTIALLY_UNSAFE)

    def test_hinglish_stalking_and_coercion(self) -> None:
        result = detect_safety_context(
            "Woh mera peecha karta hai aur mujhe zabardasti sign karne ko bolta hai."
        )

        categories = {item.category for item in result.indicators}
        self.assertIn("stalking", categories)
        self.assertIn("coercion", categories)

    def test_each_requested_behavior_has_a_specific_rule_match(self) -> None:
        examples = {
            "threat": "He threatened to hurt me.",
            "stalking": "He keeps following me everywhere.",
            "harassment": "He won't stop messaging me.",
            "domestic_violence": "My husband beats me.",
            "sexual_violence": "He forced me to have sex without my consent.",
            "blackmail": "He blackmailed me with my private photos.",
            "coercion": "He forced me to sign the contract.",
            "intimidation": "He is intimidating me.",
            "forced_isolation": "She won't let me meet my friends.",
            "financial_control": "He controls all my money.",
            "exploitation": "They forced me to work without pay.",
            "immediate_danger": "I am in immediate danger right now.",
        }
        for expected_category, text in examples.items():
            with self.subTest(category=expected_category):
                result = detect_safety_context(text)
                self.assertIn(expected_category, {item.category for item in result.indicators})

    def test_sensitive_distress_without_behavioral_indicator(self) -> None:
        result = detect_safety_context("I feel unsafe and this is hard to talk about.")

        self.assertEqual(result.context, SafetyCategory.SENSITIVE)
        self.assertEqual(result.urgency, SafetyUrgency.NONE)
        self.assertEqual(result.indicators, ())

    def test_ordinary_legal_dispute_does_not_trigger_safety_context(self) -> None:
        result = detect_safety_context(
            "My landlord sent a legal notice because I missed rent. "
            "I am preparing documents for the hearing."
        )

        self.assertEqual(result.context, SafetyCategory.NONE)
        self.assertEqual(result.urgency, SafetyUrgency.NONE)
        self.assertEqual(result.indicators, ())
        self.assertIsNone(result.recommended_safety_prompt)

    def test_legal_action_and_explicit_denial_do_not_trigger_threat(self) -> None:
        for text in (
            "The other party threatened legal action over the unpaid invoice.",
            "I was never threatened, and I am not in immediate danger right now.",
        ):
            with self.subTest(text=text):
                result = detect_safety_context(text)
                self.assertEqual(result.context, SafetyCategory.NONE)
                self.assertEqual(result.indicators, ())

    def test_structured_result_is_json_compatible_and_traceable(self) -> None:
        text = "My partner forced me to have sex without my consent."
        result = detect_safety_context(text)
        payload = result.as_dict()

        self.assertEqual(payload["context"], "potentially_unsafe")
        self.assertEqual(payload["source_text"], text)
        self.assertTrue(any(
            item["category"] == "sexual_violence" and item["source_text"] == text
            for item in payload["indicators"]
        ))

    def test_empty_or_non_string_input_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            detect_safety_context("  ")
        with self.assertRaises(TypeError):
            detect_safety_context(None)  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
