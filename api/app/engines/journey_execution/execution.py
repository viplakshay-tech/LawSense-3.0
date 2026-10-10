"""User-controlled execution operations for an existing procedural Journey."""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from typing import Any
from urllib.parse import urlparse

from app.engines.journey import Journey, build_journey
from app.engines.journey.models import JourneyStage
from app.schemas.case_state import CaseState

from app.engines.journey_execution.models import (
    ActionCompletion,
    ActionStatus,
    DocumentRequest,
    EvidenceRequest,
    ExecutionBlocker,
    ExecutionStage,
    JourneyExecution,
    MissingInformation,
    MissingInformationStatus,
    PendingEvidenceReview,
    ProceduralNextStep,
    ProvenanceRecord,
    RequestStatus,
    StageInput,
    StageProgress,
    TimelineEvent,
    Uncertainty,
    UserAction,
)
from app.engines.journey_execution.readiness import (
    derive_action_plan,
    derive_case_readiness,
    select_next_best_action,
)


STAGE_ORDER = tuple(ExecutionStage)


class StageCompletionError(ValueError):
    """Raised when a user attempts to complete a stage with active blockers."""

    def __init__(self, blockers: tuple[ExecutionBlocker, ...]) -> None:
        self.blockers = blockers
        super().__init__("Stage cannot be completed while required inputs or blockers remain.")


def _stable_id(kind: str, *parts: str) -> str:
    payload = "\x1f".join(parts)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]
    return f"{kind}_{digest}"


def _nonempty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (dict, list, tuple, set)):
        return bool(value)
    return True


def _json_check(value: Any) -> None:
    try:
        json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError("Execution inputs must contain only JSON-serializable values.") from exc


def _stage_for_journey(stage: JourneyStage) -> ExecutionStage:
    return {
        JourneyStage.UNDERSTAND: ExecutionStage.PROBLEM,
        JourneyStage.FACTS: ExecutionStage.FACTS,
        JourneyStage.EVIDENCE: ExecutionStage.EVIDENCE,
        JourneyStage.LAW: ExecutionStage.LAW,
        JourneyStage.OPTIONS: ExecutionStage.POSSIBLE_PATHS,
        JourneyStage.NEXT_STEP: ExecutionStage.ACTION,
    }[stage]


def _progress(stage: ExecutionStage, required: tuple[str, ...]) -> StageProgress:
    return StageProgress(stage=stage, required_inputs=required)


def _record_provenance(
    state: JourneyExecution,
    *,
    source_type: str,
    source_id: str,
    target_id: str,
    detail: str,
    recorded_at: str | None,
) -> tuple[JourneyExecution, str]:
    record_id = _stable_id(
        "prov", state.case_id, str(len(state.provenance)), source_type, source_id, target_id, detail
    )
    record = ProvenanceRecord(
        id=record_id,
        source_type=source_type,
        source_id=source_id,
        target_id=target_id,
        detail=detail,
        recorded_at=recorded_at,
    )
    return replace(state, provenance=state.provenance + (record,)), record_id


def _append_event(
    state: JourneyExecution,
    event_type: str,
    summary: str,
    *,
    stage: ExecutionStage | None = None,
    actor: str = "user",
    occurred_at: str | None = None,
    related_ids: tuple[str, ...] = (),
    provenance_ids: tuple[str, ...] = (),
) -> JourneyExecution:
    sequence = len(state.timeline_events)
    event = TimelineEvent(
        id=_stable_id("event", state.case_id, str(sequence), event_type, summary),
        sequence=sequence,
        event_type=event_type,
        summary=summary,
        actor=actor,
        stage=stage,
        occurred_at=occurred_at,
        related_ids=related_ids,
        provenance_ids=provenance_ids,
    )
    return replace(state, timeline_events=state.timeline_events + (event,))


def _upsert_input(progress: StageProgress, value: StageInput) -> StageProgress:
    updated = tuple(item for item in progress.inputs if item.key != value.key) + (value,)
    return replace(progress, inputs=updated)


def _replace_progress(state: JourneyExecution, progress: StageProgress) -> JourneyExecution:
    items = tuple(progress if item.stage == progress.stage else item for item in state.stage_progress)
    return replace(state, stage_progress=items)


def _invalidate_from(state: JourneyExecution, stage: ExecutionStage) -> JourneyExecution:
    start = STAGE_ORDER.index(stage)
    progress = tuple(
        replace(item, completed=False, completed_at=None)
        if STAGE_ORDER.index(item.stage) >= start else item
        for item in state.stage_progress
    )
    return replace(state, stage_progress=progress)


def _input_value(state: JourneyExecution, stage: ExecutionStage, key: str) -> Any:
    progress = next(item for item in state.stage_progress if item.stage == stage)
    item = progress.input_for(key)
    return item.value if item else None


