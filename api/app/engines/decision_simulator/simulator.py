"""Deterministic comparison of procedural candidates in a Legal Journey."""

from __future__ import annotations

import hashlib
from collections.abc import Iterable

from app.engines.journey.models import Journey
from app.schemas.case_state import CaseState

from app.engines.decision_simulator.models import (
    BlockingCondition,
    DecisionPath,
    DecisionScenario,
    PathStep,
    RequiredDocument,
    RequiredEvidence,
    Risk,
    Unknown,
)


VERIFICATION_REQUIRED = "Verification required."


def _stable_id(kind: str, case_id: str, value: str) -> str:
    payload = "\x1f".join((kind, case_id, value.casefold())).encode("utf-8")
    return f"{kind}_{hashlib.sha256(payload).hexdigest()[:16]}"


def _unique(values: Iterable[str]) -> tuple[str, ...]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = " ".join(value.split()).strip()
        key = cleaned.casefold()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return tuple(result)


def _conflict_descriptions(case_state: CaseState) -> tuple[str, ...]:
    descriptions = list(case_state.conflicts)
    descriptions.extend(
        f"Fact '{fact.key}' is marked as conflicting."
        for fact in case_state.facts
        if fact.status == "conflicting"
    )
    descriptions.extend(
        f"Evidence '{item.title}' is marked as conflicting."
        for item in case_state.evidence
        if item.status == "conflicting"
    )
    descriptions.extend(
        f"Evidence '{item.title}' conflicts with one or more claims."
        for item in case_state.evidence
        if item.conflictsWithClaimIds
    )
    return _unique(descriptions)


def _make_blockers(case_state: CaseState, conflicts: tuple[str, ...]) -> tuple[BlockingCondition, ...]:
    blockers: list[BlockingCondition] = []
    if not case_state.legalIssues:
        blockers.append(BlockingCondition(
            id=_stable_id("blocker", case_state.id, "issue type not established"),
            description="The issue type is not established from the current CaseState.",
        ))
    jurisdiction = case_state.jurisdiction
    if not any((jurisdiction.country, jurisdiction.state, jurisdiction.district, jurisdiction.city)):
        blockers.append(BlockingCondition(
            id=_stable_id("blocker", case_state.id, "jurisdiction unknown"),
            description="The relevant jurisdiction is unknown.",
        ))
    blockers.append(BlockingCondition(
        id=_stable_id("blocker", case_state.id, "authoritative legal information unverified"),
        description=VERIFICATION_REQUIRED,
    ))
    if conflicts:
        blockers.append(BlockingCondition(
            id=_stable_id("blocker", case_state.id, "conflicting information requires review"),
            description="Conflicting facts or evidence need review before a path can be tailored.",
        ))
    return tuple(blockers)


def _make_unknowns(case_state: CaseState, journey: Journey, conflicts: tuple[str, ...]) -> tuple[Unknown, ...]:
    unknowns = [
        Unknown(
            id=item.id,
            question=item.question,
            priority=item.priority,
            related_to=item.related_to,
        )
        for item in journey.unknowns
    ]
    if conflicts:
        unknowns.append(Unknown(
            id=_stable_id("unknown", case_state.id, "resolve conflicting information"),
            question="Which account is accurate, and what records support each version?",
            priority="high",
            related_to="conflicting_evidence",
        ))
    return tuple(unknowns)


def _make_risks(case_state: CaseState, journey: Journey, conflicts: tuple[str, ...]) -> tuple[Risk, ...]:
    risks = [
        Risk(
            id=item.id,
            description=item.description,
            escalation_trigger=item.escalation_trigger,
            severity=item.severity,
        )
        for item in journey.escalation_points
    ]
    if conflicts:
        risks.append(Risk(
            id=_stable_id("risk", case_state.id, "conflicting information"),
            description="The CaseState contains conflicting facts or evidence; the simulator cannot determine which account is accurate.",
            escalation_trigger="Have a person review the original records and clarify the discrepancy before relying on the affected information.",
        ))
    return tuple(risks)


