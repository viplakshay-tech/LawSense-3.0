"""Deterministic case-readiness and next-action projections for Journey execution."""

from __future__ import annotations

import hashlib

from app.engines.journey_execution.models import (
    ActionHistoryEntry,
    ActionStatus,
    CaseReadiness,
    ExecutionStage,
    JourneyExecution,
    MissingInformationStatus,
    NextBestAction,
    NextBestActionStatus,
    ReadinessBlocker,
    ReadinessDimension,
    ReadinessDimensionName,
    ReadinessLevel,
    RequestStatus,
    TimelineEvent,
)


_PROCEDURAL_STAGES = (
    ExecutionStage.LAW,
    ExecutionStage.POSSIBLE_PATHS,
    ExecutionStage.OFFICIAL_RESOURCE,
    ExecutionStage.ACTION,
    ExecutionStage.FOLLOW_UP,
)


def _stable_id(kind: str, *parts: str) -> str:
    payload = "\x1f".join(parts)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]
    return f"{kind}_{digest}"


def _dimension_level(score: int) -> ReadinessLevel:
    if score >= 90:
        return ReadinessLevel.READY
    if score >= 40:
        return ReadinessLevel.PARTIAL
    return ReadinessLevel.BLOCKED


def _question_is_jurisdiction(question: str) -> bool:
    text = question.casefold()
    return any(token in text for token in ("jurisdiction", "location", "which country", "where did", "where the events"))


def _question_is_safety(question: str, related_to: str | None = None) -> bool:
    text = question.casefold()
    return related_to == "safety" or any(token in text for token in ("immediate danger", "reported threats", "threats occurred"))


def _level_from_status(score: int, *, unknown: bool = False) -> ReadinessLevel:
    return ReadinessLevel.UNKNOWN if unknown else _dimension_level(score)


