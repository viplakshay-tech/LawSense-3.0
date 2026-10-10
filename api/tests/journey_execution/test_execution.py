from __future__ import annotations

import unittest

from app.engines.case_state import extract_case_state
from app.engines.journey_execution import (
    ActionStatus,
    ExecutionStage,
    JourneyExecution,
    NextBestActionStatus,
    ReadinessDimensionName,
    RequestStatus,
    StageCompletionError,
    action_blockers,
    complete_action,
    complete_stage,
    create_execution,
    record_jurisdiction,
    record_information_undetermined,
    record_stage_input,
    set_action_status,
    transition_to,
    update_document_request,
    update_evidence_request,
)
from app.schemas.case_state import CaseDocument, CaseDocumentConfirmation, EvidenceItem


class JourneyExecutionTests(unittest.TestCase):
    def _state(self, text: str, case_id: str):
        return extract_case_state(
            text,
            case_id=case_id,
            created_at="2026-01-01T00:00:00+00:00",
        )

    def test_housing_deposit_keeps_missing_records_and_clarifications_visible(self) -> None:
        case = self._state(
            "My landlord did not return my ₹30,000 security deposit.",
            "execution-housing",
        )
        execution = create_execution(case)

        self.assertEqual(execution.current_stage, ExecutionStage.PROBLEM)
        self.assertEqual(execution.jurisdiction_status, "unknown")
        self.assertTrue(execution.missing_information)
        self.assertTrue(execution.missing_evidence)
        self.assertTrue(execution.missing_documents)
        self.assertTrue(execution.procedural_next_steps)
        self.assertTrue(execution.provenance)

        clarify = transition_to(execution, ExecutionStage.CLARIFY, at="2026-01-02")
        with self.assertRaises(StageCompletionError):
            complete_stage(clarify, ExecutionStage.CLARIFY)

        moved = transition_to(clarify, ExecutionStage.EVIDENCE, at="2026-01-03")
        self.assertEqual(moved.current_stage, ExecutionStage.EVIDENCE)
        self.assertEqual(moved.completed_stages, ())
        self.assertEqual(moved.status_for_stage(ExecutionStage.EVIDENCE), "blocked")
        self.assertTrue(any(item.code == "prerequisite_stage_incomplete" for item in moved.blockers))

        evidence = moved.evidence_requests[0]
        updated = update_evidence_request(
            moved,
            evidence.id,
            RequestStatus.UNAVAILABLE,
            notes="No copy is currently available.",
            at="2026-01-03",
        )
        self.assertEqual(updated.evidence_requests[0].status, RequestStatus.UNAVAILABLE)
        self.assertIn(evidence.id, {item.id for item in updated.missing_evidence})
        self.assertTrue(any(item.related_id == evidence.id for item in updated.uncertainties))

        localized = record_jurisdiction(updated, country="India", state_name="Maharashtra", city="Pune", at="2026-01-04")
        self.assertEqual(localized.jurisdiction_status, "known")
        self.assertEqual(localized.jurisdiction["city"], "Pune")
        self.assertTrue(any(item.event_type == "jurisdiction_recorded" for item in localized.timeline_events))

    def test_consumer_refund_jurisdiction_blocks_procedural_action_and_completion_is_recorded(self) -> None:
        case = self._state(
            "The seller sent a damaged phone and has not refunded me.",
            "execution-consumer",
        )
        execution = create_execution(case)
        self.assertIn("consumer", case.legalIssues[0].category.casefold())

        jurisdiction_action = next(
            item for item in execution.user_actions if item.jurisdiction_required
        )
        blockers = action_blockers(execution, jurisdiction_action.id)
        self.assertTrue(any(item.code == "jurisdiction_unknown" for item in blockers))
        with self.assertRaises(StageCompletionError):
            complete_action(
                execution,
                jurisdiction_action.id,
                "Contacted the seller",
                recorded_at="2026-01-05T10:00:00+00:00",
            )
        self.assertEqual(jurisdiction_action.status, ActionStatus.PROPOSED)
        self.assertFalse(any(item.event_type == "action_completion_recorded" for item in execution.timeline_events))

        action = next(item for item in execution.user_actions if not item.jurisdiction_required)
        completed = complete_action(
            execution,
            action.id,
            "I gathered the order confirmation and messages.",
            recorded_at="2026-01-05T11:00:00+00:00",
        )
        recorded_action = next(item for item in completed.user_actions if item.id == action.id)
        self.assertEqual(recorded_action.status, ActionStatus.COMPLETED)
        self.assertEqual(recorded_action.completion.user_reported_outcome, "I gathered the order confirmation and messages.")
        event = completed.timeline_events[-1]
        self.assertEqual(event.event_type, "action_completion_recorded")
        self.assertEqual(event.actor, "user")
        self.assertTrue(event.provenance_ids)

    def test_employment_state_serializes_deterministically_and_does_not_infer_action_completion(self) -> None:
        case = self._state(
            "My employer has not paid my wages for April 2026.",
            "execution-employment",
        )
        first = create_execution(case)
        second = create_execution(case)

        self.assertEqual(first, second)
        self.assertEqual(first.to_json(), second.to_json())
        self.assertEqual(JourneyExecution.from_json(first.to_json()), first)
        self.assertTrue(any("employment terms" in item.question for item in first.missing_information))
        self.assertTrue(all(item.status == ActionStatus.PROPOSED for item in first.user_actions))
        self.assertFalse(any(item.event_type == "action_completion_recorded" for item in first.timeline_events))

    def test_readiness_is_a_completeness_snapshot_and_jurisdiction_is_selected_first(self) -> None:
        case = self._state(
            "The seller sent a damaged phone and has not refunded me.",
            "readiness-jurisdiction",
        )

        execution = create_execution(case)
        readiness = execution.case_readiness

        self.assertIsNotNone(readiness)
        self.assertEqual(tuple(item.name for item in readiness.dimensions), (
            ReadinessDimensionName.FACTS,
            ReadinessDimensionName.EVIDENCE,
            ReadinessDimensionName.JURISDICTION,
            ReadinessDimensionName.LEGAL_GROUNDING,
            ReadinessDimensionName.DOCUMENTS,
            ReadinessDimensionName.PROCEDURE,
            ReadinessDimensionName.SAFETY,
        ))
        self.assertGreaterEqual(readiness.score, 0)
        self.assertLessEqual(readiness.score, 100)
        self.assertIn("does not predict a case outcome", readiness.explanation)
        self.assertEqual(execution.next_best_action.action, "Confirm jurisdiction")
        self.assertEqual(execution.next_best_action.status, NextBestActionStatus.AVAILABLE)
        self.assertTrue(execution.next_best_action.provenance_ids)

        legal_action = next(item for item in execution.action_plan if item.action == "Review legal grounding")
        self.assertEqual(legal_action.status, NextBestActionStatus.BLOCKED)
        self.assertEqual(legal_action.dependencies, (execution.next_best_action.id,))
        self.assertTrue(legal_action.blocker_ids)
        self.assertTrue(any(item.code == "jurisdiction_unknown" for item in readiness.blockers))
        localized = record_jurisdiction(
            execution,
            country="India",
            state_name="Karnataka",
            city="Mysuru",
            at="2026-01-02T00:00:00+00:00",
        )
        self.assertTrue(localized.next_best_action.action.startswith("Resolve missing document facts:"))
        localized_legal = next(
            item for item in localized.action_plan if item.action == "Review legal grounding"
        )
        self.assertEqual(localized_legal.status, NextBestActionStatus.AVAILABLE)
        self.assertEqual(localized_legal.dependencies, ())

        case.jurisdiction.country = "India"
        case.jurisdiction.state = "Karnataka"
        case.jurisdiction.basis = "inferred"
        inferred_jurisdiction = create_execution(case)
        self.assertEqual(inferred_jurisdiction.jurisdiction_status, "unknown")
        self.assertEqual(inferred_jurisdiction.next_best_action.action, "Confirm jurisdiction")

    def test_pending_agreement_is_reviewed_before_it_counts_as_confirmed_evidence(self) -> None:
        case = self._state(
            "My landlord did not return my security deposit.",
            "readiness-unconfirmed-agreement",
        )
        case.documents.append(CaseDocument(
            id="document-agreement",
            filename="rental-agreement.pdf",
            mimeType="application/pdf",
            extension=".pdf",
            fileSize=1,
            sha256="a" * 64,
            pageCount=1,
            processingTimestamp="2026-01-02T00:00:00+00:00",
            processingStatus="extracted",
            classification="agreement",
            classificationConfidence=0.95,
            reviewStatus="awaiting_confirmation",
        ))
        case.evidence.append(EvidenceItem(
            id="evidence-agreement",
            type="agreement",
            title="rental agreement.pdf",
            source="document",
            status="unknown",
            documentId="document-agreement",
        ))
        execution = create_execution(case)
        execution = record_jurisdiction(
            execution,
            country="India",
            state_name="Maharashtra",
            city="Pune",
            at="2026-01-03T00:00:00+00:00",
        )

        agreement_request = next(
            item for item in execution.evidence_requests if "agreement" in item.item.casefold()
        )
        self.assertEqual(agreement_request.status, RequestStatus.NOT_CONFIRMED)
        self.assertEqual(execution.next_best_action.action, "Review and confirm evidence")
        self.assertEqual(execution.next_best_action.status, NextBestActionStatus.AVAILABLE)
        self.assertIn("document-agreement", execution.next_best_action.source_ids)

        case.documents[0].reviewStatus = "confirmed"
        case.documents[0].confirmationHistory.append(CaseDocumentConfirmation(
            confirmedAt="2026-01-04T00:00:00+00:00",
            findingIds=["finding-agreement"],
        ))
        agreement_evidence = next(item for item in case.evidence if item.id == "evidence-agreement")
        agreement_evidence.status = "evidence_supported"
        confirmed_execution = create_execution(case)
        confirmed_request = next(
            item for item in confirmed_execution.evidence_requests if "agreement" in item.item.casefold()
        )
        self.assertEqual(confirmed_request.status, RequestStatus.AVAILABLE)
        confirmed_review_action = next(
            item for item in confirmed_execution.action_plan
            if agreement_request.id in item.source_ids
        )
        self.assertEqual(confirmed_review_action.status, NextBestActionStatus.COMPLETED)

    def test_action_states_retain_provenance_and_journey_timeline(self) -> None:
        case = self._state(
            "I live in Pune. The seller sent a damaged phone and has not refunded me.",
            "readiness-action-history",
        )
        execution = create_execution(case)
        action = next(item for item in execution.user_actions if not item.jurisdiction_required)

        in_progress = set_action_status(
            execution,
            action.id,
            ActionStatus.IN_PROGRESS,
            at="2026-01-05T09:00:00+00:00",
        )
        waiting = set_action_status(
            in_progress,
            action.id,
            ActionStatus.WAITING,
            reason="Waiting for a response from the seller.",
            at="2026-01-05T10:00:00+00:00",
        )
        projected = next(item for item in waiting.action_plan if action.id in item.source_ids)
        self.assertEqual(projected.status, NextBestActionStatus.WAITING)
        self.assertTrue(projected.provenance_ids)
        self.assertEqual([item.event_type for item in projected.history], [
            "action_status_recorded",
            "action_status_recorded",
        ])

        completed = complete_action(
            waiting,
            action.id,
            "The seller replied.",
            recorded_at="2026-01-06T10:00:00+00:00",
        )
        completed_projection = next(item for item in completed.action_plan if action.id in item.source_ids)
        self.assertEqual(completed_projection.status, NextBestActionStatus.COMPLETED)
        self.assertEqual(len(completed_projection.history), 3)
        self.assertEqual(JourneyExecution.from_json(completed.to_json()), completed)

    def test_safety_sensitive_case_preserves_immediate_danger_question_until_recorded(self) -> None:
        case = self._state(
            "Someone has repeatedly threatened me in messages.",
            "execution-safety",
        )
        execution = create_execution(case)
        danger = next(
            item for item in execution.missing_information if "immediate danger" in item.question.casefold()
        )
        self.assertEqual(danger.status.value, "open")
        self.assertTrue(any(item.related_id == danger.id for item in execution.uncertainties))

        safety_action = next(item for item in execution.user_actions if "immediate danger" in item.action.casefold())
        self.assertIn("immediate danger", execution.next_best_action.action.casefold())
        self.assertEqual(execution.next_best_action.status, NextBestActionStatus.AVAILABLE)
        completed = complete_action(
            execution,
            safety_action.id,
            "I checked; no one is in immediate danger right now.",
            recorded_at="2026-01-06T09:30:00+00:00",
        )
        self.assertEqual(
            next(item for item in completed.user_actions if item.id == safety_action.id).status,
            ActionStatus.COMPLETED,
        )
        self.assertEqual(
            next(item for item in completed.missing_information if item.id == danger.id).status.value,
            "open",
        )
        self.assertTrue(any(item.event_type == "action_completion_recorded" for item in completed.timeline_events))

    def test_required_stage_inputs_and_explicit_transitions_control_completion(self) -> None:
        case = self._state("I paid a seller but did not receive the item.", "execution-required-inputs")
        execution = create_execution(case)
        with self.assertRaises(ValueError):
            complete_stage(execution, ExecutionStage.CLARIFY)

        completed_problem = complete_stage(execution, ExecutionStage.PROBLEM, at="2026-01-07")
        self.assertEqual(completed_problem.completed_stages, (ExecutionStage.PROBLEM,))
        self.assertEqual(completed_problem.current_stage, ExecutionStage.PROBLEM)
        with self.assertRaises(ValueError):
            record_stage_input(completed_problem, ExecutionStage.PROBLEM, "not_declared", "value")

        moved = transition_to(completed_problem, ExecutionStage.CLARIFY)
        with self.assertRaises(StageCompletionError) as raised:
            complete_stage(moved, ExecutionStage.CLARIFY)
        self.assertTrue(any(item.code == "missing_information_open" for item in raised.exception.blockers))

    def test_all_stages_can_complete_only_after_their_inputs_are_recorded(self) -> None:
        case = self._state(
            "My landlord did not return my deposit. I want help getting it back.",
            "execution-full-lifecycle",
        )
        execution = create_execution(case)
        execution = record_jurisdiction(execution, country="India", state_name="Karnataka", city="Mysuru")

        execution = complete_stage(execution, ExecutionStage.PROBLEM)
        execution = transition_to(execution, ExecutionStage.CLARIFY)
        for item in execution.missing_information:
            if item.status.value == "open":
                execution = record_information_undetermined(execution, item.id, "Not available in the current record.")
        execution = record_stage_input(execution, ExecutionStage.CLARIFY, "desired_outcome", "Understand how to seek the deposit return.")
        execution = record_stage_input(execution, ExecutionStage.CLARIFY, "clarifications_reviewed", "Open questions were reviewed.")
        execution = complete_stage(execution, ExecutionStage.CLARIFY)

        execution = transition_to(execution, ExecutionStage.FACTS)
        execution = record_stage_input(execution, ExecutionStage.FACTS, "timeline_reviewed", "The known events and missing dates were reviewed.")
        execution = complete_stage(execution, ExecutionStage.FACTS)

        execution = transition_to(execution, ExecutionStage.EVIDENCE)
        for request in execution.evidence_requests:
            if request.status == RequestStatus.NOT_CONFIRMED:
                execution = update_evidence_request(
                    execution, request.id, RequestStatus.UNAVAILABLE, notes="Not available now."
                )
        execution = complete_stage(execution, ExecutionStage.EVIDENCE)

        execution = transition_to(execution, ExecutionStage.LAW)
        execution = record_stage_input(
            execution,
            ExecutionStage.LAW,
            "legal_verification",
            {"status": "verified", "source_title": "Official legislation", "source_url": "https://example.gov/law"},
        )
        execution = complete_stage(execution, ExecutionStage.LAW)

        execution = transition_to(execution, ExecutionStage.POSSIBLE_PATHS)
        execution = record_stage_input(execution, ExecutionStage.POSSIBLE_PATHS, "paths_reviewed", "No path is represented as verified by this execution record.")
        execution = complete_stage(execution, ExecutionStage.POSSIBLE_PATHS)

        execution = transition_to(execution, ExecutionStage.DOCUMENT)
        for request in execution.document_requests:
            if request.status == RequestStatus.NOT_CONFIRMED:
                execution = update_document_request(
                    execution, request.id, RequestStatus.UNAVAILABLE, notes="Not available now."
                )
        execution = complete_stage(execution, ExecutionStage.DOCUMENT)

        execution = transition_to(execution, ExecutionStage.OFFICIAL_RESOURCE)
        execution = record_stage_input(
            execution,
            ExecutionStage.OFFICIAL_RESOURCE,
            "official_resource",
            {"is_official": True, "title": "Official information portal", "url": "https://example.gov/resource"},
        )
        execution = complete_stage(execution, ExecutionStage.OFFICIAL_RESOURCE)

        execution = transition_to(execution, ExecutionStage.ACTION)
        execution = record_stage_input(execution, ExecutionStage.ACTION, "action_plan_reviewed", "The user reviewed the listed actions.")
        execution = complete_stage(execution, ExecutionStage.ACTION)

        execution = transition_to(execution, ExecutionStage.FOLLOW_UP)
        execution = record_stage_input(execution, ExecutionStage.FOLLOW_UP, "follow_up_plan", "Review the matter after any response arrives.")
        execution = complete_stage(execution, ExecutionStage.FOLLOW_UP)

        self.assertEqual(execution.completed_stages, tuple(ExecutionStage))
        self.assertEqual(execution.current_stage, ExecutionStage.FOLLOW_UP)
        legal_readiness = next(
            item for item in execution.case_readiness.dimensions
            if item.name == ReadinessDimensionName.LEGAL_GROUNDING
        )
        self.assertEqual(legal_readiness.score, 100)
        legal_action = next(item for item in execution.action_plan if item.action == "Review legal grounding")
        self.assertEqual(legal_action.status, NextBestActionStatus.COMPLETED)
        self.assertEqual(JourneyExecution.from_json(execution.to_json()), execution)


if __name__ == "__main__":
    unittest.main()