def _next_action(case_state: CaseState, journey: Journey, conflicts: tuple[str, ...]) -> tuple[str, str]:
    urgent_safety_action = next(
        (
            action
            for action in journey.next_actions
            if action.condition
            and "immediate danger" in action.condition.casefold()
        ),
        None,
    )
    if urgent_safety_action is not None:
        return urgent_safety_action.action, urgent_safety_action.reason
    if conflicts:
        return (
            "Review the conflicting records and note what each source supports.",
            "The CaseState contains conflicting information that the simulator cannot resolve.",
        )
    if not case_state.legalIssues:
        return (
            "Clarify what happened, who was involved, and what help or outcome is being sought.",
            "The current CaseState does not establish an issue type for comparing candidate paths.",
        )
    jurisdiction = case_state.jurisdiction
    if not any((jurisdiction.country, jurisdiction.state, jurisdiction.district, jurisdiction.city)):
        return (
            "Confirm the country, state, district, or city relevant to the events.",
            "Procedural information depends on the relevant jurisdiction.",
        )
    if journey.next_actions:
        return journey.next_actions[0].action, journey.next_actions[0].reason
    return (
        "Organize the available records and verify any procedural information with current authoritative sources.",
        VERIFICATION_REQUIRED,
    )


def _path_steps(
    case_state: CaseState,
    path_key: str,
    evidence_ids: tuple[str, ...],
    document_ids: tuple[str, ...],
) -> tuple[PathStep, ...]:
    requirements = evidence_ids + document_ids
    return (
        PathStep(
            id=_stable_id("path_step", case_state.id, f"{path_key}:organize records"),
            action="Organize the listed records relevant to this candidate path.",
            reason="This is a factual preparation step, not a statement that a document is legally required.",
            status="information_only",
            related_requirement_ids=requirements,
        ),
        PathStep(
            id=_stable_id("path_step", case_state.id, f"{path_key}:verify procedure"),
            action="Verify whether this path and its current requirements are supported by authoritative information for the relevant jurisdiction.",
            reason=VERIFICATION_REQUIRED,
            status="verification_required",
        ),
    )


def simulate_decision(case_state: CaseState, journey: Journey) -> DecisionScenario:
    """Compare journey-supplied candidates without creating or ranking legal routes.

    Candidate labels come only from ``journey.possible_paths``. Until a
    jurisdiction-specific authoritative source is verified, every path remains
    marked ``verification_required``. Facts, records, and known risks remain
    visible even when legal knowledge is empty.
    """

    if journey.case_id != case_state.id:
        raise ValueError("The Legal Journey must belong to the supplied CaseState.")

    required_evidence = tuple(
        RequiredEvidence(item.id, item.item, item.purpose, item.availability)
        for item in journey.required_evidence
    )
    required_documents = tuple(
        RequiredDocument(item.id, item.document, item.purpose, item.availability)
        for item in journey.required_documents
    )
    conflicts = _conflict_descriptions(case_state)
    unknowns = _make_unknowns(case_state, journey, conflicts)
    risks = _make_risks(case_state, journey, conflicts)
    blockers = _make_blockers(case_state, conflicts)
    blocker_ids = tuple(item.id for item in blockers)
    evidence_ids = tuple(item.id for item in required_evidence)
    document_ids = tuple(item.id for item in required_documents)

    candidates = journey.possible_paths
    if not candidates:
        # This describes the absence of a verified option, rather than a legal route.
        path_specs = (("no verified path supplied", "Procedural options"),)
    else:
        path_specs = tuple((item.id, item.label) for item in candidates)

    paths = tuple(
        DecisionPath(
            id=_stable_id("decision_path", case_state.id, f"{source_id}:{index}:{label}"),
            label=label,
            description=VERIFICATION_REQUIRED,
            status="verification_required",
            steps=_path_steps(case_state, f"{source_id}:{index}", evidence_ids, document_ids),
            required_evidence_ids=evidence_ids,
            required_document_ids=document_ids,
            blocking_condition_ids=blocker_ids,
        )
        for index, (source_id, label) in enumerate(path_specs)
    )
    next_action, next_action_reason = _next_action(case_state, journey, conflicts)
    return DecisionScenario(
        case_id=case_state.id,
        current_state=journey.current_situation,
        paths=paths,
        required_evidence=required_evidence,
        required_documents=required_documents,
        unknowns=unknowns,
        risks=risks,
        blocking_conditions=blockers,
        next_action=next_action,
        next_action_reason=next_action_reason,
    )