def derive_case_readiness(state: JourneyExecution) -> CaseReadiness:
    """Score record completeness evenly across the seven requested dimensions."""

    blockers: list[ReadinessBlocker] = []

    def add(
        dimension: ReadinessDimensionName,
        code: str,
        message: str,
        *,
        related_ids: tuple[str, ...] = (),
        source_ids: tuple[str, ...] = (),
        provenance_ids: tuple[str, ...] = (),
        severity: str = "attention",
    ) -> None:
        blocker_id = _stable_id("readiness_blocker", state.case_id, code, *related_ids)
        if blocker_id not in {item.id for item in blockers}:
            blockers.append(ReadinessBlocker(
                id=blocker_id,
                code=code,
                dimension=dimension,
                message=message,
                severity=severity,
                related_ids=related_ids,
                source_ids=source_ids,
                provenance_ids=provenance_ids,
            ))

    open_facts = tuple(
        item for item in state.missing_information
        if item.status in {MissingInformationStatus.OPEN, MissingInformationStatus.CANNOT_DETERMINE}
        and not _question_is_safety(item.question, item.related_to)
        and not _question_is_jurisdiction(item.question)
    )
    fact_gap_count = len(open_facts) + len(state.conflicts) + len(state.assumptions)
    fact_total = state.recorded_fact_count + fact_gap_count
    for item in open_facts:
        add(
            ReadinessDimensionName.FACTS,
            "case_fact_unresolved" if item.status == MissingInformationStatus.OPEN else "case_fact_undetermined",
            item.question,
            related_ids=(item.id,),
            source_ids=item.source_ids,
            provenance_ids=item.provenance_ids,
        )
    for index, conflict in enumerate(state.conflicts):
        add(
            ReadinessDimensionName.FACTS,
            "case_fact_conflict",
            conflict,
            related_ids=(f"conflict:{index}",),
        )
    for index, assumption in enumerate(state.assumptions):
        add(
            ReadinessDimensionName.FACTS,
            "case_fact_assumption",
            f"A recorded assumption still needs review: {assumption}",
            related_ids=(f"assumption:{index}",),
        )
    facts_score = _ratio_score(state.recorded_fact_count, fact_total)

    evidence_gaps = tuple(
        item for item in state.evidence_requests
        if item.status in {RequestStatus.NOT_CONFIRMED, RequestStatus.UNAVAILABLE}
    )
    evidence_completed = sum(
        item.status in {RequestStatus.AVAILABLE, RequestStatus.NOT_APPLICABLE}
        for item in state.evidence_requests
    )
    evidence_total = len(state.evidence_requests) + len(state.pending_evidence_reviews)
    for item in evidence_gaps:
        add(
            ReadinessDimensionName.EVIDENCE,
            "evidence_unconfirmed" if item.status == RequestStatus.NOT_CONFIRMED else "evidence_unavailable",
            f"Evidence has not been confirmed: {item.item}.",
            related_ids=(item.id,),
            source_ids=item.source_ids,
            provenance_ids=item.provenance_ids,
        )
    for item in state.pending_evidence_reviews:
        add(
            ReadinessDimensionName.EVIDENCE,
            "evidence_review_pending",
            f"Review and confirm the uploaded evidence: {item.filename}.",
            related_ids=tuple(value for value in (item.document_id, item.evidence_id) if value),
            source_ids=item.source_ids,
            provenance_ids=item.provenance_ids,
        )
    evidence_score = _ratio_score(evidence_completed, evidence_total)

    jurisdiction_known = state.jurisdiction_status == "known"
    if not jurisdiction_known:
        add(
            ReadinessDimensionName.JURISDICTION,
            "jurisdiction_unknown",
            "The place relevant to the events has not been recorded.",
            related_ids=("jurisdiction",),
            source_ids=tuple(state.jurisdiction.get("source_ids", ())),
            provenance_ids=_provenance_ids_for(state, "jurisdiction"),
            severity="blocking",
        )
    jurisdiction_score = 100 if jurisdiction_known else 0

    verification = _stage_input_value(state, ExecutionStage.LAW, "legal_verification")
    legal_verified = isinstance(verification, dict) and verification.get("status") == "verified"
    jurisdiction_specific = not isinstance(verification, dict) or verification.get("jurisdiction_specific", True)
    legal_verified = legal_verified and (jurisdiction_known or not jurisdiction_specific)
    if not legal_verified:
        add(
            ReadinessDimensionName.LEGAL_GROUNDING,
            "legal_grounding_unverified",
            "Jurisdiction-specific legal information has not been recorded as verified against an authoritative source.",
            related_ids=("legal_verification",),
            source_ids=tuple(verification.get("source_ids", ())) if isinstance(verification, dict) else (),
            provenance_ids=_provenance_ids_for(state, "legal_verification"),
            severity="blocking" if jurisdiction_specific and not jurisdiction_known else "attention",
        )
    legal_score = 100 if legal_verified else (50 if state.legal_records_available else 0)
    if legal_score == 50 and not jurisdiction_known:
        legal_score = 25

    document_gaps = tuple(
        item for item in state.document_requests
        if item.status in {RequestStatus.NOT_CONFIRMED, RequestStatus.UNAVAILABLE}
    )
    document_completed = sum(
        item.status in {RequestStatus.AVAILABLE, RequestStatus.NOT_APPLICABLE}
        for item in state.document_requests
    )
    document_total = len(state.document_requests) + len(state.pending_evidence_reviews)
    for item in document_gaps:
        add(
            ReadinessDimensionName.DOCUMENTS,
            "document_facts_unresolved" if item.status == RequestStatus.NOT_CONFIRMED else "document_unavailable",
            f"Resolve the missing document facts or record whether this document is available: {item.document}.",
            related_ids=(item.id,),
            source_ids=item.source_ids,
            provenance_ids=item.provenance_ids,
        )
    for item in state.pending_evidence_reviews:
        add(
            ReadinessDimensionName.DOCUMENTS,
            "document_review_pending",
            f"The uploaded document still needs review: {item.filename}.",
            related_ids=tuple(value for value in (item.document_id, item.evidence_id) if value),
            source_ids=item.source_ids,
            provenance_ids=item.provenance_ids,
        )
    document_score = _ratio_score(document_completed, document_total)

    incomplete_procedure = tuple(
        stage for stage in _PROCEDURAL_STAGES
        if not _progress_for(state, stage).completed
    )
    procedure_score = _ratio_score(len(_PROCEDURAL_STAGES) - len(incomplete_procedure), len(_PROCEDURAL_STAGES))
    for stage in incomplete_procedure:
        add(
            ReadinessDimensionName.PROCEDURE,
            "journey_stage_incomplete",
            f"The {stage.value} Journey stage has not been recorded complete.",
            related_ids=(stage.value,),
        )

    safety_unknown = state.safety_context == "unknown"
    if state.safety_context == "urgent_safety_context" or state.safety_urgency == "urgent":
        safety_score = 0
        add(
            ReadinessDimensionName.SAFETY,
            "urgent_safety_review",
            "The recorded safety assessment indicates urgent context; review immediate safety needs before other steps.",
            related_ids=state.safety_source_ids or ("safety",),
            source_ids=state.safety_source_ids,
            severity="blocking",
        )
    elif state.safety_context == "potentially_unsafe":
        safety_score = 25
        add(
            ReadinessDimensionName.SAFETY,
            "safety_review_required",
            "A safety-related concern is recorded and current safety needs remain to be reviewed.",
            related_ids=state.safety_source_ids or ("safety",),
            source_ids=state.safety_source_ids,
            severity="blocking",
        )
    elif state.safety_context == "sensitive":
        safety_score = 50
        add(
            ReadinessDimensionName.SAFETY,
            "safety_context_sensitive",
            "Review the recorded sensitive context and choose safe ways to continue.",
            related_ids=state.safety_source_ids or ("safety",),
            source_ids=state.safety_source_ids,
        )
    elif safety_unknown:
        safety_score = 60
        add(
            ReadinessDimensionName.SAFETY,
            "safety_assessment_unavailable",
            "No safety assessment was supplied to Journey execution, so this dimension remains unknown.",
            related_ids=("safety",),
        )
    else:
        safety_score = 100

    source_by_dimension = {
        ReadinessDimensionName.FACTS: tuple(dict.fromkeys(
            source for item in open_facts for source in item.source_ids
        )),
        ReadinessDimensionName.EVIDENCE: tuple(dict.fromkeys(
            source for item in (*evidence_gaps, *state.pending_evidence_reviews)
            for source in item.source_ids
        )),
        ReadinessDimensionName.JURISDICTION: _provenance_sources_for(state, "jurisdiction"),
        ReadinessDimensionName.LEGAL_GROUNDING: _provenance_sources_for(state, "legal_verification"),
        ReadinessDimensionName.DOCUMENTS: tuple(dict.fromkeys(
            source for item in (*document_gaps, *state.pending_evidence_reviews)
            for source in item.source_ids
        )),
        ReadinessDimensionName.PROCEDURE: (f"journey:{state.id}",),
        ReadinessDimensionName.SAFETY: state.safety_source_ids,
    }
    scores = {
        ReadinessDimensionName.FACTS: facts_score,
        ReadinessDimensionName.EVIDENCE: evidence_score,
        ReadinessDimensionName.JURISDICTION: jurisdiction_score,
        ReadinessDimensionName.LEGAL_GROUNDING: legal_score,
        ReadinessDimensionName.DOCUMENTS: document_score,
        ReadinessDimensionName.PROCEDURE: procedure_score,
        ReadinessDimensionName.SAFETY: safety_score,
    }
    names = (
        ReadinessDimensionName.FACTS,
        ReadinessDimensionName.EVIDENCE,
        ReadinessDimensionName.JURISDICTION,
        ReadinessDimensionName.LEGAL_GROUNDING,
        ReadinessDimensionName.DOCUMENTS,
        ReadinessDimensionName.PROCEDURE,
        ReadinessDimensionName.SAFETY,
    )
    dimensions = tuple(
        ReadinessDimension(
            name=name,
            score=scores[name],
            level=_level_from_status(scores[name], unknown=(name == ReadinessDimensionName.SAFETY and safety_unknown)),
            explanation=_dimension_explanation(name, state, scores[name]),
            blocker_ids=tuple(item.id for item in blockers if item.dimension == name),
            source_ids=source_by_dimension[name],
        )
        for name in names
    )
    total_score = round(sum(scores.values()) / len(scores))
    active_blockers = [item for item in blockers if item.severity == "blocking"]
    explanation = (
        f"Record completeness is {total_score}/100, the unweighted mean of seven readiness dimensions. "
        f"{len(blockers)} open item(s) are recorded, including {len(active_blockers)} blocking item(s). "
        "This is a completeness checklist and does not predict a case outcome."
    )
    return CaseReadiness(
        score=total_score,
        explanation=explanation,
        dimensions=dimensions,
        blockers=tuple(blockers),
    )


