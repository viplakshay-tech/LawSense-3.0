"""Serializable execution-state contracts for the procedural journey engine.

These models track what has been recorded, what is still unknown, and which
user-directed work remains. They do not perform legal or external actions.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any


class ExecutionStage(StrEnum):
    PROBLEM = "Problem"
    CLARIFY = "Clarify"
    FACTS = "Facts"
    EVIDENCE = "Evidence"
    LAW = "Law"
    POSSIBLE_PATHS = "Possible Paths"
    DOCUMENT = "Document"
    OFFICIAL_RESOURCE = "Official Resource"
    ACTION = "Action"
    FOLLOW_UP = "Follow-up"


class MissingInformationStatus(StrEnum):
    OPEN = "open"
    ANSWERED = "answered"
    CANNOT_DETERMINE = "cannot_determine"


class RequestStatus(StrEnum):
    NOT_CONFIRMED = "not_confirmed"
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    NOT_APPLICABLE = "not_applicable"


class ActionStatus(StrEnum):
    PROPOSED = "proposed"
    IN_PROGRESS = "in_progress"
    WAITING = "waiting"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class NextBestActionStatus(StrEnum):
    BLOCKED = "BLOCKED"
    AVAILABLE = "AVAILABLE"
    IN_PROGRESS = "IN_PROGRESS"
    WAITING = "WAITING"
    COMPLETED = "COMPLETED"


class ReadinessDimensionName(StrEnum):
    FACTS = "facts"
    EVIDENCE = "evidence"
    JURISDICTION = "jurisdiction"
    LEGAL_GROUNDING = "legal_grounding"
    DOCUMENTS = "documents"
    PROCEDURE = "procedure"
    SAFETY = "safety"


class ReadinessLevel(StrEnum):
    READY = "ready"
    PARTIAL = "partial"
    BLOCKED = "blocked"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class StageInput:
    key: str
    value: Any
    source_ids: tuple[str, ...] = ()
    provenance_ids: tuple[str, ...] = ()
    recorded_at: str | None = None


@dataclass(frozen=True, slots=True)
class StageProgress:
    stage: ExecutionStage
    required_inputs: tuple[str, ...]
    inputs: tuple[StageInput, ...] = ()
    completed: bool = False
    completed_at: str | None = None

    def input_for(self, key: str) -> StageInput | None:
        return next((item for item in self.inputs if item.key == key), None)


@dataclass(frozen=True, slots=True)
class MissingInformation:
    id: str
    question: str
    status: MissingInformationStatus = MissingInformationStatus.OPEN
    answer: str | None = None
    source_ids: tuple[str, ...] = ()
    provenance_ids: tuple[str, ...] = ()
    related_to: str | None = None


@dataclass(frozen=True, slots=True)
class EvidenceRequest:
    id: str
    item: str
    purpose: str
    status: RequestStatus = RequestStatus.NOT_CONFIRMED
    notes: str | None = None
    source_ids: tuple[str, ...] = ()
    provenance_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DocumentRequest:
    id: str
    document: str
    purpose: str
    status: RequestStatus = RequestStatus.NOT_CONFIRMED
    notes: str | None = None
    source_ids: tuple[str, ...] = ()
    provenance_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ActionCompletion:
    recorded_at: str
    user_reported_outcome: str
    provenance_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class UserAction:
    id: str
    action: str
    reason: str
    stage: ExecutionStage
    condition: str | None = None
    jurisdiction_required: bool = False
    status: ActionStatus = ActionStatus.PROPOSED
    completion: ActionCompletion | None = None


@dataclass(frozen=True, slots=True)
class ProceduralNextStep:
    id: str
    description: str
    reason: str
    stage: ExecutionStage
    condition: str | None = None
    jurisdiction_required: bool = False


@dataclass(frozen=True, slots=True)
class ProvenanceRecord:
    id: str
    source_type: str
    source_id: str
    target_id: str
    detail: str
    recorded_at: str | None = None


@dataclass(frozen=True, slots=True)
class TimelineEvent:
    id: str
    sequence: int
    event_type: str
    summary: str
    actor: str
    stage: ExecutionStage | None = None
    occurred_at: str | None = None
    related_ids: tuple[str, ...] = ()
    provenance_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ActionHistoryEntry:
    id: str
    sequence: int
    event_type: str
    summary: str
    actor: str
    occurred_at: str | None = None
    related_ids: tuple[str, ...] = ()
    provenance_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ReadinessBlocker:
    id: str
    code: str
    dimension: ReadinessDimensionName
    message: str
    severity: str = "attention"
    related_ids: tuple[str, ...] = ()
    source_ids: tuple[str, ...] = ()
    provenance_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ReadinessDimension:
    name: ReadinessDimensionName
    score: int
    level: ReadinessLevel
    explanation: str
    blocker_ids: tuple[str, ...] = ()
    source_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CaseReadiness:
    """Completeness of the recorded case materials, never an outcome forecast."""

    score: int
    explanation: str
    dimensions: tuple[ReadinessDimension, ...]
    blockers: tuple[ReadinessBlocker, ...] = ()


@dataclass(frozen=True, slots=True)
class NextBestAction:
    """A Journey-linked action projection with explicit prerequisites and history."""

    id: str
    action: str
    reason: str
    status: NextBestActionStatus
    dimension: ReadinessDimensionName
    stage: ExecutionStage
    priority: int
    source_type: str
    source_ids: tuple[str, ...] = ()
    dependencies: tuple[str, ...] = ()
    blocker_ids: tuple[str, ...] = ()
    provenance_ids: tuple[str, ...] = ()
    history: tuple[ActionHistoryEntry, ...] = ()


@dataclass(frozen=True, slots=True)
class PendingEvidenceReview:
    document_id: str
    evidence_id: str | None
    filename: str
    source_ids: tuple[str, ...] = ()
    provenance_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Uncertainty:
    id: str
    category: str
    description: str
    source_ids: tuple[str, ...] = ()
    related_id: str | None = None


@dataclass(frozen=True, slots=True)
class ExecutionBlocker:
    code: str
    stage: ExecutionStage
    message: str
    related_id: str | None = None
    action_id: str | None = None


@dataclass(frozen=True, slots=True)
class JourneyExecution:
    """A deterministic, JSON-compatible execution snapshot for one CaseState."""

    id: str
    case_id: str
    current_stage: ExecutionStage
    jurisdiction: dict[str, Any]
    jurisdiction_status: str
    stage_progress: tuple[StageProgress, ...]
    missing_information: tuple[MissingInformation, ...]
    evidence_requests: tuple[EvidenceRequest, ...]
    document_requests: tuple[DocumentRequest, ...]
    user_actions: tuple[UserAction, ...]
    procedural_next_steps: tuple[ProceduralNextStep, ...]
    timeline_events: tuple[TimelineEvent, ...]
    provenance: tuple[ProvenanceRecord, ...]
    uncertainties: tuple[Uncertainty, ...]
    completed_stages: tuple[ExecutionStage, ...] = ()
    blocked_stages: tuple[ExecutionStage, ...] = ()
    blockers: tuple[ExecutionBlocker, ...] = ()
    recorded_fact_count: int = 0
    conflicts: tuple[str, ...] = ()
    assumptions: tuple[str, ...] = ()
    pending_evidence_reviews: tuple[PendingEvidenceReview, ...] = ()
    safety_context: str = "unknown"
    safety_urgency: str = "none"
    safety_source_ids: tuple[str, ...] = ()
    legal_records_available: bool = False
    case_readiness: CaseReadiness | None = None
    action_plan: tuple[NextBestAction, ...] = ()
    next_best_action: NextBestAction | None = None

    @property
    def missing_evidence(self) -> tuple[EvidenceRequest, ...]:
        """Evidence still absent or not yet confirmed remains visible here."""

        return tuple(
            item for item in self.evidence_requests
            if item.status in {RequestStatus.NOT_CONFIRMED, RequestStatus.UNAVAILABLE}
        )

    @property
    def missing_documents(self) -> tuple[DocumentRequest, ...]:
        return tuple(
            item for item in self.document_requests
            if item.status in {RequestStatus.NOT_CONFIRMED, RequestStatus.UNAVAILABLE}
        )

    def status_for_stage(self, stage: ExecutionStage | str) -> str:
        selected = ExecutionStage(stage)
        if selected in self.completed_stages:
            return "completed"
        if selected in self.blocked_stages:
            return "blocked"
        if selected == self.current_stage:
            return "current"
        return "not_started"

    def to_dict(self) -> dict[str, Any]:
        """Return only ordinary JSON values; tuples and enums become arrays/strings."""

        return _json_value(asdict(self))

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> JourneyExecution:
        """Restore an execution snapshot previously returned by :meth:`to_dict`."""

        return cls(
            id=value["id"],
            case_id=value["case_id"],
            current_stage=ExecutionStage(value["current_stage"]),
            jurisdiction=dict(value.get("jurisdiction", {})),
            jurisdiction_status=value.get("jurisdiction_status", "unknown"),
            stage_progress=tuple(
                StageProgress(
                    stage=ExecutionStage(item["stage"]),
                    required_inputs=tuple(item.get("required_inputs", ())),
                    inputs=tuple(_stage_input(row) for row in item.get("inputs", ())),
                    completed=bool(item.get("completed", False)),
                    completed_at=item.get("completed_at"),
                )
                for item in value.get("stage_progress", ())
            ),
            missing_information=tuple(
                MissingInformation(
                    id=item["id"], question=item["question"],
                    status=MissingInformationStatus(item.get("status", "open")),
                    answer=item.get("answer"), source_ids=tuple(item.get("source_ids", ())),
                    provenance_ids=tuple(item.get("provenance_ids", ())),
                    related_to=item.get("related_to"),
                )
                for item in value.get("missing_information", ())
            ),
            evidence_requests=tuple(
                EvidenceRequest(
                    id=item["id"], item=item["item"], purpose=item["purpose"],
                    status=RequestStatus(item.get("status", "not_confirmed")),
                    notes=item.get("notes"), source_ids=tuple(item.get("source_ids", ())),
                    provenance_ids=tuple(item.get("provenance_ids", ())),
                )
                for item in value.get("evidence_requests", ())
            ),
            document_requests=tuple(
                DocumentRequest(
                    id=item["id"], document=item["document"], purpose=item["purpose"],
                    status=RequestStatus(item.get("status", "not_confirmed")),
                    notes=item.get("notes"), source_ids=tuple(item.get("source_ids", ())),
                    provenance_ids=tuple(item.get("provenance_ids", ())),
                )
                for item in value.get("document_requests", ())
            ),
            user_actions=tuple(
                UserAction(
                    id=item["id"], action=item["action"], reason=item["reason"],
                    stage=ExecutionStage(item["stage"]), condition=item.get("condition"),
                    jurisdiction_required=bool(item.get("jurisdiction_required", False)),
                    status=ActionStatus(item.get("status", "proposed")),
                    completion=(
                        ActionCompletion(
                            recorded_at=item["completion"]["recorded_at"],
                            user_reported_outcome=item["completion"]["user_reported_outcome"],
                            provenance_ids=tuple(item["completion"].get("provenance_ids", ())),
                        ) if item.get("completion") else None
                    ),
                )
                for item in value.get("user_actions", ())
            ),
            procedural_next_steps=tuple(
                ProceduralNextStep(
                    id=item["id"], description=item["description"], reason=item["reason"],
                    stage=ExecutionStage(item["stage"]), condition=item.get("condition"),
                    jurisdiction_required=bool(item.get("jurisdiction_required", False)),
                )
                for item in value.get("procedural_next_steps", ())
            ),
            timeline_events=tuple(
                TimelineEvent(
                    id=item["id"], sequence=int(item["sequence"]), event_type=item["event_type"],
                    summary=item["summary"], actor=item["actor"],
                    stage=ExecutionStage(item["stage"]) if item.get("stage") else None,
                    occurred_at=item.get("occurred_at"), related_ids=tuple(item.get("related_ids", ())),
                    provenance_ids=tuple(item.get("provenance_ids", ())),
                )
                for item in value.get("timeline_events", ())
            ),
            provenance=tuple(
                ProvenanceRecord(**item) for item in value.get("provenance", ())
            ),
            uncertainties=tuple(
                Uncertainty(
                    id=item["id"], category=item["category"], description=item["description"],
                    source_ids=tuple(item.get("source_ids", ())), related_id=item.get("related_id"),
                )
                for item in value.get("uncertainties", ())
            ),
            completed_stages=tuple(ExecutionStage(item) for item in value.get("completed_stages", ())),
            blocked_stages=tuple(ExecutionStage(item) for item in value.get("blocked_stages", ())),
            blockers=tuple(
                ExecutionBlocker(
                    code=item["code"], stage=ExecutionStage(item["stage"]),
                    message=item["message"], related_id=item.get("related_id"),
                    action_id=item.get("action_id"),
                )
                for item in value.get("blockers", ())
            ),
            recorded_fact_count=int(value.get("recorded_fact_count", 0)),
            conflicts=tuple(value.get("conflicts", ())),
            assumptions=tuple(value.get("assumptions", ())),
            pending_evidence_reviews=tuple(
                PendingEvidenceReview(
                    document_id=item["document_id"],
                    evidence_id=item.get("evidence_id"),
                    filename=item["filename"],
                    source_ids=tuple(item.get("source_ids", ())),
                    provenance_ids=tuple(item.get("provenance_ids", ())),
                )
                for item in value.get("pending_evidence_reviews", ())
            ),
            safety_context=value.get("safety_context", "unknown"),
            safety_urgency=value.get("safety_urgency", "none"),
            safety_source_ids=tuple(value.get("safety_source_ids", ())),
            legal_records_available=bool(value.get("legal_records_available", False)),
            case_readiness=_case_readiness(value.get("case_readiness")),
            action_plan=tuple(_next_best_action(item) for item in value.get("action_plan", ())),
            next_best_action=_next_best_action(value.get("next_best_action")),
        )

    @classmethod
    def from_json(cls, value: str) -> JourneyExecution:
        return cls.from_dict(json.loads(value))


def _stage_input(value: dict[str, Any]) -> StageInput:
    return StageInput(
        key=value["key"], value=value.get("value"),
        source_ids=tuple(value.get("source_ids", ())),
        provenance_ids=tuple(value.get("provenance_ids", ())),
        recorded_at=value.get("recorded_at"),
    )


def _action_history(value: dict[str, Any]) -> ActionHistoryEntry:
    return ActionHistoryEntry(
        id=value["id"],
        sequence=int(value["sequence"]),
        event_type=value["event_type"],
        summary=value["summary"],
        actor=value["actor"],
        occurred_at=value.get("occurred_at"),
        related_ids=tuple(value.get("related_ids", ())),
        provenance_ids=tuple(value.get("provenance_ids", ())),
    )


def _next_best_action(value: dict[str, Any] | NextBestAction | None) -> NextBestAction | None:
    if value is None or isinstance(value, NextBestAction):
        return value
    return NextBestAction(
        id=value["id"],
        action=value["action"],
        reason=value["reason"],
        status=NextBestActionStatus(value["status"]),
        dimension=ReadinessDimensionName(value["dimension"]),
        stage=ExecutionStage(value["stage"]),
        priority=int(value["priority"]),
        source_type=value["source_type"],
        source_ids=tuple(value.get("source_ids", ())),
        dependencies=tuple(value.get("dependencies", ())),
        blocker_ids=tuple(value.get("blocker_ids", ())),
        provenance_ids=tuple(value.get("provenance_ids", ())),
        history=tuple(_action_history(item) for item in value.get("history", ())),
    )


def _case_readiness(value: dict[str, Any] | CaseReadiness | None) -> CaseReadiness | None:
    if value is None or isinstance(value, CaseReadiness):
        return value
    return CaseReadiness(
        score=int(value["score"]),
        explanation=value["explanation"],
        dimensions=tuple(
            ReadinessDimension(
                name=ReadinessDimensionName(item["name"]),
                score=int(item["score"]),
                level=ReadinessLevel(item["level"]),
                explanation=item["explanation"],
                blocker_ids=tuple(item.get("blocker_ids", ())),
                source_ids=tuple(item.get("source_ids", ())),
            )
            for item in value.get("dimensions", ())
        ),
        blockers=tuple(
            ReadinessBlocker(
                id=item["id"],
                code=item["code"],
                dimension=ReadinessDimensionName(item["dimension"]),
                message=item["message"],
                severity=item.get("severity", "attention"),
                related_ids=tuple(item.get("related_ids", ())),
                source_ids=tuple(item.get("source_ids", ())),
                provenance_ids=tuple(item.get("provenance_ids", ())),
            )
            for item in value.get("blockers", ())
        ),
    )


def _json_value(value: Any) -> Any:
    if isinstance(value, StrEnum):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json_value(item) for item in value]
    return value
