"""Build a deterministic local LegalTwin from the canonical CaseState model."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any

from app.schemas.case_state import (
    CaseClaim,
    CaseEvent,
    CaseFact,
    CaseState,
    EvidenceItem,
)
from app.engines.legal_twin.models import (
    EdgeType,
    InformationStatus,
    LegalTwin,
    NodeType,
    TimelineEvent,
    TwinEdge,
    TwinNode,
    TwinProvenance,
    normalize_datetime,
)


def _value(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(key): _value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_value(item) for item in value]
    return value


def _status(value: str | InformationStatus | None) -> str:
    if value is None:
        return InformationStatus.UNKNOWN.value
    return str(value.value if isinstance(value, InformationStatus) else value)


def _case_provenance(
    case_state: CaseState,
    path: str,
    status: str,
    *,
    details: str | None = None,
) -> TwinProvenance:
    return TwinProvenance(
        source_id=case_state.id,
        source_type="case_state",
        source_path=path,
        status=status,
        details=details,
    )


def _evidence_provenance(
    item: EvidenceItem,
    *,
    path: str | None = None,
) -> TwinProvenance:
    return TwinProvenance(
        source_id=item.id,
        source_type=item.source,
        source_path=path or f"evidence/{item.id}",
        status=_status(item.status),
        details=item.title,
    )


def _sources_provenance(
    source_ids: Iterable[str],
    evidence_by_id: dict[str, EvidenceItem],
    case_state: CaseState,
    path: str,
    status: str,
) -> tuple[TwinProvenance, ...]:
    sources: list[TwinProvenance] = []

    for source_id in source_ids:
        item = evidence_by_id.get(source_id)

        if item is not None:
            sources.append(_evidence_provenance(item))
        else:
            sources.append(
                TwinProvenance(
                    source_id=source_id,
                    source_type="unknown",
                    source_path=path,
                    status=status,
                    details=(
                        "The source id is recorded, but its evidence item "
                        "is absent from this CaseState."
                    ),
                )
            )

    if not sources:
        sources.append(
            _case_provenance(
                case_state,
                path,
                status,
                details=(
                    "The CaseState does not provide a more specific source."
                ),
            )
        )

    return tuple(sources)


def _recorded_at_for_sources(
    source_ids: Iterable[str],
    evidence_by_id: dict[str, EvidenceItem],
    document_times: dict[str, datetime],
    fallback: datetime | None,
) -> datetime | None:
    times: list[datetime] = []

    for source_id in source_ids:
        item = evidence_by_id.get(source_id)

        if item is None:
            continue

        document_id = item.documentId

        if document_id and document_id in document_times:
            times.append(document_times[document_id])

    return min(times) if times else fallback


def _event_status(
    event: CaseEvent,
    evidence_by_id: dict[str, EvidenceItem],
) -> str:
    statuses = {
        _status(evidence_by_id[source_id].status)
        for source_id in event.evidenceIds
        if source_id in evidence_by_id
    }

    if len(statuses) == 1:
        return next(iter(statuses))

    return InformationStatus.UNKNOWN.value


def _exact_event_time(event: CaseEvent) -> datetime | None:
    if event.datePrecision != "exact":
        return None

    return normalize_datetime(event.date)


def _record_attr(record: Any, *names: str, default: Any = None) -> Any:
    """Read a field defensively across compatible legal-knowledge models."""
    for name in names:
        value = getattr(record, name, None)
        if value is not None:
            return value

    return default


def _record_type(record: Any) -> str:
    value = _record_attr(record, "type", "record_type", default="")
    return str(value or "").strip().lower()


def _record_status(record: Any) -> str:
    value = _record_attr(
        record,
        "status",
        "verification_status",
        "knowledge_status",
        default="",
    )
    return str(value or "").strip().lower()


def _record_references(record: Any) -> tuple[Any, ...]:
    value = _record_attr(record, "provenance", "references", "sources", default=())
    if value is None:
        return ()
    if isinstance(value, (list, tuple)):
        return tuple(value)
    return (value,)


def _record_provision(record: Any) -> str | None:
    """Return an explicitly supplied provision/section label, if available."""
    value = _record_attr(
        record,
        "provision",
        "provision_name",
        "provisionName",
        "section",
        "section_name",
        "sectionName",
        "section_number",
        "sectionNumber",
        "reference",
        "citation",
        "legal_provision",
        default=None,
    )

    if value is None:
        return None

    text = str(value).strip()
    return text or None


def _record_applicability(record: Any) -> str:
    """Do not infer applicability; expose only explicitly supplied state."""
    value = _record_attr(
        record,
        "applicability",
        "applicability_status",
        "applicabilityStatus",
        "legal_applicability",
        default=None,
    )

    if value is None:
        return "not_established"

    text = str(value).strip()
    return text or "not_established"


def _record_issue_ids(record: Any) -> tuple[str, ...]:
    """Return explicit issue links only; never invent issue relationships."""
    value = _record_attr(
        record,
        "legal_issue_ids",
        "legalIssueIds",
        "issue_ids",
        "issueIds",
        "related_issue_ids",
        "relatedIssueIds",
        "related_legal_issue_ids",
        "relatedLegalIssueIds",
        default=(),
    )

    if value is None:
        return ()

    if isinstance(value, str):
        return (value,) if value.strip() else ()

    if isinstance(value, (list, tuple, set, frozenset)):
        result: list[str] = []

        for item in value:
            text = str(item).strip()

            if text:
                result.append(text)

        return tuple(result)

    return ()


def _record_first_source(
    record: Any,
) -> tuple[str | None, str | None, str | None]:
    """
    Return source id, source type, and source path from the first supplied
    legal-knowledge reference where available.
    """
    references = _record_references(record)

    for reference in references:
        source_id = _record_attr(
            reference,
            "source_id",
            "sourceId",
            "authority_id",
            "authorityId",
            default=None,
        )

        source_type = _record_attr(
            reference,
            "source_type",
            "sourceType",
            "type",
            default=None,
        )

        source_url = _record_attr(
            reference,
            "source_url",
            "sourceUrl",
            "url",
            default=None,
        )

        if source_id or source_type or source_url:
            return (
                str(source_id) if source_id is not None else None,
                str(source_type) if source_type is not None else None,
                str(source_url) if source_url is not None else None,
            )

    return None, None, None


def _legal_record_status(record: Any) -> str:
    """
    Map knowledge status conservatively into Twin information status.
    """
    status = _record_status(record)

    if status in {
        "verified",
        "evidence_supported",
        "source_verified",
        "authoritative",
    }:
        return InformationStatus.EVIDENCE_SUPPORTED.value

    if status in {
        "conflicting",
        "conflict",
    }:
        return InformationStatus.CONFLICTING.value

    if status in {
        "assumption",
        "assumed",
    }:
        return InformationStatus.ASSUMPTION.value

    if status in {
        "unknown",
        "unverified",
        "verification_required",
        "not_verified",
        "unavailable",
        "not_established",
        "",
    }:
        return InformationStatus.UNKNOWN.value

    return InformationStatus.SYSTEM_INFERRED.value


def _legal_reference_provenance(
    record: Any,
    *,
    record_id: str,
    fallback_status: str,
) -> tuple[TwinProvenance, ...]:
    """
    Convert legal-knowledge source references into Twin provenance while
    preserving source identity, section references and retrieval metadata.
    """
    references = _record_references(record)
    result: list[TwinProvenance] = []

    for reference in references:
        source_id = _record_attr(
            reference,
            "source_id",
            "sourceId",
            default=None,
        )
        source_type = _record_attr(
            reference,
            "source_type",
            "sourceType",
            default="legal_knowledge_source",
        )
        source_url = _record_attr(
            reference,
            "source_url",
            "sourceUrl",
            "url",
            default=None,
        )
        page_section_reference = _record_attr(
            reference,
            "page_section_reference",
            "pageSectionReference",
            "section_reference",
            "sectionReference",
            default=None,
        )
        retrieval_time = _record_attr(
            reference,
            "retrieval_time",
            "retrievalTime",
            default=None,
        )
        confidence = _record_attr(
            reference,
            "confidence",
            default=None,
        )

        if source_id is None:
            source_id = record_id

        source_id = str(source_id)

        path = f"legalKnowledge/{record_id}/sources/{source_id}"

        if page_section_reference:
            path = f"{path}/{page_section_reference}"

        details_parts = []

        if source_url:
            details_parts.append(str(source_url))

        if page_section_reference:
            details_parts.append(
                f"Reference: {page_section_reference}"
            )

        result.append(
            TwinProvenance(
                source_id=source_id,
                source_type=str(source_type or "legal_knowledge_source"),
                source_path=path,
                status=fallback_status,
                confidence=(
                    float(confidence)
                    if isinstance(confidence, (int, float))
                    else None
                ),
                details="; ".join(details_parts) or None,
            )
        )

    if result:
        return tuple(result)

    return (
        TwinProvenance(
            source_id=record_id,
            source_type="legal_knowledge",
            source_path=f"legalKnowledge/{record_id}",
            status=fallback_status,
            details=(
                "The legal-knowledge record did not provide a separate "
                "source reference."
            ),
        ),
    )


def build_legal_twin(case_state: CaseState) -> LegalTwin:
    """Create an in-memory graph, retaining recorded source status and links.

    Verified procedure and authority records are projected when the current
    CaseState analysis supplies them. Legal grounding metadata is exposed in a
    frontend-compatible form without asserting applicability that the source
    record does not itself establish.
    """

    if not isinstance(case_state, CaseState):
        raise TypeError(
            "case_state must be an app.schemas.case_state.CaseState"
        )

    created_at = normalize_datetime(case_state.metadata.createdAt)
    captured_at = normalize_datetime(case_state.metadata.updatedAt)

    evidence_by_id = {
        item.id: item for item in case_state.evidence
    }

    document_by_id = {
        item.id: item for item in case_state.documents
    }

    document_times = {
        document.id: timestamp
        for document in case_state.documents
        if (
            timestamp := normalize_datetime(
                document.processingTimestamp
            )
        )
        is not None
    }

    context = {
        "title": case_state.title,
        "initial_statement": case_state.initialStatement,
        "jurisdiction": _value(case_state.jurisdiction),
        "intent": (
            _value(case_state.intent)
            if case_state.intent is not None
            else None
        ),
        "language": case_state.metadata.language,
        "unknowns": list(case_state.unknowns),
        "assumptions": list(case_state.assumptions),
        "conflicts": list(case_state.conflicts),
        "created_at": case_state.metadata.createdAt,
        "updated_at": case_state.metadata.updatedAt,
    }

    context_recorded_at = {
        "title": created_at,
        "initial_statement": created_at,
        "language": created_at,
        "created_at": created_at,
        "jurisdiction": captured_at,
        "intent": captured_at,
        "unknowns": captured_at,
        "assumptions": captured_at,
        "conflicts": captured_at,
        "updated_at": captured_at,
    }

    twin = LegalTwin(
        case_id=case_state.id,
        context=context,
        context_recorded_at=context_recorded_at,
        captured_at=captured_at,
    )

    party_nodes: dict[str, str] = {}
    event_nodes: dict[str, str] = {}
    claim_nodes: dict[str, str] = {}
    evidence_nodes: dict[str, str] = {}
    document_nodes: dict[str, str] = {}
    legal_issue_nodes: dict[str, str] = {}
    legal_knowledge_node_ids: dict[str, str] = {}
    law_match_by_candidate: dict[str, Any] = {}
    if case_state.analysis is not None and case_state.analysis.legal_knowledge is not None:
        law_match_by_candidate = {
            str(_record_attr(match, "candidate_id", "candidateId", default="")): match
            for match in case_state.analysis.legal_knowledge.law_matches
            if _record_attr(match, "candidate_id", "candidateId", default=None)
        }

    timeline: list[TimelineEvent] = []

    person = case_state.person

    twin.add_node(
        TwinNode(
            id=f"person:{case_state.id}",
            kind=NodeType.PERSON,
            label=person.name or "Person not identified",
            status=InformationStatus.UNKNOWN.value,
            provenance=(
                _case_provenance(
                    case_state,
                    "person",
                    InformationStatus.UNKNOWN.value,
                    details=(
                        "Person is not identified in the current CaseState."
                        if not (person.name or person.contact)
                        else (
                            "Person identity is recorded in the CaseState; "
                            "field-level provenance is unavailable."
                        )
                    ),
                ),
            ),
            properties={"contact": person.contact},
        )
    )

    for party in case_state.parties:
        node_id = f"party:{party.id}"

        twin.add_node(
            TwinNode(
                id=node_id,
                kind=NodeType.PARTY,
                label=party.name or f"Unnamed {party.role}",
                status=InformationStatus.UNKNOWN.value,
                provenance=(
                    _case_provenance(
                        case_state,
                        f"parties/{party.id}",
                        InformationStatus.UNKNOWN.value,
                        details=(
                            "Party has no field-level provenance or status "
                            "in CaseState."
                        ),
                    ),
                ),
                properties={
                    "role": party.role,
                    "relationship": party.relationship,
                    "attributes": party.attributes,
                },
            )
        )

        party_nodes[party.id] = node_id

    for document in case_state.documents:
        node_id = f"document:{document.id}"
        processing_time = normalize_datetime(
            document.processingTimestamp
        )

        provenance = (
            _case_provenance(
                case_state,
                f"documents/{document.id}",
                InformationStatus.EVIDENCE_SUPPORTED.value,
                details=(
                    "Document metadata is recorded in CaseState; "
                    "processing status is not a legal finding."
                ),
            ),
        )

        twin.add_node(
            TwinNode(
                id=node_id,
                kind=NodeType.DOCUMENT,
                label=document.filename,
                status=InformationStatus.EVIDENCE_SUPPORTED.value,
                provenance=provenance,
                properties={
                    "mime_type": document.mimeType,
                    "extension": document.extension,
                    "file_size": document.fileSize,
                    "sha256": document.sha256,
                    "page_count": document.pageCount,
                    "processing_status": document.processingStatus,
                    "review_status": document.reviewStatus,
                    "confirmation_history": [
                        _value(item)
                        for item in document.confirmationHistory
                    ],
                    "classification": document.classification,
                    "classification_confidence": (
                        document.classificationConfidence
                    ),
                    "pages": [
                        _value(page)
                        for page in document.pages
                    ],
                    "errors": list(document.errors),
                },
                recorded_at=processing_time,
            )
        )

        document_nodes[document.id] = node_id

        if document.processingTimestamp:
            timeline.append(
                TimelineEvent(
                    id=f"document-recorded:{document.id}",
                    kind="document_recorded",
                    summary=(
                        f"Document record processed: "
                        f"{document.filename}"
                    ),
                    occurred_at=processing_time,
                    date_value=document.processingTimestamp,
                    date_precision=(
                        "exact" if processing_time else "unknown"
                    ),
                    related_node_ids=(node_id,),
                    status=InformationStatus.EVIDENCE_SUPPORTED.value,
                    provenance=provenance,
                )
            )

    if case_state.analysis is not None:
        for path in case_state.analysis.journey.possible_paths:
            node_id = f"procedure:journey:{path.id}"

            provenance = (
                _case_provenance(
                    case_state,
                    f"analysis/journey/possiblePaths/{path.id}",
                    InformationStatus.UNKNOWN.value,
                    details=(
                        "This is a journey process option marked "
                        "verification_required. No verified procedure or "
                        "competent authority is attached."
                    ),
                ),
            )

            twin.add_node(
                TwinNode(
                    id=node_id,
                    kind=NodeType.PROCEDURE,
                    label=path.label,
                    status=InformationStatus.UNKNOWN.value,
                    provenance=provenance,
                    properties={
                        "record_type": "journey_possible_path",
                        "description": path.description,
                        "verification_status": path.status,
                        "jurisdiction_required": path.jurisdiction_required,
                        "legal_grounding": False,
                    },
                    recorded_at=captured_at,
                )
            )

            timeline.append(
                TimelineEvent(
                    id=f"journey-procedure-option:{path.id}",
                    kind="journey_procedure_option",
                    summary=path.label,
                    occurred_at=captured_at,
                    date_value=(
                        captured_at.isoformat()
                        if captured_at
                        else None
                    ),
                    date_precision=(
                        "exact" if captured_at else "unknown"
                    ),
                    related_node_ids=(node_id,),
                    status=InformationStatus.UNKNOWN.value,
                    provenance=provenance,
                )
            )

        for action in case_state.analysis.journey.next_actions:
            node_id = f"action:{action.id}"

            provenance = (
                _case_provenance(
                    case_state,
                    f"analysis/journey/nextActions/{action.id}",
                    InformationStatus.SYSTEM_INFERRED.value,
                    details=action.reason,
                ),
            )

            twin.add_node(
                TwinNode(
                    id=node_id,
                    kind=NodeType.ACTION,
                    label=action.action,
                    status=InformationStatus.SYSTEM_INFERRED.value,
                    provenance=provenance,
                    properties={
                        "reason": action.reason,
                        "stage": action.stage,
                        "condition": action.condition,
                        "completed": False,
                        "readiness_status": "not_assessed",
                        "readiness_basis": "No explicit prerequisite records are attached to this action.",
                    },
                    recorded_at=captured_at,
                )
            )

            timeline.append(
                TimelineEvent(
                    id=f"journey-action:{action.id}",
                    kind="journey_action",
                    summary=action.action,
                    occurred_at=captured_at,
                    date_value=(
                        captured_at.isoformat()
                        if captured_at
                        else None
                    ),
                    date_precision=(
                        "exact" if captured_at else "unknown"
                    ),
                    related_node_ids=(node_id,),
                    status=InformationStatus.SYSTEM_INFERRED.value,
                    provenance=provenance,
                )
            )

        decision = case_state.analysis.decision_scenario

        if decision is not None and decision.next_action.strip():
            actions = case_state.analysis.journey.next_actions

            if not any(
                item.action.strip() == decision.next_action.strip()
                for item in actions
            ):
                node_id = (
                    f"action:decision-scenario:{case_state.id}"
                )

                provenance = (
                    _case_provenance(
                        case_state,
                        "analysis/decisionScenario/nextAction",
                        InformationStatus.SYSTEM_INFERRED.value,
                        details=decision.next_action_reason,
                    ),
                )

                twin.add_node(
                    TwinNode(
                        id=node_id,
                        kind=NodeType.ACTION,
                        label=decision.next_action,
                        status=InformationStatus.SYSTEM_INFERRED.value,
                        provenance=provenance,
                        properties={
                            "reason": decision.next_action_reason,
                            "stage": "NEXT_STEP",
                            "condition": None,
                            "completed": False,
                            "readiness_status": "not_assessed",
                            "readiness_basis": "No explicit prerequisite records are attached to this action.",
                        },
                        recorded_at=captured_at,
                    )
                )

                timeline.append(
                    TimelineEvent(
                        id=f"decision-action:{case_state.id}",
                        kind="journey_action",
                        summary=decision.next_action,
                        occurred_at=captured_at,
                        date_value=(
                            captured_at.isoformat()
                            if captured_at
                            else None
                        ),
                        date_precision=(
                            "exact" if captured_at else "unknown"
                        ),
                        related_node_ids=(node_id,),
                        status=InformationStatus.SYSTEM_INFERRED.value,
                        provenance=provenance,
                    )
                )

    for item in case_state.evidence:
        node_id = f"evidence:{item.id}"
        document_time = document_times.get(item.documentId or "")
        provenance = (_evidence_provenance(item),)

        twin.add_node(
            TwinNode(
                id=node_id,
                kind=NodeType.EVIDENCE,
                label=item.title,
                status=_status(item.status),
                provenance=provenance,
                properties={
                    "evidence_type": item.type,
                    "source": item.source,
                    "document_id": item.documentId,
                    "extracted_facts": list(item.extractedFacts),
                    "supports_claim_ids": list(item.supportsClaimIds),
                    "conflicts_with_claim_ids": list(
                        item.conflictsWithClaimIds
                    ),
                    "processing_status": item.processingStatus,
                },
                recorded_at=document_time or created_at,
            )
        )

        evidence_nodes[item.id] = node_id

    for fact in case_state.facts:
        node_id = f"claim:fact:{fact.id}"

        fact_document_times = [
            document_times[source.documentId]
            for source in fact.provenance
            if source.documentId in document_times
        ]
        fact_confirmation_times = [
            timestamp
            for source in fact.provenance
            if source.confirmedByUser
            and (timestamp := normalize_datetime(source.confirmedAt)) is not None
        ]
        fact_recorded_at = (
            max(fact_confirmation_times)
            if fact_confirmation_times
            else min(fact_document_times)
            if fact_document_times
            else _recorded_at_for_sources(
                fact.sourceIds,
                evidence_by_id,
                document_times,
                created_at,
            )
        )

        provenance = tuple(
            TwinProvenance(
                source_id=entry.documentId,
                source_type="document",
                source_path=(
                    f"documents/{entry.documentId}/pages/"
                    f"{entry.pageNumber}"
                ),
                status=_status(entry.status),
                confidence=entry.confidence,
                page_number=entry.pageNumber,
                extraction_method=entry.extractionMethod,
                confirmed_by_user=entry.confirmedByUser,
                confirmed_at=entry.confirmedAt,
            )
            for entry in fact.provenance
        ) or _sources_provenance(
            fact.sourceIds,
            evidence_by_id,
            case_state,
            f"facts/{fact.id}",
            _status(fact.status),
        )

        twin.add_node(
            TwinNode(
                id=node_id,
                kind=NodeType.FACT,
                label=fact.key,
                status=_status(fact.status),
                provenance=provenance,
                properties={
                    "record_type": "case_fact",
                    "key": fact.key,
                    "value": _value(fact.value),
                    "confidence": fact.confidence,
                    "source_ids": list(fact.sourceIds),
                    "notes": fact.notes,
                },
                recorded_at=fact_recorded_at,
            )
        )

        timeline.append(TimelineEvent(
            id=f"fact-recorded:{fact.id}",
            kind="fact_recorded",
            summary=f"Fact recorded: {fact.key}",
            occurred_at=fact_recorded_at,
            date_value=fact_recorded_at.isoformat() if fact_recorded_at else None,
            date_precision="exact" if fact_recorded_at else "unknown",
            related_node_ids=(node_id,),
            status=_status(fact.status),
            provenance=provenance,
        ))

        claim_nodes[fact.id] = node_id

    for claim in case_state.claims:
        node_id = f"claim:{claim.id}"
        claim_recorded_at = _recorded_at_for_sources(
            claim.evidenceIds,
            evidence_by_id,
            document_times,
            created_at,
        )
        claim_provenance = _sources_provenance(
            claim.evidenceIds,
            evidence_by_id,
            case_state,
            f"claims/{claim.id}",
            _status(claim.status),
        )

        twin.add_node(
            TwinNode(
                id=node_id,
                kind=NodeType.CLAIM,
                label=claim.text,
                status=_status(claim.status),
                provenance=claim_provenance,
                properties={
                    "record_type": "case_claim",
                    "evidence_ids": list(claim.evidenceIds),
                },
                recorded_at=claim_recorded_at,
            )
        )

        timeline.append(TimelineEvent(
            id=f"claim-recorded:{claim.id}",
            kind="claim_recorded",
            summary=f"Claim recorded: {claim.text}",
            occurred_at=claim_recorded_at,
            date_value=claim_recorded_at.isoformat() if claim_recorded_at else None,
            date_precision="exact" if claim_recorded_at else "unknown",
            related_node_ids=(node_id,),
            status=_status(claim.status),
            provenance=claim_provenance,
        ))

        claim_nodes[claim.id] = node_id

    for event in case_state.events:
        node_id = f"event:{event.id}"
        status = _event_status(event, evidence_by_id)
        provenance = _sources_provenance(
            event.evidenceIds,
            evidence_by_id,
            case_state,
            f"events/{event.id}",
            status,
        )
        occurred_at = _exact_event_time(event)

        twin.add_node(
            TwinNode(
                id=node_id,
                kind=NodeType.EVENT,
                label=event.description,
                status=status,
                provenance=provenance,
                properties={
                    "event_type": event.type,
                    "date_value": event.date,
                    "date_precision": event.datePrecision,
                    "party_ids": list(event.partyIds),
                    "evidence_ids": list(event.evidenceIds),
                },
                occurred_at=occurred_at,
                recorded_at=_recorded_at_for_sources(
                    event.evidenceIds,
                    evidence_by_id,
                    document_times,
                    created_at,
                ),
            )
        )

        event_nodes[event.id] = node_id

        timeline.append(
            TimelineEvent(
                id=event.id,
                kind=event.type,
                summary=event.description,
                occurred_at=normalize_datetime(event.date),
                date_value=event.date,
                date_precision=event.datePrecision,
                related_node_ids=(
                    node_id,
                    *tuple(
                        f"party:{party_id}"
                        for party_id in event.partyIds
                        if f"party:{party_id}" in twin.nodes
                    ),
                ),
                status=status,
                provenance=provenance,
            )
        )

    for issue in case_state.legalIssues:
        node_id = f"legal_issue:{issue.id}"

        twin.add_node(
            TwinNode(
                id=node_id,
                kind=NodeType.LEGAL_ISSUE,
                label=issue.subcategory or issue.category,
                status=InformationStatus.SYSTEM_INFERRED.value,
                provenance=(
                    _case_provenance(
                        case_state,
                        f"legalIssues/{issue.id}",
                        InformationStatus.SYSTEM_INFERRED.value,
                        details=(
                            "Issue category and rationale are recorded as "
                            "preliminary system classification."
                        ),
                    ),
                ),
                properties={
                    "category": issue.category,
                    "subcategory": issue.subcategory,
                    "confidence": issue.confidence,
                    "rationale": list(issue.rationale),
                },
                recorded_at=captured_at,
            )
        )

        legal_issue_nodes[issue.id] = node_id

    # ------------------------------------------------------------------
    # LEGAL KNOWLEDGE → LEGAL TWIN
    # ------------------------------------------------------------------

    if case_state.analysis is not None:
        for record in case_state.analysis.legal_knowledge.records:
            record_type = _record_type(record)

            if record_type not in {
                "authority",
                "legal_procedure",
                "procedure",
                "legal_authority",
                "legal_document",
                "legal_provision",
                "legal_rule",
                "law",
            }:
                continue

            kind = (
                NodeType.AUTHORITY
                if record_type in {
                    "authority",
                    "legal_authority",
                }
                else NodeType.PROCEDURE
                if record_type in {"legal_procedure", "procedure"}
                else NodeType.LAW
            )

            record_status = _record_status(record)
            status = _legal_record_status(record)

            references = _record_references(record)
            first_source_id, first_source_type, first_source_url = (
                _record_first_source(record)
            )

            source_id = first_source_id or str(
                _record_attr(
                    record,
                    "source_id",
                    "sourceId",
                    default=record.id,
                )
            )

            source_url = _record_attr(
                record,
                "source_url",
                "sourceUrl",
                default=first_source_url,
            )

            jurisdiction = _record_attr(
                record,
                "jurisdiction",
                "jurisdiction_name",
                "jurisdictionName",
                default=None,
            )

            authority_id = _record_attr(
                record,
                "authority",
                "authority_id",
                "authorityId",
                default=None,
            )

            version = _record_attr(
                record,
                "version",
                "version_id",
                "versionId",
                default=None,
            )

            provision = _record_provision(record)
            applicability = _record_applicability(record)
            source_verification_status = _record_attr(
                record,
                "source_verification_status",
                "sourceVerificationStatus",
                default=None,
            )
            source_freshness_status = _record_attr(
                record,
                "source_freshness_status",
                "sourceFreshnessStatus",
                default=None,
            )
            source_applicability_status = _record_attr(
                record,
                "source_applicability_status",
                "sourceApplicabilityStatus",
                default=None,
            )

            provenance = _legal_reference_provenance(
                record,
                record_id=record.id,
                fallback_status=status,
            )

            retrieval_times = [
                retrieval_time
                for reference in references
                if (
                    retrieval_time := normalize_datetime(
                        _record_attr(
                            reference,
                            "retrieval_time",
                            "retrievalTime",
                            default=None,
                        )
                    )
                )
                is not None
            ]

            recorded_at = (
                min(retrieval_times)
                if retrieval_times
                else None
            )

            node_id = f"{kind.value.casefold()}:{record.id}"

            properties = {
                "record_id": record.id,
                "record_type": record_type,
                "knowledge_status": record_status,
                "verification_status": record_status or "not_established",
                "authority_id": authority_id,
                "jurisdiction": jurisdiction,
                "source": _record_attr(
                    record,
                    "source",
                    "source_name",
                    "sourceName",
                    default=None,
                ),
                "source_url": source_url,
                "source_type": (
                    first_source_type
                    or _record_attr(
                        record,
                        "source_type",
                        "sourceType",
                        default="legal_knowledge",
                    )
                ),
                "source_id": source_id,
                "source_path": provenance[0].source_path,
                "version": version,
                "provision": provision,
                "applicability": applicability,
                "applicability_status": applicability,
                "source_verification_status": source_verification_status or "unverified",
                "source_freshness_status": source_freshness_status or "unknown",
                "source_applicability_status": (
                    source_applicability_status or "applicability_not_established"
                ),
            }

            candidate_match = law_match_by_candidate.get(record.id)
            if candidate_match is not None:
                properties["law_candidate_match"] = _value(candidate_match)
                properties["applicability"] = "candidate_only"
                properties["source_applicability_status"] = "applicability_not_established"

            # Preserve useful model-specific fields without making the Twin
            # depend on one particular Legal Knowledge schema.
            for field_name in (
                "title",
                "description",
                "summary",
                "citation",
                "effective_date",
                "effectiveDate",
                "publication_date",
                "publicationDate",
                "scope",
                "category",
                "subtype",
                "text",
                "rule_text",
                "provision_id",
                "document_id",
                "effective_to",
            ):
                value = _record_attr(
                    record,
                    field_name,
                    default=None,
                )

                if value is not None:
                    properties[field_name] = _value(value)

            twin.add_node(
                TwinNode(
                    id=node_id,
                    kind=kind,
                    label=str(
                        _record_attr(
                            record,
                            "title",
                            default=record.id,
                        )
                    ),
                    status=status,
                    provenance=provenance,
                    properties=properties,
                    recorded_at=recorded_at,
                )
            )

            legal_knowledge_node_ids[record.id] = node_id

            timeline.append(
                TimelineEvent(
                    id=f"legal-knowledge-recorded:{record.id}",
                    kind="legal_knowledge_recorded",
                    summary=(
                        "Legal knowledge record available: "
                        f"{record.title}"
                    ),
                    occurred_at=recorded_at,
                    date_value=(
                        recorded_at.isoformat()
                        if recorded_at
                        else None
                    ),
                    date_precision=(
                        "exact" if recorded_at else "unknown"
                    ),
                    related_node_ids=(node_id,),
                    status=status,
                    provenance=provenance,
                )
            )

    # ------------------------------------------------------------------
    # UNKNOWN / ASSUMPTION / CONFLICT RECORDS
    # ------------------------------------------------------------------

    for record_type, values, status in (
        (
            "unknown",
            case_state.unknowns,
            InformationStatus.UNKNOWN.value,
        ),
        (
            "assumption",
            case_state.assumptions,
            InformationStatus.ASSUMPTION.value,
        ),
        (
            "conflict",
            case_state.conflicts,
            InformationStatus.CONFLICTING.value,
        ),
    ):
        for text in values:
            digest = sha256(
                text.casefold().encode("utf-8")
            ).hexdigest()[:16]

            node_id = f"claim:{record_type}:{digest}"

            twin.add_node(
                TwinNode(
                    id=node_id,
                    kind=NodeType.CLAIM,
                    label=text,
                    status=status,
                    provenance=(
                        _case_provenance(
                            case_state,
                            f"{record_type}s/{digest}",
                            status,
                            details=(
                                f"Recorded CaseState {record_type} entry; "
                                "no answer or resolution is inferred."
                            ),
                        ),
                    ),
                    properties={
                        "record_type": record_type,
                        "text": text,
                    },
                    recorded_at=captured_at,
                )
            )

            claim_nodes[node_id] = node_id

    def add_relation(
        source: str,
        target: str,
        relation: EdgeType,
        status: str,
        provenance: tuple[TwinProvenance, ...],
        recorded_at: datetime | None = None,
    ) -> None:
        if source in twin.nodes and target in twin.nodes:
            twin.add_edge(
                TwinEdge(
                    source_id=source,
                    target_id=target,
                    kind=relation,
                    status=status,
                    provenance=provenance,
                    recorded_at=recorded_at,
                )
            )

    # Decision-path steps carry the analysis' explicit material prerequisites.
    # Keep their readiness limited to recorded inputs; a recorded input does
    # not establish legal entitlement or predict an outcome.
    if case_state.analysis is not None and case_state.analysis.decision_scenario is not None:
        decision = case_state.analysis.decision_scenario
        evidence_requirements = {item.id: item for item in decision.required_evidence}
        document_requirements = {item.id: item for item in decision.required_documents}
        availability_by_id = {
            **{key: item.availability for key, item in evidence_requirements.items()},
            **{key: item.availability for key, item in document_requirements.items()},
        }

        for path in decision.paths:
            for step in path.steps:
                node_id = f"action:path-step:{step.id}"
                requirement_ids = tuple(dict.fromkeys(
                    step.related_requirement_ids
                    or (*path.required_evidence_ids, *path.required_document_ids)
                ))
                requirements = [
                    {
                        "id": requirement_id,
                        "availability": availability_by_id.get(requirement_id, "not_confirmed"),
                        "type": (
                            "evidence"
                            if requirement_id in evidence_requirements
                            else "document"
                            if requirement_id in document_requirements
                            else "unspecified"
                        ),
                    }
                    for requirement_id in requirement_ids
                ]
                readiness_status = (
                    "not_assessed"
                    if not requirements
                    else "inputs_recorded"
                    if all(item["availability"] == "recorded_in_case_state" for item in requirements)
                    else "inputs_missing"
                )
                provenance = (_case_provenance(
                    case_state,
                    f"analysis/decisionScenario/paths/{path.id}/steps/{step.id}",
                    InformationStatus.SYSTEM_INFERRED.value,
                    details=step.reason,
                ),)
                twin.add_node(TwinNode(
                    id=node_id,
                    kind=NodeType.ACTION,
                    label=step.action,
                    status=InformationStatus.SYSTEM_INFERRED.value,
                    provenance=provenance,
                    properties={
                        "record_type": "decision_path_step",
                        "path_id": path.id,
                        "reason": step.reason,
                        "stage": "OPTIONS",
                        "procedural_status": step.status,
                        "readiness_status": readiness_status,
                        "readiness_basis": "Recorded evidence and document availability only; not legal readiness or outcome.",
                        "required_evidence_ids": list(path.required_evidence_ids),
                        "required_document_ids": list(path.required_document_ids),
                        "blocking_condition_ids": list(path.blocking_condition_ids),
                        "related_requirement_ids": list(requirement_ids),
                        "requirements": requirements,
                        "completed": False,
                    },
                    recorded_at=captured_at,
                ))
                timeline.append(TimelineEvent(
                    id=f"decision-path-step:{step.id}",
                    kind="decision_path_step",
                    summary=step.action,
                    occurred_at=captured_at,
                    date_value=captured_at.isoformat() if captured_at else None,
                    date_precision="exact" if captured_at else "unknown",
                    related_node_ids=(node_id,),
                    status=InformationStatus.SYSTEM_INFERRED.value,
                    provenance=provenance,
                ))

                for requirement_id in requirement_ids:
                    target = (
                        evidence_nodes.get(requirement_id)
                        or document_nodes.get(requirement_id)
                        or (requirement_id if requirement_id in twin.nodes else None)
                    )
                    if target:
                        add_relation(
                            node_id,
                            target,
                            EdgeType.DEPENDS_ON,
                            InformationStatus.SYSTEM_INFERRED.value,
                            (_case_provenance(
                                case_state,
                                f"analysis/decisionScenario/paths/{path.id}/steps/{step.id}/requirements/{requirement_id}",
                                InformationStatus.SYSTEM_INFERRED.value,
                                details="Explicit path-step prerequisite linked to a CaseState record.",
                            ),),
                            captured_at,
                        )

    # ------------------------------------------------------------------
    # CASE RELATIONSHIPS
    # ------------------------------------------------------------------

    for event in case_state.events:
        event_node = event_nodes[event.id]
        event_status = twin.nodes[event_node].status
        event_provenance = twin.nodes[event_node].provenance

        for party_id in event.partyIds:
            add_relation(
                event_node,
                party_nodes.get(party_id, ""),
                EdgeType.INVOLVES,
                event_status,
                event_provenance,
            )

        for evidence_id in event.evidenceIds:
            evidence_node = evidence_nodes.get(evidence_id, "")

            add_relation(
                event_node,
                evidence_node,
                EdgeType.REFERENCES,
                event_status,
                event_provenance,
            )

    for item in case_state.evidence:
        evidence_node = evidence_nodes[item.id]
        evidence_record = twin.nodes[evidence_node]

        if item.documentId:
            add_relation(
                evidence_node,
                document_nodes.get(item.documentId, ""),
                EdgeType.REFERENCES,
                _status(item.status),
                (_evidence_provenance(item),),
                evidence_record.recorded_at,
            )

        for claim_id in item.supportsClaimIds:
            target = claim_nodes.get(claim_id)

            if target:
                add_relation(
                    evidence_node,
                    target,
                    EdgeType.SUPPORTS,
                    _status(item.status),
                    (_evidence_provenance(item),),
                    evidence_record.recorded_at,
                )

        for claim_id in item.conflictsWithClaimIds:
            target = claim_nodes.get(claim_id)

            if target:
                add_relation(
                    evidence_node,
                    target,
                    EdgeType.CONTRADICTS,
                    _status(item.status),
                    (_evidence_provenance(item),),
                    evidence_record.recorded_at,
                )

        for fact_id in item.extractedFacts:
            target = claim_nodes.get(fact_id)

            if target:
                add_relation(
                    evidence_node,
                    target,
                    EdgeType.SUPPORTS,
                    _status(item.status),
                    (_evidence_provenance(item),),
                    evidence_record.recorded_at,
                )

    for fact in case_state.facts:
        fact_node = claim_nodes[fact.id]

        for source in fact.provenance:
            document_node = document_nodes.get(source.documentId)

            if document_node:
                provenance = TwinProvenance(
                    source_id=source.documentId,
                    source_type="document",
                    source_path=(
                        f"documents/{source.documentId}/pages/"
                        f"{source.pageNumber}"
                    ),
                    status=_status(source.status),
                    confidence=source.confidence,
                    page_number=source.pageNumber,
                    extraction_method=source.extractionMethod,
                    confirmed_by_user=source.confirmedByUser,
                    confirmed_at=source.confirmedAt,
                )

                add_relation(
                    document_node,
                    fact_node,
                    EdgeType.SUPPORTS,
                    _status(source.status),
                    (provenance,),
                )

    for claim in case_state.claims:
        target = claim_nodes[claim.id]

        for evidence_id in claim.evidenceIds:
            evidence_node = evidence_nodes.get(evidence_id)

            if evidence_node:
                source = twin.nodes[evidence_node]

                add_relation(
                    evidence_node,
                    target,
                    EdgeType.SUPPORTS,
                    source.status,
                    source.provenance,
                    source.recorded_at,
                )

    # ------------------------------------------------------------------
    # LEGAL KNOWLEDGE RELATIONSHIPS
    # ------------------------------------------------------------------

    if case_state.analysis is not None:
        for record in case_state.analysis.legal_knowledge.records:
            record_type = _record_type(record)

            legal_record_node = legal_knowledge_node_ids.get(record.id)

            # Procedure → Authority
            if record_type in {
                "legal_procedure",
                "procedure",
            }:
                authority_id = _record_attr(
                    record,
                    "authority",
                    "authority_id",
                    "authorityId",
                    default=None,
                )

                if authority_id:
                    authority_node = legal_knowledge_node_ids.get(
                        str(authority_id)
                    )

                    if authority_node and legal_record_node:
                        source_node = twin.nodes[legal_record_node]

                        add_relation(
                            legal_record_node,
                            authority_node,
                            EdgeType.PROCEDURE_AVAILABLE_AT_AUTHORITY,
                            source_node.status,
                            source_node.provenance,
                            source_node.recorded_at,
                        )

            # A rule cites only the provision ID carried on that record.
            if record_type == "legal_rule":
                provision_id = _record_attr(record, "provision_id", "provisionId", default=None)
                provision_node = legal_knowledge_node_ids.get(str(provision_id)) if provision_id else None
                if legal_record_node and provision_node:
                    source_node = twin.nodes[legal_record_node]
                    add_relation(
                        legal_record_node,
                        provision_node,
                        EdgeType.DEPENDS_ON,
                        source_node.status,
                        source_node.provenance,
                        source_node.recorded_at,
                    )

            # Explicit legal record → legal issue connections only.
            # We never connect every legal record to every issue.
            for issue_id in _record_issue_ids(record):
                candidates = (
                    issue_id,
                    f"legal_issue:{issue_id}",
                )

                issue_node = next(
                    (
                        legal_issue_nodes.get(candidate)
                        or candidate
                        if candidate in twin.nodes
                        else None
                        for candidate in candidates
                    ),
                    None,
                )

                if legal_record_node and issue_node:
                    source_node = twin.nodes[legal_record_node]

                    add_relation(
                        legal_record_node,
                        issue_node,
                        EdgeType.APPLIES_TO,
                        source_node.status,
                        source_node.provenance,
                        source_node.recorded_at,
                    )

        # The heuristic match links a provision to a recorded issue for
        # navigation only. RELATES_TO deliberately avoids asserting that the
        # candidate legally applies.
        for match in case_state.analysis.legal_knowledge.law_matches:
            candidate_id = _record_attr(match, "candidate_id", "candidateId", default=None)
            candidate_node = legal_knowledge_node_ids.get(str(candidate_id)) if candidate_id else None
            if not candidate_node:
                continue
            rationale = str(_record_attr(match, "why_it_may_apply", "whyItMayApply", default=""))
            provenance = (
                TwinProvenance(
                    source_id=case_state.id,
                    source_type="legal_match_heuristic",
                    source_path=f"analysis/legalKnowledge/lawMatches/{candidate_id}",
                    status=InformationStatus.SYSTEM_INFERRED.value,
                    details=(rationale + " Applicability is not established.").strip(),
                ),
            )
            for issue_id in _record_issue_ids(match):
                issue_node = legal_issue_nodes.get(issue_id)
                if issue_node:
                    add_relation(
                        candidate_node,
                        issue_node,
                        EdgeType.RELATES_TO,
                        InformationStatus.SYSTEM_INFERRED.value,
                        provenance,
                        captured_at,
                    )

    twin.timeline = tuple(
        sorted(
            timeline,
            key=lambda item: (
                item.occurred_at is None,
                item.occurred_at
                or datetime.max.replace(tzinfo=timezone.utc),
                item.id,
            ),
        )
    )

    return twin


# A short alias for callers that already work within the Legal Twin package.
build_twin = build_legal_twin