def derive_action_plan(state: JourneyExecution, readiness: CaseReadiness) -> tuple[NextBestAction, ...]:
    """Project actionable Journey gaps into one deterministically ordered action list.

    Priority tiers are fixed: urgent safety (0), jurisdiction (10), pending
    evidence review (20), missing document facts (25), open facts (30),
    evidence to locate (35), legal grounding (50), and other Journey actions
    (80+ in original Journey order).
    """

    actions: list[NextBestAction] = []
    jurisdiction_known = state.jurisdiction_status == "known"
    blocker_by_code: dict[str, list[str]] = {}
    for blocker in readiness.blockers:
        blocker_by_code.setdefault(blocker.code, []).append(blocker.id)

    jurisdiction_action_id = _stable_id("next_action", state.case_id, "confirm_jurisdiction", "jurisdiction")
    legal_action_id = _stable_id("next_action", state.case_id, "verify_legal_grounding", "legal_verification")

    def add_action(
        *,
        kind: str,
        source_id: str,
        action: str,
        reason: str,
        dimension: ReadinessDimensionName,
        stage: ExecutionStage,
        priority: int,
        source_type: str,
        status: NextBestActionStatus,
        dependencies: tuple[str, ...] = (),
        blockers: tuple[str, ...] = (),
        source_ids: tuple[str, ...] = (),
        provenance_ids: tuple[str, ...] = (),
    ) -> None:
        action_id = _stable_id("next_action", state.case_id, kind, source_id)
        history = _history_for(state, (action_id, source_id, *source_ids))
        known_provenance = _provenance_ids_for_many(state, source_id, *source_ids)
        journey_roots = tuple(
            record.id for record in state.provenance if record.source_type == "journey"
        )
        case_roots = tuple(
            record.id for record in state.provenance if record.source_type == "case_state"
        )
        lineage = journey_roots if source_type.startswith("journey") else case_roots
        all_provenance = tuple(dict.fromkeys((*provenance_ids, *known_provenance, *lineage)))
        actions.append(NextBestAction(
            id=action_id,
            action=action,
            reason=reason,
            status=status,
            dimension=dimension,
            stage=stage,
            priority=priority,
            source_type=source_type,
            source_ids=tuple(dict.fromkeys((source_id, *source_ids))),
            dependencies=dependencies,
            blocker_ids=blockers,
            provenance_ids=all_provenance,
            history=history,
        ))

    jurisdiction_status = (
        NextBestActionStatus.COMPLETED if state.jurisdiction_status == "known"
        else NextBestActionStatus.AVAILABLE
    )
    add_action(
        kind="confirm_jurisdiction",
        source_id="jurisdiction",
        action="Confirm jurisdiction",
        reason="Record the country, state, district, or city where the relevant events took place.",
        dimension=ReadinessDimensionName.JURISDICTION,
        stage=ExecutionStage.CLARIFY,
        priority=10,
        source_type="journey_execution",
        status=jurisdiction_status,
        blockers=tuple(blocker_by_code.get("jurisdiction_unknown", ())) if jurisdiction_status == NextBestActionStatus.BLOCKED else (),
        provenance_ids=_provenance_ids_for(state, "jurisdiction"),
    )

    for request in state.evidence_requests:
        matching_reviews = tuple(
            review for review in state.pending_evidence_reviews
            if _matches_review(request.item, review.filename)
        )
        request_status = _request_action_status(request.status)
        if request_status == NextBestActionStatus.COMPLETED:
            priority = 20
            label = f"Evidence reviewed: {request.item}"
        elif matching_reviews:
            priority = 20
            label = "Review and confirm evidence"
        else:
            priority = 35
            label = f"Locate or record evidence: {request.item}"
        related_review_ids = tuple(
            value for review in matching_reviews
            for value in (review.document_id, review.evidence_id) if value
        )
        request_blockers = tuple(
            blocker.id for blocker in readiness.blockers
            if blocker.dimension == ReadinessDimensionName.EVIDENCE
            and (request.id in blocker.related_ids or set(related_review_ids).intersection(blocker.related_ids))
        )
        add_action(
            kind="review_evidence",
            source_id=request.id,
            action=label,
            reason=(
                f"Review the uploaded {request.item} and confirm whether its relevant contents match the case record."
                if matching_reviews else
                f"The Journey identifies {request.item} as a record to locate or explicitly mark unavailable."
            ),
            dimension=ReadinessDimensionName.EVIDENCE,
            stage=ExecutionStage.EVIDENCE,
            priority=priority,
            source_type="journey_evidence_request",
            status=request_status,
            source_ids=related_review_ids,
            provenance_ids=request.provenance_ids,
            blockers=request_blockers,
        )

    for review in state.pending_evidence_reviews:
        if any(_matches_review(request.item, review.filename) for request in state.evidence_requests):
            continue
        related = tuple(value for value in (review.evidence_id, review.document_id) if value)
        add_action(
            kind="review_uploaded_evidence",
            source_id=review.document_id,
            action="Review and confirm evidence",
            reason=f"Review the uploaded document {review.filename} before its extracted details are used.",
            dimension=ReadinessDimensionName.EVIDENCE,
            stage=ExecutionStage.EVIDENCE,
            priority=20,
            source_type="case_document_review",
            status=NextBestActionStatus.AVAILABLE,
            source_ids=related,
            provenance_ids=review.provenance_ids,
            blockers=tuple(blocker_by_code.get("evidence_review_pending", ())),
        )

    for request in state.document_requests:
        matching_reviews = tuple(
            review for review in state.pending_evidence_reviews
            if _matches_review(request.document, review.filename)
        )
        request_status = _request_action_status(request.status)
        if matching_reviews and request_status != NextBestActionStatus.COMPLETED:
            # The current gap is review of the existing upload; avoid a second
            # action that asks the user to find that same document.
            continue
        add_action(
            kind="resolve_document_facts",
            source_id=request.id,
            action=(
                f"Resolve missing document facts: {request.document}"
                if request_status != NextBestActionStatus.COMPLETED else
                f"Document requirement addressed: {request.document}"
            ),
            reason=f"{request.purpose} Record whether this document is available and what relevant details it contains.",
            dimension=ReadinessDimensionName.DOCUMENTS,
            stage=ExecutionStage.DOCUMENT,
            priority=25,
            source_type="journey_document_request",
            status=request_status,
            source_ids=tuple(
                value for review in matching_reviews
                for value in (review.document_id, review.evidence_id) if value
            ),
            provenance_ids=request.provenance_ids,
            blockers=tuple(
                blocker.id for blocker in readiness.blockers
                if blocker.dimension == ReadinessDimensionName.DOCUMENTS
                and (request.id in blocker.related_ids or any(
                    source_id in blocker.related_ids
                    for review in matching_reviews
                    for source_id in (review.document_id, review.evidence_id)
                    if source_id
                ))
            ),
        )

    has_journey_safety_action = any(
        "immediate danger" in item.action.casefold() or "safety" in item.action.casefold()
        for item in state.user_actions
    )
    for item in state.missing_information:
        if _question_is_jurisdiction(item.question):
            continue
        is_safety = _question_is_safety(item.question, item.related_to)
        if is_safety and has_journey_safety_action:
            continue
        item_status = {
            MissingInformationStatus.ANSWERED: NextBestActionStatus.COMPLETED,
            MissingInformationStatus.CANNOT_DETERMINE: NextBestActionStatus.WAITING,
            MissingInformationStatus.OPEN: NextBestActionStatus.AVAILABLE,
        }[item.status]
        source_id = item.id
        add_action(
            kind="check_safety" if is_safety else "resolve_case_fact",
            source_id=source_id,
            action=(
                "Check whether anyone is in immediate danger now"
                if is_safety else f"Resolve key case fact: {item.question}"
            ),
            reason=(
                "The Journey records that current safety status is unknown."
                if is_safety else "This clarification remains open in the existing Journey."
            ),
            dimension=ReadinessDimensionName.SAFETY if is_safety else ReadinessDimensionName.FACTS,
            stage=ExecutionStage.CLARIFY,
            priority=0 if is_safety else 30,
            source_type="journey_missing_information",
            status=item_status,
            source_ids=item.source_ids,
            provenance_ids=item.provenance_ids,
            blockers=tuple(
                blocker.id for blocker in readiness.blockers
                if source_id in blocker.related_ids
            ),
        )

    verification = _stage_input_value(state, ExecutionStage.LAW, "legal_verification")
    legal_requires_jurisdiction = not isinstance(verification, dict) or verification.get("jurisdiction_specific", True)
    legal_verified = isinstance(verification, dict) and verification.get("status") == "verified"
    legal_verified = legal_verified and (jurisdiction_known or not legal_requires_jurisdiction)
    legal_dependency: tuple[str, ...] = (
        (jurisdiction_action_id,) if legal_requires_jurisdiction and not jurisdiction_known else ()
    )
    legal_blockers = () if legal_verified or not legal_requires_jurisdiction or jurisdiction_known else tuple(
        blocker_by_code.get("jurisdiction_unknown", ())
    )
    add_action(
        kind="verify_legal_grounding",
        source_id="legal_verification",
        action="Review legal grounding",
        reason="Record whether the cited jurisdiction-specific legal information was checked against current authoritative sources.",
        dimension=ReadinessDimensionName.LEGAL_GROUNDING,
        stage=ExecutionStage.LAW,
        priority=50,
        source_type="journey_stage",
        status=(
            NextBestActionStatus.COMPLETED if legal_verified else
            NextBestActionStatus.BLOCKED if legal_blockers else
            NextBestActionStatus.AVAILABLE
        ),
        dependencies=legal_dependency,
        blockers=legal_blockers or (() if legal_verified else tuple(blocker_by_code.get("legal_grounding_unverified", ()))),
        provenance_ids=_provenance_ids_for(state, "legal_verification"),
    )

    for action in state.user_actions:
        normalized = action.action.casefold()
        is_safety_action = "immediate danger" in normalized or "safety" in normalized
        if action.status == ActionStatus.CANCELLED:
            continue
        if action.status == ActionStatus.COMPLETED:
            action_status = NextBestActionStatus.COMPLETED
        elif action.status == ActionStatus.IN_PROGRESS:
            action_status = NextBestActionStatus.IN_PROGRESS
        elif action.status == ActionStatus.WAITING:
            action_status = NextBestActionStatus.WAITING
        elif is_safety_action:
            action_status = NextBestActionStatus.AVAILABLE
        elif action.jurisdiction_required and not jurisdiction_known:
            action_status = NextBestActionStatus.BLOCKED
        elif action.stage in {ExecutionStage.POSSIBLE_PATHS, ExecutionStage.ACTION} and not legal_verified:
            action_status = NextBestActionStatus.BLOCKED
        else:
            action_status = NextBestActionStatus.AVAILABLE
        action_dependencies: tuple[str, ...] = ()
        blocker_ids: tuple[str, ...] = ()
        if action.jurisdiction_required and not jurisdiction_known:
            action_dependencies = (jurisdiction_action_id,)
            blocker_ids += tuple(blocker_by_code.get("jurisdiction_unknown", ()))
        if not is_safety_action and action.stage in {ExecutionStage.POSSIBLE_PATHS, ExecutionStage.ACTION} and not legal_verified:
            action_dependencies += (legal_action_id,)
            blocker_ids += tuple(blocker_by_code.get("legal_grounding_unverified", ()))
        rank = 80 + list(state.user_actions).index(action)
        if is_safety_action:
            rank = 0
            safety_ids = tuple(
                item.id for item in state.missing_information
                if _question_is_safety(item.question, item.related_to)
            )
            action_source_ids = (action.id, *safety_ids)
            if safety_ids and all(
                item.status == MissingInformationStatus.ANSWERED
                for item in state.missing_information if item.id in safety_ids
            ):
                action_status = NextBestActionStatus.COMPLETED
            elif any(
                item.status == MissingInformationStatus.CANNOT_DETERMINE
                for item in state.missing_information if item.id in safety_ids
            ):
                action_status = NextBestActionStatus.WAITING
        else:
            action_source_ids = (action.id,)
        add_action(
            kind="journey_action",
            source_id=action.id,
            action=action.action,
            reason=action.reason + (f" {action.condition}" if action.condition else ""),
            dimension=_dimension_for_stage(action.stage),
            stage=action.stage,
            priority=rank,
            source_type="journey_action",
            status=action_status,
            dependencies=action_dependencies,
            blockers=tuple(dict.fromkeys(blocker_ids)),
            source_ids=action_source_ids[1:],
            provenance_ids=tuple(
                record.id for record in state.provenance if record.target_id == action.id
            ),
        )

    return tuple(sorted(actions, key=_action_sort_key))


