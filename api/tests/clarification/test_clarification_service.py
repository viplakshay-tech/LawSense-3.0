from __future__ import annotations

import unittest

from app.engines.journey.models import Unknown
from app.schemas.case_state import CaseMetadata, CaseState, EvidenceItem, Jurisdiction
from app.services.clarification import (
    apply_clarification_answer,
    build_clarification_questions,
    normalize_unanswered_clarification_records,
    skip_clarification_question,
)


class ClarificationServiceTests(unittest.TestCase):
    def _state(self, **values) -> CaseState:
        data = {
            "id": "clarification-case",
            "initialStatement": "My landlord kept my deposit.",
            "metadata": CaseMetadata(
                createdAt="2026-01-01T00:00:00+00:00",
                updatedAt="2026-01-01T00:00:00+00:00",
                language="english",
            ),
        }
        data.update(values)
        return CaseState(**data)

    def test_questions_are_grounded_deduplicated_and_prioritized(self) -> None:
        state = self._state(unknowns=[
            "The date of the deposit payment is not stated.",
            "The landlord's name is not stated.",
            "The location of the property is not stated.",
            "Whether records exist for the payment is not stated.",
            "What the person wants help understanding is not stated.",
        ])
        journey = [
            Unknown("u-location", "Which country, state, district, or city is relevant?"),
            Unknown("u-dates", "What dates and sequence are relevant?"),
            Unknown("u-safety", "Whether anyone is in immediate danger now is not known.", priority="urgent"),
        ]

        result = build_clarification_questions(state, journey, limit=None)

        self.assertEqual(
            [item.category for item in result.questions],
            ["safety", "jurisdiction", "dates", "objective", "evidence", "parties"],
        )
        self.assertEqual(result.questions[0].priority, 0)
        jurisdiction = result.questions[1]
        self.assertEqual(jurisdiction.language, "english")
        self.assertEqual(
            {item.source_type for item in jurisdiction.sources},
            {"case_state", "journey"},
        )
        self.assertEqual(
            sum(item.category == "jurisdiction" for item in result.questions),
            1,
        )

    def test_localization_is_deterministic_and_only_for_actual_unknowns(self) -> None:
        state = self._state(
            metadata=CaseMetadata(
                createdAt="2026-01-01T00:00:00+00:00",
                updatedAt="2026-01-01T00:00:00+00:00",
                language="hindi",
            ),
            unknowns=["The dates of the described events are not stated clearly."],
        )

        first = build_clarification_questions(state, journey_unknowns=(), limit=None)
        second = build_clarification_questions(state, journey_unknowns=(), limit=None)

        self.assertEqual(first, second)
        self.assertEqual(len(first.questions), 1)
        self.assertEqual(first.questions[0].language, "hindi")
        self.assertIn("तारीखें", first.questions[0].question)
        self.assertTrue(first.questions[0].sources)
        self.assertEqual(
            build_clarification_questions(self._state(), journey_unknowns=()).questions,
            (),
        )

    def test_stale_unknowns_are_skipped_when_case_state_already_answers_them(self) -> None:
        state = self._state(
            jurisdiction=Jurisdiction(city="Pune", basis="user_reported"),
        )
        journey = [Unknown("u-location", "Which country, state, district, or city is relevant?")]

        result = build_clarification_questions(state, journey, limit=None)

        self.assertEqual(result.questions, ())

    def test_hinglish_language_can_be_selected_explicitly(self) -> None:
        state = self._state(unknowns=["Which country, state, district, or city is relevant?"])

        result = build_clarification_questions(state, journey_unknowns=(), language="hinglish")

        self.assertEqual(result.questions[0].language, "hinglish")
        self.assertIn("kahan", result.questions[0].question.casefold())

    def test_answer_updates_case_state_with_user_source_and_removes_unknown(self) -> None:
        original_text = "My landlord kept my deposit."
        state = self._state(unknowns=["What the person wants help understanding is not stated."])
        question = build_clarification_questions(state, journey_unknowns=()).next_question
        assert question is not None

        updated = apply_clarification_answer(
            state,
            question,
            "I want to understand how to request the deposit back.",
            answered_at="2026-03-01T00:00:00+00:00",
        )

        self.assertEqual(updated.initialStatement, original_text)
        self.assertEqual(updated.unknowns, [])
        self.assertEqual(updated.intent.objective, "I want to understand how to request the deposit back.")
        answer_fact = updated.facts[-1]
        answer_source = updated.evidence[-1]
        self.assertEqual(answer_fact.status, "user_reported")
        self.assertEqual(answer_fact.value, "I want to understand how to request the deposit back.")
        self.assertEqual(answer_fact.sourceIds, [answer_source.id])
        self.assertEqual(answer_source.source, "user")
        self.assertEqual(answer_source.extractedFacts, [answer_fact.id])
        self.assertIn(question.id, answer_fact.notes)
        self.assertIsNone(updated.analysis)

        repeated = apply_clarification_answer(state, question, "I want to understand how to request the deposit back.")
        self.assertEqual(updated.evidence[-1].id, repeated.evidence[-1].id)

    def test_unknown_response_is_a_skip_without_answer_or_fact(self) -> None:
        state = self._state(unknowns=["Which country, state, district, or city is relevant?"])
        question = build_clarification_questions(state, journey_unknowns=()).next_question
        assert question is not None

        for response in ("Pata nahi", "I am not sure.", "I don't know.", "I don’t know."):
            with self.subTest(response=response):
                updated = apply_clarification_answer(state, question, response)

                self.assertEqual(updated.facts, state.facts)
                self.assertEqual(updated.evidence, state.evidence)
                self.assertEqual(updated.unknowns, state.unknowns)
                self.assertEqual(updated.jurisdiction.basis, "unknown")
                self.assertEqual(updated.skippedClarificationIds, [question.id])
                self.assertEqual(build_clarification_questions(updated, journey_unknowns=()).questions, ())

    def test_explicit_skip_preserves_unknown_and_creates_no_legal_fact(self) -> None:
        state = self._state(unknowns=["Which country, state, district, or city is relevant?"])
        question = build_clarification_questions(state, journey_unknowns=()).next_question
        assert question is not None

        skipped = skip_clarification_question(
            state,
            question,
            skipped_at="2026-03-01T00:00:00+00:00",
        )

        self.assertEqual(skipped.unknowns, state.unknowns)
        self.assertEqual(skipped.facts, state.facts)
        self.assertEqual(skipped.evidence, state.evidence)
        self.assertEqual(skipped.jurisdiction.model_dump(), state.jurisdiction.model_dump())
        self.assertIn(question.id, skipped.skippedClarificationIds)
        self.assertEqual(build_clarification_questions(skipped, journey_unknowns=()).questions, ())

    def test_skipped_question_can_later_be_answered_as_user_reported(self) -> None:
        state = self._state(unknowns=["Which country, state, district, or city is relevant?"])
        question = build_clarification_questions(state, journey_unknowns=()).next_question
        assert question is not None
        skipped = skip_clarification_question(state, question, journey_unknowns=())

        reopened = build_clarification_questions(
            skipped,
            journey_unknowns=(),
            include_skipped=True,
        ).next_question
        self.assertEqual(reopened, question)
        answered = apply_clarification_answer(skipped, question, "Pune", journey_unknowns=())

        self.assertEqual(answered.unknowns, [])
        self.assertNotIn(question.id, answered.skippedClarificationIds)
        self.assertEqual(answered.facts[-1].value, "Pune")
        self.assertEqual(answered.facts[-1].status, "user_reported")

    def test_legacy_unanswered_clarification_fact_is_normalized_to_unknown(self) -> None:
        state = self._state(unknowns=["Which country, state, district, or city is relevant?"])
        question = build_clarification_questions(state, journey_unknowns=()).next_question
        assert question is not None
        legacy = apply_clarification_answer(state, question, "Mumbai")
        legacy_fact = legacy.facts[-1].model_copy(update={
            "id": "clarification_fact_legacy",
            "value": "Pata nahi",
            "status": "unknown",
            "confidence": "unknown",
        })
        legacy_evidence = legacy.evidence[-1].model_copy(update={
            "id": legacy_fact.sourceIds[0],
            "extractedFacts": [legacy_fact.id],
        })
        # Recreate the old behavior where the unanswered text was saved and the
        # source gap was removed from CaseState. The source note remains intact.
        legacy.facts = [legacy_fact]
        legacy.evidence = [legacy_evidence]
        legacy.unknowns = []
        legacy.jurisdiction = Jurisdiction()
        legacy.conflicts = [
            "User clarification for jurisdiction differs from an earlier response. "
            "Both responses are retained with their sources."
        ]

        normalized, changed = normalize_unanswered_clarification_records(legacy)

        self.assertTrue(changed)
        self.assertEqual(normalized.facts, [])
        self.assertEqual(normalized.evidence, [])
        self.assertEqual(normalized.unknowns, ["Which country, state, district, or city is relevant?"])
        self.assertEqual(normalized.skippedClarificationIds, [question.id])
        self.assertEqual(normalized.conflicts, [])

    def test_new_answer_conflicts_are_retained_with_provenance(self) -> None:
        state = self._state(unknowns=["What the person wants help understanding is not stated."])
        question = build_clarification_questions(state, journey_unknowns=()).next_question
        assert question is not None

        first = apply_clarification_answer(state, question, "Understand the available options")
        revised = apply_clarification_answer(
            first,
            question,
            "Understand the timeline",
            allow_revision=True,
        )

        self.assertEqual(len(revised.facts), 2)
        self.assertEqual(revised.facts[-1].status, "conflicting")
        self.assertTrue(revised.conflicts)
        self.assertEqual(len(revised.evidence), 2)

    def test_answers_reject_foreign_and_stale_questions(self) -> None:
        state = self._state(unknowns=["What the person wants help understanding is not stated."])
        question = build_clarification_questions(state, journey_unknowns=()).next_question
        assert question is not None

        with self.assertRaises(ValueError):
            apply_clarification_answer(self._state(id="another-case"), question, "Understand the case")
        updated = apply_clarification_answer(state, question, "Understand the case")
        with self.assertRaises(ValueError):
            apply_clarification_answer(updated, question, "A different response")

    def test_journey_only_unknown_can_be_answered_with_its_source(self) -> None:
        state = self._state()
        unknown = Unknown("u-objective", "What outcome the person wants is not stated.")
        question = build_clarification_questions(state, [unknown]).next_question
        assert question is not None

        updated = apply_clarification_answer(state, question, "Understand the next steps", journey_unknowns=[unknown])

        self.assertEqual(updated.intent.objective, "Understand the next steps")
        self.assertEqual(updated.evidence[-1].source, "user")


if __name__ == "__main__":
    unittest.main()
