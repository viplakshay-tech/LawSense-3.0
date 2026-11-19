from __future__ import annotations

import unittest

from app.services.local_assistant import _SYSTEM_PROMPT


class GuideConversationStyleTests(unittest.TestCase):
    def test_guide_is_instructed_to_use_plain_conversational_language(self) -> None:
        self.assertIn("everyday words", _SYSTEM_PROMPT)
        self.assertIn("not a software manual", _SYSTEM_PROMPT)
        self.assertIn("two to four brief sentences", _SYSTEM_PROMPT)
        self.assertIn("Ask at most ONE clear, relevant follow-up question", _SYSTEM_PROMPT)

    def test_guide_matches_english_hindi_and_hinglish_without_forcing_register(self) -> None:
        self.assertIn("English, Hindi, or Hinglish", _SYSTEM_PROMPT)
        self.assertIn("Do not force formal Hindi", _SYSTEM_PROMPT)

    def test_guide_keeps_legal_decision_making_out_of_the_chat_model(self) -> None:
        self.assertIn("Never decide whether a law applies", _SYSTEM_PROMPT)
        self.assertIn("source-governed analysis", _SYSTEM_PROMPT)
        self.assertIn("real lawyer", _SYSTEM_PROMPT)

    def test_guide_does_not_expose_internal_implementation_terms(self) -> None:
        self.assertIn("Do not expose internal system terms", _SYSTEM_PROMPT)
        self.assertIn("CaseState", _SYSTEM_PROMPT)

    def test_guide_requires_one_json_response_and_an_allowlisted_action(self) -> None:
        self.assertIn('{"reply":"short, natural user-facing text","proposed_action":null}', _SYSTEM_PROMPT)
        self.assertIn("one exact action name from the supplied allowlist", _SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