def select_next_best_action(actions: tuple[NextBestAction, ...]) -> NextBestAction | None:
    if not actions:
        return None
    return min(actions, key=_action_sort_key)


def _action_sort_key(action: NextBestAction) -> tuple[int, int, int, str]:
    status_order = {
        NextBestActionStatus.AVAILABLE: 0,
        NextBestActionStatus.IN_PROGRESS: 1,
        NextBestActionStatus.WAITING: 2,
        NextBestActionStatus.BLOCKED: 3,
        NextBestActionStatus.COMPLETED: 4,
    }
    return status_order[action.status], action.priority, list(ExecutionStage).index(action.stage), action.id


def _dimension_for_stage(stage: ExecutionStage) -> ReadinessDimensionName:
    if stage in {ExecutionStage.PROBLEM, ExecutionStage.CLARIFY, ExecutionStage.FACTS}:
        return ReadinessDimensionName.FACTS
    if stage == ExecutionStage.EVIDENCE:
        return ReadinessDimensionName.EVIDENCE
    if stage == ExecutionStage.DOCUMENT:
        return ReadinessDimensionName.DOCUMENTS
    if stage == ExecutionStage.LAW:
        return ReadinessDimensionName.LEGAL_GROUNDING
    if stage == ExecutionStage.POSSIBLE_PATHS:
        return ReadinessDimensionName.JURISDICTION
    if stage == ExecutionStage.OFFICIAL_RESOURCE:
        return ReadinessDimensionName.LEGAL_GROUNDING
    if stage in {ExecutionStage.ACTION, ExecutionStage.FOLLOW_UP}:
        return ReadinessDimensionName.PROCEDURE
    return ReadinessDimensionName.FACTS