def _is_http_url(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _matching_document_source_ids(case_state: CaseState, item: str) -> tuple[str, ...]:
    """Return only matching document evidence that has a confirmation record."""

    wanted = item.casefold()
    if "agreement" in wanted:
        aliases = ("rental agreement", "tenancy agreement", "lease")
    elif "deposit payment" in wanted:
        aliases = ("deposit receipt", "deposit payment", "payment receipt")
    elif "move-in" in wanted:
        aliases = ("move-in", "move out", "inspection", "condition photo", "key return")
    elif "itemized" in wanted:
        aliases = ("deduction", "itemized explanation", "deposit statement")
    elif "employment terms" in wanted:
        aliases = ("employment terms", "offer letter", "employment agreement")
    elif "pay statement" in wanted:
        aliases = ("pay statement", "payslip", "pay record", "time record")
    elif "receipt" in wanted:
        aliases = ("receipt", "order confirmation", "transaction record")
    elif "product or service" in wanted:
        aliases = ("product description", "service description", "condition photo")
    elif "warranty" in wanted:
        aliases = ("warranty", "service terms")
    elif "voicemail" in wanted:
        aliases = ("voicemail", "screenshot", "call log", "message")
    elif "message" in wanted:
        aliases = ("message", "email", "letter", "communication")
    elif "dated notes" in wanted:
        aliases = ("incident note", "report reference")
    elif "relevant agreements" in wanted:
        aliases = ("agreement", "transaction record", "notice")
    elif "relevant messages" in wanted:
        aliases = ("message", "letter", "communication")
    else:
        aliases = ()
    documents = {document.id: document for document in case_state.documents}
    return tuple(
        evidence.id
        for evidence in case_state.evidence
        if evidence.source == "document"
        and evidence.status in {"evidence_supported", "conflicting", "user_reported"}
        and (
            not evidence.documentId
            or (
                evidence.documentId in documents
                and documents[evidence.documentId].reviewStatus == "confirmed"
            )
        )
        and any(alias in f"{evidence.type} {evidence.title}".casefold() for alias in aliases)
    )


def _stage_blockers(state: JourneyExecution, stage: ExecutionStage) -> tuple[ExecutionBlocker, ...]:
    progress = next(item for item in state.stage_progress if item.stage == stage)
    if progress.completed:
        return ()

    blockers: list[ExecutionBlocker] = []
    stage_index = STAGE_ORDER.index(stage)
    for earlier in STAGE_ORDER[:stage_index]:
        earlier_progress = next(item for item in state.stage_progress if item.stage == earlier)
        if not earlier_progress.completed:
            blockers.append(ExecutionBlocker(
                code="prerequisite_stage_incomplete",
                stage=stage,
                message=f"Complete the {earlier.value} stage before completing this stage.",
                related_id=earlier.value,
            ))

    for key in progress.required_inputs:
        recorded = progress.input_for(key)
        if recorded is None or not _nonempty(recorded.value):
            blockers.append(ExecutionBlocker(
                code="required_input_missing",
                stage=stage,
                message=f"Required input '{key}' has not been recorded.",
                related_id=key,
            ))

    if stage == ExecutionStage.CLARIFY:
        for item in state.missing_information:
            if item.status == MissingInformationStatus.OPEN:
                blockers.append(ExecutionBlocker(
                    code="missing_information_open",
                    stage=stage,
                    message=f"Resolve or explicitly record uncertainty: {item.question}",
                    related_id=item.id,
                ))

    if stage == ExecutionStage.EVIDENCE:
        for item in state.evidence_requests:
            if item.status == RequestStatus.NOT_CONFIRMED:
                blockers.append(ExecutionBlocker(
                    code="evidence_unaddressed",
                    stage=stage,
                    message=f"Evidence request remains unaddressed: {item.item}",
                    related_id=item.id,
                ))

    if stage == ExecutionStage.DOCUMENT:
        for item in state.document_requests:
            if item.status == RequestStatus.NOT_CONFIRMED:
                blockers.append(ExecutionBlocker(
                    code="document_unaddressed",
                    stage=stage,
                    message=f"Document request remains unaddressed: {item.document}",
                    related_id=item.id,
                ))

    if stage == ExecutionStage.LAW:
        verification = _input_value(state, stage, "legal_verification")
        if isinstance(verification, dict) and verification.get("status") != "verified":
            blockers.append(ExecutionBlocker(
                code="legal_verification_incomplete",
                stage=stage,
                message="Legal information is recorded as unverified; jurisdiction-specific options remain blocked.",
                related_id="legal_verification",
            ))
        if isinstance(verification, dict) and verification.get("jurisdiction_specific", True) and state.jurisdiction_status != "known":
            blockers.append(ExecutionBlocker(
                code="jurisdiction_unknown",
                stage=stage,
                message="Jurisdiction-specific legal verification is blocked until location is recorded.",
                related_id="jurisdiction",
            ))

    if stage == ExecutionStage.POSSIBLE_PATHS:
        verification = _input_value(state, ExecutionStage.LAW, "legal_verification")
        if not isinstance(verification, dict) or verification.get("status") != "verified":
            blockers.append(ExecutionBlocker(
                code="legal_verification_required",
                stage=stage,
                message="Possible paths cannot be marked reviewed before legal information is verified.",
                related_id="legal_verification",
            ))
        if state.jurisdiction_status != "known":
            blockers.append(ExecutionBlocker(
                code="jurisdiction_unknown",
                stage=stage,
                message="Jurisdiction-specific paths are blocked until location is recorded.",
                related_id="jurisdiction",
            ))

    if stage == ExecutionStage.OFFICIAL_RESOURCE:
        resource = _input_value(state, stage, "official_resource")
        if isinstance(resource, dict) and resource.get("jurisdiction_specific", True) and state.jurisdiction_status != "known":
            blockers.append(ExecutionBlocker(
                code="jurisdiction_unknown",
                stage=stage,
                message="A jurisdiction-specific official resource is blocked until location is recorded.",
                related_id="jurisdiction",
            ))

    if stage == ExecutionStage.ACTION:
        for action in state.user_actions:
            if action.status not in {ActionStatus.COMPLETED, ActionStatus.CANCELLED}:
                blockers.extend(_action_blockers(state, action))

    return tuple(blockers)


def _action_blockers(state: JourneyExecution, action: UserAction) -> tuple[ExecutionBlocker, ...]:
    if action.jurisdiction_required and state.jurisdiction_status != "known":
        return (ExecutionBlocker(
            code="jurisdiction_unknown",
            stage=action.stage,
            message=f"This action requires a known jurisdiction: {action.action}",
            related_id="jurisdiction",
            action_id=action.id,
        ),)
    return ()


def _uncertainties(state: JourneyExecution, base: tuple[Uncertainty, ...] = ()) -> tuple[Uncertainty, ...]:
    result: list[Uncertainty] = list(base)
    seen = {item.id for item in result}
    for item in state.missing_information:
        if item.status in {MissingInformationStatus.OPEN, MissingInformationStatus.CANNOT_DETERMINE}:
            status_note = "" if item.status == MissingInformationStatus.OPEN else (
                f" The user recorded that this cannot currently be determined: {item.answer}"
            )
            uncertainty = Uncertainty(
                id=_stable_id("uncertainty", state.case_id, "missing", item.id),
                category="missing_information",
                description=item.question + status_note,
                source_ids=item.source_ids,
                related_id=item.id,
            )
            if uncertainty.id not in seen:
                result.append(uncertainty)
                seen.add(uncertainty.id)
    for item in state.evidence_requests:
        if item.status in {RequestStatus.NOT_CONFIRMED, RequestStatus.UNAVAILABLE}:
            uncertainty = Uncertainty(
                id=_stable_id("uncertainty", state.case_id, "evidence", item.id),
                category="evidence_gap",
                description=f"Evidence status for '{item.item}' is {item.status.value}.",
                source_ids=item.source_ids,
                related_id=item.id,
            )
            if uncertainty.id not in seen:
                result.append(uncertainty)
                seen.add(uncertainty.id)
    for item in state.document_requests:
        if item.status in {RequestStatus.NOT_CONFIRMED, RequestStatus.UNAVAILABLE}:
            uncertainty = Uncertainty(
                id=_stable_id("uncertainty", state.case_id, "document", item.id),
                category="document_gap",
                description=f"Document status for '{item.document}' is {item.status.value}.",
                source_ids=item.source_ids,
                related_id=item.id,
            )
            if uncertainty.id not in seen:
                result.append(uncertainty)
                seen.add(uncertainty.id)
    return tuple(result)


def _refresh(state: JourneyExecution, *, base_uncertainties: tuple[Uncertainty, ...] | None = None) -> JourneyExecution:
    uncertainty_base = state.uncertainties if base_uncertainties is None else base_uncertainties
    # Generated uncertainty entries are removed before regenerating them from live state.
    static_uncertainties = tuple(
        item for item in uncertainty_base
        if item.category not in {"missing_information", "evidence_gap", "document_gap"}
    )
    state = replace(state, uncertainties=_uncertainties(state, static_uncertainties))
    blockers = tuple(
        blocker for stage in STAGE_ORDER for blocker in _stage_blockers(state, stage)
    )
    completed = tuple(item.stage for item in state.stage_progress if item.completed)
    blocked = tuple(stage for stage in STAGE_ORDER if any(item.stage == stage for item in blockers))
    state = replace(state, blockers=blockers, completed_stages=completed, blocked_stages=blocked)
    readiness = derive_case_readiness(state)
    action_plan = derive_action_plan(state, readiness)
    return replace(
        state,
        case_readiness=readiness,
        action_plan=action_plan,
        next_best_action=select_next_best_action(action_plan),
    )


def create_execution(
    case_state: CaseState,
    *,
    journey: Journey | None = None,
) -> JourneyExecution:
    """Create execution state from the current immutable ``CaseState`` and Journey.

    The existing journey planner remains the source of suggested information,
    evidence, documents, and next actions. Nothing is marked performed here.
    """

    plan = journey or build_journey(case_state)
    if plan.case_id != case_state.id:
        raise ValueError("journey.case_id must match case_state.id")

    jurisdiction = {
        "country": case_state.jurisdiction.country,
        "state": case_state.jurisdiction.state,
        "district": case_state.jurisdiction.district,
        "city": case_state.jurisdiction.city,
        "basis": case_state.jurisdiction.basis,
    }
    jurisdiction = {key: value for key, value in jurisdiction.items() if value is not None}
    case_source = f"case_state:{case_state.id}"
    journey_source = f"journey:{plan.id}"

    provenance = (
        ProvenanceRecord(
            id=_stable_id("prov", case_state.id, "case-state"),
            source_type="case_state",
            source_id=case_source,
            target_id=case_state.id,
            detail="Execution initialized from the existing CaseState snapshot.",
            recorded_at=case_state.metadata.createdAt,
        ),
        ProvenanceRecord(
            id=_stable_id("prov", case_state.id, "journey"),
            source_type="journey",
            source_id=journey_source,
            target_id=plan.id,
            detail="Planning items copied from the existing journey outline.",
        ),
    )
    case_provenance = provenance[0].id
    journey_provenance = provenance[1].id

    missing_information = tuple(
        MissingInformation(
            id=item.id,
            question=item.question,
            source_ids=(journey_source,),
            provenance_ids=(journey_provenance,),
            related_to=item.related_to,
        )
        for item in plan.unknowns
    )

    evidence_requests_list: list[EvidenceRequest] = []
    for item in plan.required_evidence:
        source_ids = _matching_document_source_ids(case_state, item.item)
        available = item.availability == "recorded_in_case_state" and bool(source_ids)
        evidence_requests_list.append(EvidenceRequest(
            id=item.id,
            item=item.item,
            purpose=item.purpose,
            status=RequestStatus.AVAILABLE if available else RequestStatus.NOT_CONFIRMED,
            notes="Recorded in CaseState and user-confirmed." if available else None,
            source_ids=source_ids,
            provenance_ids=(journey_provenance,),
        ))
    evidence_requests = tuple(evidence_requests_list)
    document_requests = tuple(
        DocumentRequest(
            id=item.id,
            document=item.document,
            purpose=item.purpose,
            status=(RequestStatus.AVAILABLE if item.availability == "recorded_in_case_state" and _matching_document_source_ids(case_state, item.document) else RequestStatus.NOT_CONFIRMED),
            notes="Recorded in CaseState and user-confirmed." if item.availability == "recorded_in_case_state" and _matching_document_source_ids(case_state, item.document) else None,
            source_ids=_matching_document_source_ids(case_state, item.document) if item.availability == "recorded_in_case_state" else (),
            provenance_ids=(journey_provenance,),
        )
        for item in plan.required_documents
    )

    action_rows = tuple(
        UserAction(
            id=item.id,
            action=item.action,
            reason=item.reason,
            stage=_stage_for_journey(item.stage),
            condition=item.condition,
            jurisdiction_required=(
                "jurisdiction-specific" in item.action.casefold()
                or "jurisdiction-specific" in item.reason.casefold()
                or item.stage == JourneyStage.OPTIONS
            ),
        )
        for item in plan.next_actions
    )
    next_steps = tuple(
        ProceduralNextStep(
            id=item.id,
            description=item.action if not item.condition else f"{item.action} {item.condition}",
            reason=item.reason,
            stage=_stage_for_journey(item.stage),
            condition=item.condition,
            jurisdiction_required=(
                "jurisdiction-specific" in item.action.casefold()
                or "jurisdiction-specific" in item.reason.casefold()
                or item.stage == JourneyStage.OPTIONS
            ),
        )
        for item in plan.next_actions
    )

    progress: list[StageProgress] = [
        _progress(ExecutionStage.PROBLEM, ("problem_summary",)),
        _progress(ExecutionStage.CLARIFY, ("desired_outcome", "clarifications_reviewed")),
        _progress(ExecutionStage.FACTS, ("timeline_reviewed",)),
        _progress(ExecutionStage.EVIDENCE, tuple(f"evidence:{item.id}" for item in evidence_requests)),
        _progress(ExecutionStage.LAW, ("legal_verification",)),
        _progress(ExecutionStage.POSSIBLE_PATHS, ("paths_reviewed",)),
        _progress(ExecutionStage.DOCUMENT, tuple(f"document:{item.id}" for item in document_requests)),
        _progress(ExecutionStage.OFFICIAL_RESOURCE, ("official_resource",)),
        _progress(ExecutionStage.ACTION, ("action_plan_reviewed",)),
        _progress(ExecutionStage.FOLLOW_UP, ("follow_up_plan",)),
    ]

    for index, item in enumerate(progress):
        if item.stage == ExecutionStage.PROBLEM:
            progress[index] = _upsert_input(item, StageInput(
                key="problem_summary",
                value=plan.current_situation,
                source_ids=(case_source, journey_source),
                provenance_ids=(case_provenance, journey_provenance),
                recorded_at=case_state.metadata.createdAt,
            ))
        elif item.stage == ExecutionStage.CLARIFY and case_state.intent is not None:
            progress[index] = _upsert_input(item, StageInput(
                key="desired_outcome",
                value=case_state.intent.objective,
                source_ids=(case_source,),
                provenance_ids=(case_provenance,),
                recorded_at=case_state.metadata.createdAt,
            ))
        elif item.stage == ExecutionStage.EVIDENCE:
            for request in evidence_requests:
                if request.status == RequestStatus.AVAILABLE:
                    progress[index] = _upsert_input(progress[index], StageInput(
                        key=f"evidence:{request.id}",
                        value={"status": request.status.value, "notes": request.notes},
                        source_ids=request.source_ids,
                        provenance_ids=request.provenance_ids,
                        recorded_at=case_state.metadata.createdAt,
                    ))
        elif item.stage == ExecutionStage.DOCUMENT:
            for request in document_requests:
                if request.status == RequestStatus.AVAILABLE:
                    progress[index] = _upsert_input(progress[index], StageInput(
                        key=f"document:{request.id}",
                        value={"status": request.status.value, "notes": request.notes},
                        source_ids=request.source_ids,
                        provenance_ids=request.provenance_ids,
                        recorded_at=case_state.metadata.createdAt,
                    ))

    static_uncertainties = [
        Uncertainty(
            id=_stable_id("uncertainty", case_state.id, "assumption", str(index), value),
            category="case_state_assumption",
            description=value,
            source_ids=(case_source,),
        )
        for index, value in enumerate(case_state.assumptions)
    ]
    static_uncertainties.extend(
        Uncertainty(
            id=_stable_id("uncertainty", case_state.id, "conflict", str(index), value),
            category="case_state_conflict",
            description=value,
            source_ids=(case_source,),
        )
        for index, value in enumerate(case_state.conflicts)
    )

    initial_event = TimelineEvent(
        id=_stable_id("event", case_state.id, "0", "execution_created"),
        sequence=0,
        event_type="execution_created",
        summary="Execution state initialized from the recorded CaseState and Journey.",
        actor="system",
        stage=ExecutionStage.PROBLEM,
        occurred_at=case_state.metadata.createdAt,
        related_ids=(case_state.id, plan.id),
        provenance_ids=(case_provenance, journey_provenance),
    )

    evidence_by_document = {
        item.documentId: item for item in case_state.evidence if item.documentId
    }
    pending_evidence_reviews = tuple(
        PendingEvidenceReview(
            document_id=document.id,
            evidence_id=evidence_by_document.get(document.id).id if document.id in evidence_by_document else None,
            filename=document.filename,
            source_ids=(evidence_by_document[document.id].id,) if document.id in evidence_by_document else (),
        )
        for document in case_state.documents
        if document.reviewStatus == "awaiting_confirmation"
    )
    safety_context = "unknown"
    safety_urgency = "none"
    safety_source_ids: tuple[str, ...] = ()
    if case_state.analysis is not None:
        safety = case_state.analysis.safety_context
        safety_context = safety.context
        safety_urgency = safety.urgency
        safety_source_ids = tuple(safety.source_ids)
    elif plan.escalation_points:
        safety_context = "potentially_unsafe"
        safety_source_ids = tuple(risk.id for risk in plan.escalation_points)

    legal_records_available = bool(
        case_state.analysis is not None
        and case_state.analysis.legal_knowledge.status == "records_found"
        and case_state.analysis.legal_knowledge.records
    )

    state = JourneyExecution(
        id=_stable_id("execution", case_state.id, plan.id),
        case_id=case_state.id,
        current_stage=ExecutionStage.PROBLEM,
        jurisdiction=jurisdiction,
        jurisdiction_status=plan.jurisdiction_status,
        stage_progress=tuple(progress),
        missing_information=missing_information,
        evidence_requests=evidence_requests,
        document_requests=document_requests,
        user_actions=action_rows,
        procedural_next_steps=next_steps,
        timeline_events=(initial_event,),
        provenance=provenance,
        uncertainties=tuple(static_uncertainties),
        recorded_fact_count=sum(
            item.status in {"user_reported", "evidence_supported", "system_inferred"}
            for item in case_state.facts
        ),
        conflicts=tuple(case_state.conflicts),
        assumptions=tuple(case_state.assumptions),
        pending_evidence_reviews=pending_evidence_reviews,
        safety_context=safety_context,
        safety_urgency=safety_urgency,
        safety_source_ids=safety_source_ids,
        legal_records_available=legal_records_available,
    )
    return _refresh(state, base_uncertainties=tuple(static_uncertainties))


def transition_to(
    state: JourneyExecution,
    stage: ExecutionStage | str,
    *,
    at: str | None = None,
) -> JourneyExecution:
    """Record explicit user navigation; transitions never complete a stage."""

    target = ExecutionStage(stage)
    if target == state.current_stage:
        return state
    previous = state.current_stage
    updated = replace(state, current_stage=target)
    updated = _append_event(
        updated,
        "stage_transition",
        f"User moved from {previous.value} to {target.value}.",
        stage=target,
        occurred_at=at,
        related_ids=(previous.value, target.value),
    )
    return _refresh(updated)


def complete_stage(
    state: JourneyExecution,
    stage: ExecutionStage | str,
    *,
    at: str | None = None,
) -> JourneyExecution:
    """Record completion only when the selected stage is current and unblocked."""

    selected = ExecutionStage(stage)
    if selected != state.current_stage:
        raise ValueError("Only the current user-selected stage can be completed.")
    blockers = _stage_blockers(state, selected)
    if blockers:
        raise StageCompletionError(blockers)
    progress = next(item for item in state.stage_progress if item.stage == selected)
    updated = _replace_progress(state, replace(progress, completed=True, completed_at=at))
    updated = _append_event(
        updated,
        "stage_completed",
        f"User recorded the {selected.value} stage as complete.",
        stage=selected,
        occurred_at=at,
        related_ids=(selected.value,),
    )
    return _refresh(updated)


def record_stage_input(
    state: JourneyExecution,
    stage: ExecutionStage | str,
    key: str,
    value: Any,
    *,
    source_id: str = "user",
    at: str | None = None,
) -> JourneyExecution:
    """Record one declared stage input and its user/source provenance."""

    selected = ExecutionStage(stage)
    progress = next((item for item in state.stage_progress if item.stage == selected), None)
    if progress is None or key not in progress.required_inputs:
        raise ValueError(f"'{key}' is not a required input for the {selected.value} stage.")
    if not _nonempty(value):
        raise ValueError("A required input must contain a non-empty value.")
    _json_check(value)
    if not source_id.strip():
        raise ValueError("source_id must be non-empty.")

    if key == "legal_verification":
        if not isinstance(value, dict) or value.get("status") not in {"verified", "not_verified"}:
            raise ValueError("legal_verification must include status 'verified' or 'not_verified'.")
        if value.get("status") == "verified" and (
            not _nonempty(value.get("source_title")) or not _is_http_url(value.get("source_url"))
        ):
            raise ValueError("Verified legal information requires a source title and HTTP(S) source_url.")
    elif key == "official_resource":
        if not isinstance(value, dict) or value.get("is_official") is not True:
            raise ValueError("official_resource must explicitly identify an official resource.")
        if not _nonempty(value.get("title")) or not _is_http_url(value.get("url")):
            raise ValueError("official_resource requires a title and HTTP(S) URL.")
    elif key in {"desired_outcome", "clarifications_reviewed", "timeline_reviewed", "paths_reviewed", "action_plan_reviewed", "follow_up_plan", "problem_summary"}:
        if not isinstance(value, (str, dict, list)):
            raise ValueError(f"{key} must be recorded as text or a JSON object/list.")

    updated = _invalidate_from(state, selected)
    updated, provenance_id = _record_provenance(
        updated,
        source_type="user" if source_id == "user" else "external_source",
        source_id=source_id,
        target_id=f"input:{selected.value}:{key}",
        detail=f"User recorded input '{key}' for the {selected.value} stage.",
        recorded_at=at,
    )
    progress = next(item for item in updated.stage_progress if item.stage == selected)
    input_record = StageInput(
        key=key,
        value=value,
        source_ids=(source_id,),
        provenance_ids=(provenance_id,),
        recorded_at=at,
    )
    updated = _replace_progress(updated, _upsert_input(progress, input_record))
    updated = _append_event(
        updated,
        "stage_input_recorded",
        f"User recorded required input '{key}' for {selected.value}.",
        stage=selected,
        occurred_at=at,
        related_ids=(key,),
        provenance_ids=(provenance_id,),
    )
    return _refresh(updated)


def resolve_missing_information(
    state: JourneyExecution,
    information_id: str,
    answer: str,
    *,
    source_id: str = "user",
    at: str | None = None,
) -> JourneyExecution:
    """Record an answer to a specific open question without rewriting CaseState."""

    if not answer.strip():
        raise ValueError("answer must be non-empty.")
    item = next((row for row in state.missing_information if row.id == information_id), None)
    if item is None:
        raise ValueError(f"Unknown missing-information id: {information_id}")
    updated = _invalidate_from(state, ExecutionStage.CLARIFY)
    updated, provenance_id = _record_provenance(
        updated,
        source_type="user" if source_id == "user" else "external_source",
        source_id=source_id,
        target_id=information_id,
        detail="User supplied an answer to a missing-information question.",
        recorded_at=at,
    )
    updated = replace(
        updated,
        missing_information=tuple(
            replace(row, status=MissingInformationStatus.ANSWERED, answer=answer.strip(),
                    source_ids=(source_id,), provenance_ids=(provenance_id,))
            if row.id == information_id else row
            for row in updated.missing_information
        ),
    )
    updated = _append_event(
        updated,
        "missing_information_answered",
        f"User recorded an answer for: {item.question}",
        stage=ExecutionStage.CLARIFY,
        occurred_at=at,
        related_ids=(information_id,),
        provenance_ids=(provenance_id,),
    )
    return _refresh(updated)


def record_information_undetermined(
    state: JourneyExecution,
    information_id: str,
    reason: str,
    *,
    source_id: str = "user",
    at: str | None = None,
) -> JourneyExecution:
    """Record that a question cannot currently be answered; preserve uncertainty."""

    if not reason.strip():
        raise ValueError("reason must be non-empty.")
    item = next((row for row in state.missing_information if row.id == information_id), None)
    if item is None:
        raise ValueError(f"Unknown missing-information id: {information_id}")
    updated = _invalidate_from(state, ExecutionStage.CLARIFY)
    updated, provenance_id = _record_provenance(
        updated,
        source_type="user" if source_id == "user" else "external_source",
        source_id=source_id,
        target_id=information_id,
        detail="User recorded that the information cannot currently be determined.",
        recorded_at=at,
    )
    updated = replace(
        updated,
        missing_information=tuple(
            replace(row, status=MissingInformationStatus.CANNOT_DETERMINE, answer=reason.strip(),
                    source_ids=(source_id,), provenance_ids=(provenance_id,))
            if row.id == information_id else row
            for row in updated.missing_information
        ),
    )
    updated = _append_event(
        updated,
        "missing_information_unresolved_recorded",
        f"User recorded uncertainty for: {item.question}",
        stage=ExecutionStage.CLARIFY,
        occurred_at=at,
        related_ids=(information_id,),
        provenance_ids=(provenance_id,),
    )
    return _refresh(updated)


def record_jurisdiction(
    state: JourneyExecution,
    *,
    country: str | None = None,
    state_name: str | None = None,
    district: str | None = None,
    city: str | None = None,
    source_id: str = "user",
    at: str | None = None,
) -> JourneyExecution:
    """Record a user-provided place and unblock only jurisdiction-dependent work."""

    supplied = {"country": country, "state": state_name, "district": district, "city": city}
    supplied = {key: value.strip() for key, value in supplied.items() if isinstance(value, str) and value.strip()}
    if not supplied:
        raise ValueError("At least one non-empty jurisdiction field is required.")
    if not source_id.strip():
        raise ValueError("source_id must be non-empty.")
    updated = _invalidate_from(state, ExecutionStage.CLARIFY)
    jurisdiction = dict(updated.jurisdiction)
    jurisdiction.update(supplied)
    jurisdiction["basis"] = "user_reported"
    updated, provenance_id = _record_provenance(
        updated,
        source_type="user" if source_id == "user" else "external_source",
        source_id=source_id,
        target_id="jurisdiction",
        detail="User recorded the relevant location.",
        recorded_at=at,
    )
    place = ", ".join(supplied.values())
    updated = replace(updated, jurisdiction=jurisdiction, jurisdiction_status="known")
    updated = replace(
        updated,
        missing_information=tuple(
            replace(row, status=MissingInformationStatus.ANSWERED, answer=place,
                    source_ids=(source_id,), provenance_ids=(provenance_id,))
            if any(token in row.question.casefold() for token in ("location", "jurisdiction", "which country"))
            else row
            for row in updated.missing_information
        ),
    )
    updated = _append_event(
        updated,
        "jurisdiction_recorded",
        f"User recorded jurisdiction: {place}.",
        stage=ExecutionStage.CLARIFY,
        occurred_at=at,
        related_ids=("jurisdiction",),
        provenance_ids=(provenance_id,),
    )
    return _refresh(updated)


def _update_request(
    state: JourneyExecution,
    *,
    kind: str,
    request_id: str,
    status: RequestStatus | str,
    notes: str | None,
    source_id: str | None,
    at: str | None,
) -> JourneyExecution:
    selected_status = RequestStatus(status)
    if selected_status in {RequestStatus.UNAVAILABLE, RequestStatus.NOT_APPLICABLE} and not (notes and notes.strip()):
        raise ValueError("Record why an evidence or document request is unavailable or not applicable.")

    if kind == "evidence":
        requests: tuple[EvidenceRequest | DocumentRequest, ...] = state.evidence_requests
        stage = ExecutionStage.EVIDENCE
    else:
        requests = state.document_requests
        stage = ExecutionStage.DOCUMENT
    request = next((item for item in requests if item.id == request_id), None)
    if request is None:
        raise ValueError(f"Unknown {kind} request id: {request_id}")
    if selected_status == RequestStatus.AVAILABLE and not (source_id or request.source_ids):
        raise ValueError("Marking a request available requires a recorded source_id.")

    updated = _invalidate_from(state, stage)
    source = source_id or "user"
    updated, provenance_id = _record_provenance(
        updated,
        source_type="user" if source == "user" else "document_or_external_source",
        source_id=source,
        target_id=request_id,
        detail=f"User updated {kind} request status to {selected_status.value}.",
        recorded_at=at,
    )
    new_source_ids = tuple(dict.fromkeys(request.source_ids + ((source,) if selected_status == RequestStatus.AVAILABLE else ())))
    new_provenance_ids = tuple(dict.fromkeys(request.provenance_ids + (provenance_id,)))
    if kind == "evidence":
        updated = replace(updated, evidence_requests=tuple(
            replace(item, status=selected_status, notes=notes, source_ids=new_source_ids,
                    provenance_ids=new_provenance_ids) if item.id == request_id else item
            for item in updated.evidence_requests
        ))
    else:
        updated = replace(updated, document_requests=tuple(
            replace(item, status=selected_status, notes=notes, source_ids=new_source_ids,
                    provenance_ids=new_provenance_ids) if item.id == request_id else item
            for item in updated.document_requests
        ))

    progress = next(item for item in updated.stage_progress if item.stage == stage)
    input_key = f"{kind}:{request_id}"
    progress = _upsert_input(progress, StageInput(
        key=input_key,
        value={"status": selected_status.value, "notes": notes},
        source_ids=(source,),
        provenance_ids=(provenance_id,),
        recorded_at=at,
    ))
    updated = _replace_progress(updated, progress)
    label = request.item if kind == "evidence" else request.document
    updated = _append_event(
        updated,
        f"{kind}_request_updated",
        f"User recorded {kind} request '{label}' as {selected_status.value}.",
        stage=stage,
        occurred_at=at,
        related_ids=(request_id,),
        provenance_ids=(provenance_id,),
    )
    return _refresh(updated)


def update_evidence_request(
    state: JourneyExecution,
    request_id: str,
    status: RequestStatus | str,
    *,
    notes: str | None = None,
    source_id: str | None = None,
    at: str | None = None,
) -> JourneyExecution:
    return _update_request(
        state, kind="evidence", request_id=request_id, status=status, notes=notes,
        source_id=source_id, at=at,
    )


def update_document_request(
    state: JourneyExecution,
    request_id: str,
    status: RequestStatus | str,
    *,
    notes: str | None = None,
    source_id: str | None = None,
    at: str | None = None,
) -> JourneyExecution:
    return _update_request(
        state, kind="document", request_id=request_id, status=status, notes=notes,
        source_id=source_id, at=at,
    )


def complete_action(
    state: JourneyExecution,
    action_id: str,
    user_reported_outcome: str,
    *,
    recorded_at: str,
    source_id: str = "user",
) -> JourneyExecution:
    """Record the user's report that an action happened; never execute it."""

    if not user_reported_outcome.strip():
        raise ValueError("user_reported_outcome must be non-empty.")
    if not recorded_at.strip():
        raise ValueError("recorded_at is required to record action completion.")
    action = next((item for item in state.user_actions if item.id == action_id), None)
    if action is None:
        raise ValueError(f"Unknown action id: {action_id}")
    if action.status == ActionStatus.COMPLETED:
        raise ValueError("This action already has a completion record.")
    if action.status == ActionStatus.CANCELLED:
        raise ValueError("A cancelled action must be explicitly reopened before completion can be recorded.")
    blockers = _action_blockers(state, action)
    if blockers:
        raise StageCompletionError(blockers)

    updated, provenance_id = _record_provenance(
        state,
        source_type="user" if source_id == "user" else "external_source",
        source_id=source_id,
        target_id=action_id,
        detail="User recorded action completion.",
        recorded_at=recorded_at,
    )
    completion = ActionCompletion(
        recorded_at=recorded_at,
        user_reported_outcome=user_reported_outcome.strip(),
        provenance_ids=(provenance_id,),
    )
    updated = replace(updated, user_actions=tuple(
        replace(item, status=ActionStatus.COMPLETED, completion=completion) if item.id == action_id else item
        for item in updated.user_actions
    ))
    updated = _append_event(
        updated,
        "action_completion_recorded",
        f"User recorded that the action was completed: {action.action}. Reported outcome: {user_reported_outcome.strip()}",
        stage=action.stage,
        occurred_at=recorded_at,
        related_ids=(action_id,),
        provenance_ids=(provenance_id,),
    )
    return _refresh(updated)


def set_action_status(
    state: JourneyExecution,
    action_id: str,
    status: ActionStatus | str,
    *,
    reason: str | None = None,
    at: str | None = None,
) -> JourneyExecution:
    """Mark a proposed action in progress, waiting, or cancelled; completion is separately reported."""

    selected = ActionStatus(status)
    if selected not in {ActionStatus.IN_PROGRESS, ActionStatus.WAITING, ActionStatus.CANCELLED}:
        raise ValueError("Use complete_action to record completion; only in_progress, waiting, or cancelled can be set here.")
    action = next((item for item in state.user_actions if item.id == action_id), None)
    if action is None:
        raise ValueError(f"Unknown action id: {action_id}")
    if action.status == ActionStatus.COMPLETED:
        raise ValueError("A completed action cannot be changed to another status.")
    if selected == ActionStatus.IN_PROGRESS:
        blockers = _action_blockers(state, action)
        if blockers:
            raise StageCompletionError(blockers)
    if selected in {ActionStatus.CANCELLED, ActionStatus.WAITING} and not (reason and reason.strip()):
        raise ValueError("Record a reason when cancelling an action or marking it as waiting.")

    updated = replace(state, user_actions=tuple(
        replace(item, status=selected) if item.id == action_id else item
        for item in state.user_actions
    ))
    updated = _append_event(
        updated,
        "action_status_recorded",
        f"User recorded action status as {selected.value}: {action.action}"
        + (f" Reason: {reason.strip()}" if reason and reason.strip() else ""),
        stage=action.stage,
        occurred_at=at,
        related_ids=(action_id,),
    )
    return _refresh(updated)


def action_blockers(state: JourneyExecution, action_id: str) -> tuple[ExecutionBlocker, ...]:
    """Return current blockers for one proposed user action."""

    action = next((item for item in state.user_actions if item.id == action_id), None)
    if action is None:
        raise ValueError(f"Unknown action id: {action_id}")
    return _action_blockers(state, action)