def _dimension_explanation(name: ReadinessDimensionName, state: JourneyExecution, score: int) -> str:
    labels = {
        ReadinessDimensionName.FACTS: "recorded facts and open clarifications",
        ReadinessDimensionName.EVIDENCE: "evidence requests and confirmation status",
        ReadinessDimensionName.JURISDICTION: "recorded place relevant to the events",
        ReadinessDimensionName.LEGAL_GROUNDING: "explicit verification of cited legal sources",
        ReadinessDimensionName.DOCUMENTS: "Journey document requests and review status",
        ReadinessDimensionName.PROCEDURE: "explicitly completed Journey procedure stages",
        ReadinessDimensionName.SAFETY: "safety context supplied to Journey execution",
    }
    if name == ReadinessDimensionName.SAFETY and state.safety_context == "unknown":
        return "Safety context was not supplied to this execution snapshot; no safety conclusion is inferred."
    return f"Score is based on {labels[name]} in the current recorded snapshot."


def _ratio_score(complete: int, total: int) -> int:
    if total <= 0:
        return 100
    return round(100 * complete / total)


def _stage_input_value(state: JourneyExecution, stage: ExecutionStage, key: str):
    progress = _progress_for(state, stage)
    item = progress.input_for(key)
    return item.value if item else None


def _progress_for(state: JourneyExecution, stage: ExecutionStage):
    return next(item for item in state.stage_progress if item.stage == stage)


def _request_action_status(status: RequestStatus) -> NextBestActionStatus:
    if status in {RequestStatus.AVAILABLE, RequestStatus.NOT_APPLICABLE}:
        return NextBestActionStatus.COMPLETED
    if status == RequestStatus.UNAVAILABLE:
        return NextBestActionStatus.WAITING
    return NextBestActionStatus.AVAILABLE


def _matches_review(label: str, filename: str) -> bool:
    item = label.casefold()
    name = filename.casefold()
    keywords = tuple(
        word for word in (
            "agreement", "tenancy", "lease", "deposit", "receipt", "payment",
            "move-in", "move out", "inspection", "condition", "deduction",
            "itemized", "employment", "offer letter", "pay statement", "payslip",
            "time record", "transaction", "order confirmation", "warranty", "message",
            "email", "letter", "notice", "communication", "voicemail", "screenshot",
            "call log", "incident note", "report",
        ) if word in item
    )
    return any(word in name for word in keywords)


def _history_for(state: JourneyExecution, related_ids: tuple[str, ...]) -> tuple[ActionHistoryEntry, ...]:
    related = set(related_ids)
    return tuple(
        ActionHistoryEntry(
            id=event.id,
            sequence=event.sequence,
            event_type=event.event_type,
            summary=event.summary,
            actor=event.actor,
            occurred_at=event.occurred_at,
            related_ids=event.related_ids,
            provenance_ids=event.provenance_ids,
        )
        for event in state.timeline_events
        if related.intersection(event.related_ids)
    )


def _provenance_ids_for(state: JourneyExecution, target_id: str) -> tuple[str, ...]:
    return tuple(record.id for record in state.provenance if record.target_id == target_id)


def _provenance_sources_for(state: JourneyExecution, target_id: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(
        record.source_id for record in state.provenance if record.target_id == target_id
    ))


def _provenance_ids_for_many(state: JourneyExecution, *target_ids: str) -> tuple[str, ...]:
    targets = set(target_ids)
    return tuple(record.id for record in state.provenance if record.target_id in targets)
