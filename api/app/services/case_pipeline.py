"""Deterministic orchestration for the existing case intelligence engines.

This service composes the engines without changing their contracts. It keeps
user statements, document-derived evidence, inferences, assumptions, unknowns,
and conflicts in separate, provenance-bearing records.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, fields, is_dataclass, replace
from datetime import date, datetime
from enum import Enum
from typing import Any, Literal

from app.engines.case_state import extract_case_state
from app.engines.document_intelligence import (
    Classification,
    DocumentProcessingStatus,
    DocumentResult,
    process_document,
)
from app.engines.document_intelligence.pipeline import DocumentProcessingError
from app.engines.document_intelligence.validation import build_metadata
from app.engines.journey import Journey, build_journey
from app.engines.journey_execution import JourneyExecution, create_execution
from app.engines.legal_knowledge import search_legal_knowledge
from app.engines.legal_knowledge.matching import build_law_matches
from app.engines.legal_knowledge.models import (
    Authority,
    LegalSource,
    Jurisdiction as KnowledgeJurisdiction,
    KnowledgeItem,
    KnowledgeRelationship,
    LegalProcedure,
)
from app.engines.legal_knowledge.store import LegalKnowledgeRepository
from app.engines.legal_knowledge.seed import build_authoritative_legal_knowledge_seed
from app.engines.legal_sources import (
    GovernedLegalSource,
    RegistrySourceVersion,
    SourceApplicabilityStatus,
    SourceFreshnessStatus,
    SourceGovernanceRegistry,
    SourceVerificationStatus,
)
from app.engines.legal_reasoning import ReasoningResult, reason_about_case
from app.engines.legal_twin import TimelineEvent, TimelineSnapshot, build_legal_twin, generate_timeline, snapshot_at
from app.engines.safety_support import (
    ImmediateDangerAnswer,
    SafetyLanguage,
    SafetySupportAssessment,
    WorkflowDisposition,
    orchestrate_safety_support,
)
from app.engines.decision_simulator import DecisionScenario, simulate_decision
from app.engines.safety import detect_case_safety_context
from app.schemas.case_state import (
    CaseDocument,
    CaseDocumentPage,
    CaseFact,
    CaseState,
    EvidenceItem,
)
from app.schemas.case_analysis import (
    CaseAnalysis,
    DecisionScenarioSummary,
    JourneySummary,
    LegalKnowledgeRecordSummary,
    LegalKnowledgeSummary,
    SafetyContextSummary,
    SafetyIndicatorSummary,
    WomenSafetyContextSummary,
)
from app.services.document_service import integrate_document_evidence
from app.services.clarification import normalize_unanswered_clarification_records
from app.engines.legal_twin.models import normalize_datetime


PipelineInformationStatus = Literal[
    "user_reported",
    "evidence_supported",
    "system_inferred",
    "assumption",
    "unknown",
    "conflicting",
]


@dataclass(frozen=True, slots=True)
class CasePipelineDocument:
    """Document bytes supplied for local, in-memory pipeline processing."""

    filename: str
    content: bytes
    document_id: str | None = None


@dataclass(frozen=True, slots=True)
class CasePipelineRequest:
    """All variable inputs needed for a repeatable pipeline run.

    ``recorded_at`` is required so neither case extraction nor document
    metadata depends on the machine clock. IDs derived by the pipeline are
    stable for the same case, document order, names, and content.
    """

    case_id: str
    initial_statement: str
    recorded_at: str
    title: str | None = None
    language: str | None = None
    person_name: str | None = None
    source_id: str = "initial-statement"
    documents: tuple[CasePipelineDocument, ...] = ()
    safety_language: str | None = None
    immediate_danger: ImmediateDangerAnswer | str | None = None


@dataclass(frozen=True, slots=True)
class PipelineProvenance:
    """Stable source pointer attached to an output fact or engine finding."""

    record_id: str
    source_type: str
    source_id: str
    source_path: str
    status: str
    confidence: float | None = None
    page_number: int | None = None
    extraction_method: str | None = None
    details: str | None = None


@dataclass(frozen=True, slots=True)
class ContextRecord:
    """One case-state entry grouped by its current information status."""

    id: str
    kind: str
    text: str
    status: PipelineInformationStatus
    source_ids: tuple[str, ...] = ()
    provenance: tuple[PipelineProvenance, ...] = ()


@dataclass(frozen=True, slots=True)
class EvidenceContext:
    """Case facts and context separated by their information status."""

    user_reported: tuple[ContextRecord, ...] = ()
    evidence_supported: tuple[ContextRecord, ...] = ()
    inferred: tuple[ContextRecord, ...] = ()
    assumptions: tuple[ContextRecord, ...] = ()
    unknown: tuple[ContextRecord, ...] = ()
    conflicting: tuple[ContextRecord, ...] = ()


@dataclass(frozen=True, slots=True)
class LegalKnowledgeContext:
    """Retrieved records plus only the explicit links supplied by a store."""

    records: tuple[KnowledgeItem, ...] = ()
    relationships: tuple[KnowledgeRelationship, ...] = ()
    governed_sources: tuple[GovernedLegalSource, ...] = ()
    analysis_records: tuple[KnowledgeItem, ...] | None = None

    @property
    def procedures(self) -> tuple[LegalProcedure, ...]:
        return tuple(item for item in self.records if isinstance(item, LegalProcedure))

    @property
    def authorities(self) -> tuple[Authority, ...]:
        return tuple(item for item in self.records if isinstance(item, Authority))

    @property
    def jurisdictions(self) -> tuple[KnowledgeJurisdiction, ...]:
        return tuple(item for item in self.records if isinstance(item, KnowledgeJurisdiction))


@dataclass(frozen=True, slots=True)
class PipelineBlocker:
    code: str
    stage: str
    message: str
    related_id: str | None = None


@dataclass(frozen=True, slots=True)
class PipelineNextAction:
    id: str
    action: str
    reason: str
    source: Literal["safety_support", "journey_execution"]
    stage: str
    condition: str | None = None


@dataclass(frozen=True, slots=True)
class AnalysisTimelineReady:
    """Timeline and point-in-time projection ready for downstream analysis."""

    case_id: str
    timeline: tuple[TimelineEvent, ...]
    snapshot: TimelineSnapshot
    status: Literal["ready"] = "ready"


@dataclass(frozen=True, slots=True)
class CasePipelineResult:
    """Separated outputs from one ordered case-intelligence pipeline run."""

    case_state: CaseState
    evidence_context: EvidenceContext
    safety_result: SafetySupportAssessment
    document_findings: tuple[DocumentResult, ...]
    legal_knowledge: LegalKnowledgeContext
    legal_reasoning: ReasoningResult
    journey_plan: Journey
    journey_state: JourneyExecution
    decision_scenario: DecisionScenario
    case_analysis: CaseAnalysis
    unresolved_questions: tuple[ContextRecord, ...]
    blockers: tuple[PipelineBlocker, ...]
    next_actions: tuple[PipelineNextAction, ...]
    analysis_timeline: AnalysisTimelineReady
    provenance: tuple[PipelineProvenance, ...]
    stage_order: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-compatible copy with stable API-style CaseState keys."""

        value = _json_value(self)
        assert isinstance(value, dict)
        return value

    def to_json(self) -> str:
        """Serialize deterministically for snapshots and downstream consumers."""

        return json.dumps(self.as_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


@dataclass(frozen=True, slots=True)
class CasePipelineDependencies:
    """Injectable stage functions; defaults delegate to the existing engines."""

    case_state_extractor: Callable[..., CaseState] = extract_case_state
    evidence_context_builder: Callable[[CaseState], EvidenceContext] | None = None
    document_processor: Callable[[bytes, str, str], DocumentResult] | None = None
    document_integrator: Callable[[CaseState, DocumentResult], CaseState] = integrate_document_evidence
    safety_assessor: Callable[[CaseState, str | None, str | None], SafetySupportAssessment] | None = None
    legal_knowledge_retriever: Callable[[CaseState, LegalKnowledgeRepository | None], LegalKnowledgeContext] | None = None
    legal_reasoner: Callable[..., ReasoningResult] = reason_about_case
    journey_builder: Callable[[CaseState, SafetySupportAssessment], Journey] | None = None
    journey_executor: Callable[[CaseState, Journey], JourneyExecution] = create_execution
    analysis_timeline_builder: Callable[[CaseState, str], AnalysisTimelineReady] | None = None


def run_case_pipeline(
    request: CasePipelineRequest,
    *,
    dependencies: CasePipelineDependencies | None = None,
    legal_knowledge_repository: LegalKnowledgeRepository | None = None,
) -> CasePipelineResult:
    """Run the deterministic, provenance-preserving case intelligence flow."""

    _validate_request(request)
    deps = dependencies or CasePipelineDependencies()
    recorded_at = _canonical_timestamp(request.recorded_at)
    stages = ["USER_INPUT"]

    case_state = deps.case_state_extractor(
        request.initial_statement,
        case_id=request.case_id,
        source_id=request.source_id,
        source_type="user",
        source_title="Initial user statement",
        language=request.language,
        created_at=recorded_at,
    )
    if not isinstance(case_state, CaseState):
        raise TypeError("case_state_extractor must return a CaseState")
    if case_state.id != request.case_id:
        raise ValueError("case_state_extractor must preserve the requested case_id")
    case_state.initialStatement = request.initial_statement
    case_state.title = request.title
    if request.person_name and request.person_name.strip() and not case_state.person.name:
        case_state.person.name = request.person_name
    case_state.metadata.createdAt = recorded_at
    case_state.metadata.updatedAt = recorded_at
    case_state.analysis = None
    stages.append("CASE_STATE")

    context_builder = deps.evidence_context_builder or build_evidence_context
    evidence_context = context_builder(case_state)
    stages.append("EVIDENCE_CONTEXT")

    document_findings: list[DocumentResult] = []
    if request.documents:
        processor = deps.document_processor or _process_document_deterministically
        for index, document in enumerate(request.documents):
            document_id = document.document_id or _document_id(request.case_id, document, index)
            result = processor(document.content, document.filename, document_id)
            if not isinstance(result, DocumentResult):
                raise TypeError("document_processor must return a DocumentResult")
            if result.document_id != document_id:
                raise ValueError("document_processor must preserve the supplied deterministic document_id")
            result = _normalize_document_timestamp(result, recorded_at)
            case_state = deps.document_integrator(case_state, result)
            if not isinstance(case_state, CaseState):
                raise TypeError("document_integrator must return a CaseState")
            if case_state.id != request.case_id or case_state.initialStatement != request.initial_statement:
                raise ValueError("document_integrator must preserve the requested case_id and initialStatement")
            if not any(item.id == result.document_id for item in case_state.documents):
                case_state.documents.append(_case_document_record(result))
            case_state.metadata.updatedAt = recorded_at
            case_state.analysis = None
            document_findings.append(result)
        stages.append("DOCUMENT_INTELLIGENCE")
        # Refresh the initial evidence/context snapshot with the document-stage
        # additions while retaining every source status and conflict.
        evidence_context = context_builder(case_state)
        stages.append("EVIDENCE_CONTEXT_REFRESH")

    safety_assessor = deps.safety_assessor or _assess_safety
    safety_result = safety_assessor(case_state, request.safety_language, _answer_value(request.immediate_danger))
    stages.append("SAFETY_SUPPORT")

    knowledge_retriever = deps.legal_knowledge_retriever or retrieve_legal_knowledge
    knowledge_repository = (
        legal_knowledge_repository
        if legal_knowledge_repository is not None
        else build_authoritative_legal_knowledge_seed()
    )
    legal_knowledge = knowledge_retriever(case_state, knowledge_repository)
    stages.append("LEGAL_KNOWLEDGE_RETRIEVAL")

    legal_reasoning = deps.legal_reasoner(
        case_state,
        legal_knowledge_records=legal_knowledge.records,
        procedure_records=legal_knowledge.procedures,
        authority_records=legal_knowledge.authorities,
        jurisdiction_records=legal_knowledge.jurisdictions,
        relationships=legal_knowledge.relationships,
    )
    stages.append("LEGAL_REASONING")

    journey_builder = deps.journey_builder or _build_journey_with_safety
    journey_plan = journey_builder(case_state, safety_result)
    if journey_plan.case_id != case_state.id:
        raise ValueError("journey_builder must return a Journey for the current CaseState")
    stages.append("JOURNEY_PLANNING")

    journey_state = deps.journey_executor(case_state, journey=journey_plan)
    if journey_state.case_id != case_state.id:
        raise ValueError("journey_executor must return a state for the current CaseState")
    stages.append("JOURNEY_EXECUTION")

    timeline_builder = deps.analysis_timeline_builder or build_analysis_timeline
    analysis_timeline = timeline_builder(case_state, recorded_at)
    if analysis_timeline.case_id != case_state.id:
        raise ValueError("analysis_timeline_builder must return a projection for the current CaseState")
    stages.append("ANALYSIS_TIMELINE")

    unresolved_questions = _unresolved_questions(case_state, legal_reasoning, journey_plan)
    blockers = _blockers(case_state, safety_result, legal_reasoning, journey_state)
    next_actions = _next_actions(safety_result, journey_state)
    provenance = _collect_provenance(
        case_state,
        evidence_context,
        safety_result,
        document_findings,
        legal_knowledge,
        legal_reasoning,
        journey_state,
        analysis_timeline,
    )
    decision_scenario = simulate_decision(case_state, journey_plan)
    return CasePipelineResult(
        case_state=case_state,
        evidence_context=evidence_context,
        safety_result=safety_result,
        document_findings=tuple(document_findings),
        legal_knowledge=legal_knowledge,
        legal_reasoning=legal_reasoning,
        journey_plan=journey_plan,
        journey_state=journey_state,
        decision_scenario=decision_scenario,
        case_analysis=case_state.analysis or _case_analysis_from_stages(
            case_state, safety_result, legal_knowledge, journey_plan,
            decision_scenario,
        ),
        unresolved_questions=unresolved_questions,
        blockers=blockers,
        next_actions=next_actions,
        analysis_timeline=analysis_timeline,
        provenance=provenance,
        stage_order=tuple(stages),
    )


def run_persisted_case_pipeline(
    case_state: CaseState,
    *,
    dependencies: CasePipelineDependencies | None = None,
    legal_knowledge_repository: LegalKnowledgeRepository | None = None,
    safety_language: str | None = None,
    immediate_danger: ImmediateDangerAnswer | str | None = None,
) -> CasePipelineResult:
    """Recompute projections from an existing CaseState without re-extraction.

    The supplied record is copied before its derived analysis is attached.
    IDs, timestamps, source statements, evidence, and confirmation history stay
    owned by the persisted CaseState; this function never saves to storage.
    """
    if not isinstance(case_state, CaseState):
        raise TypeError("case_state must be a CaseState")
    if not case_state.initialStatement or not case_state.initialStatement.strip():
        raise ValueError("CaseState must retain its initial statement for analysis.")

    source_state, _ = normalize_unanswered_clarification_records(case_state)
    case_state = source_state.model_copy(deep=True)
    original_identity = (
        case_state.id,
        case_state.metadata.createdAt,
        case_state.metadata.updatedAt,
        case_state.initialStatement,
    )
    recorded_at = _canonical_timestamp(case_state.metadata.updatedAt)
    deps = dependencies or CasePipelineDependencies()
    stages = ["CASE_STATE", "CONFIRMED_DOCUMENT_EVIDENCE"]

    context_builder = deps.evidence_context_builder or build_evidence_context
    evidence_context = context_builder(case_state)
    stages.append("EVIDENCE_CONTEXT")

    knowledge_repository = (
        legal_knowledge_repository
        if legal_knowledge_repository is not None
        else build_authoritative_legal_knowledge_seed()
    )
    knowledge_retriever = deps.legal_knowledge_retriever or retrieve_legal_knowledge
    legal_knowledge = knowledge_retriever(case_state, knowledge_repository)
    stages.append("LEGAL_KNOWLEDGE_RETRIEVAL")

    legal_reasoning = deps.legal_reasoner(
        case_state,
        legal_knowledge_records=legal_knowledge.records,
        procedure_records=legal_knowledge.procedures,
        authority_records=legal_knowledge.authorities,
        jurisdiction_records=legal_knowledge.jurisdictions,
        relationships=legal_knowledge.relationships,
        unknowns=case_state.unknowns,
        assumptions=case_state.assumptions,
        conflicts=case_state.conflicts,
    )
    stages.append("LEGAL_REASONING")

    safety_assessor = deps.safety_assessor or _assess_safety
    safety_result = safety_assessor(
        case_state,
        safety_language or case_state.metadata.language,
        _answer_value(immediate_danger),
    )
    stages.append("SAFETY_SUPPORT")

    journey_builder = deps.journey_builder or _build_journey_with_safety
    journey_plan = journey_builder(case_state, safety_result)
    if journey_plan.case_id != case_state.id:
        raise ValueError("journey_builder must return a Journey for the current CaseState")
    stages.append("JOURNEY_PLANNING")

    journey_state = deps.journey_executor(case_state, journey=journey_plan)
    if journey_state.case_id != case_state.id:
        raise ValueError("journey_executor must return a state for the current CaseState")
    stages.append("JOURNEY_EXECUTION")

    decision_scenario = simulate_decision(case_state, journey_plan)
    stages.append("DECISION_SIMULATION")
    case_analysis = _case_analysis_from_stages(
        case_state, safety_result, legal_knowledge, journey_plan, decision_scenario,
    )
    case_state.analysis = case_analysis

    timeline_builder = deps.analysis_timeline_builder or build_analysis_timeline
    analysis_timeline = timeline_builder(case_state, recorded_at)
    if analysis_timeline.case_id != case_state.id:
        raise ValueError("analysis_timeline_builder must return a projection for the current CaseState")
    stages.append("LEGAL_TWIN")

    unresolved_questions = _unresolved_questions(case_state, legal_reasoning, journey_plan)
    blockers = _blockers(case_state, safety_result, legal_reasoning, journey_state)
    next_actions = _next_actions(safety_result, journey_state)
    stages.append("NEXT_ACTION")
    provenance = _collect_provenance(
        case_state,
        evidence_context,
        safety_result,
        (),
        legal_knowledge,
        legal_reasoning,
        journey_state,
        analysis_timeline,
    )

    if original_identity != (
        case_state.id,
        case_state.metadata.createdAt,
        case_state.metadata.updatedAt,
        case_state.initialStatement,
    ):
        raise ValueError("Canonical orchestration must preserve CaseState identity and timestamps")

    return CasePipelineResult(
        case_state=case_state,
        evidence_context=evidence_context,
        safety_result=safety_result,
        document_findings=(),
        legal_knowledge=legal_knowledge,
        legal_reasoning=legal_reasoning,
        journey_plan=journey_plan,
        journey_state=journey_state,
        decision_scenario=decision_scenario,
        case_analysis=case_analysis,
        unresolved_questions=unresolved_questions,
        blockers=blockers,
        next_actions=next_actions,
        analysis_timeline=analysis_timeline,
        provenance=provenance,
        stage_order=tuple(stages),
    )


def _source_jurisdiction_match_status(
    case_state: CaseState,
    source_jurisdiction_id: str | None,
    jurisdictions_by_id: Mapping[str, KnowledgeJurisdiction],
) -> Literal["matched", "mismatch", "unknown", "source_jurisdiction_unmapped"]:
    """Compare recorded geographic scope without deciding legal applicability."""
    recorded = {
        "country": case_state.jurisdiction.country,
        "state": case_state.jurisdiction.state,
        "district": case_state.jurisdiction.district,
    }
    if not any(value and value.strip() for value in recorded.values()):
        return "unknown"

    source_jurisdiction = jurisdictions_by_id.get(source_jurisdiction_id or "")
    if source_jurisdiction is None:
        return "source_jurisdiction_unmapped"

    source_scope = {
        "country": source_jurisdiction.country,
        "state": source_jurisdiction.state,
        "district": source_jurisdiction.district,
    }
    for field_name in ("country", "state", "district"):
        source_value = source_scope[field_name]
        if not source_value:
            continue
        recorded_value = recorded[field_name]
        if not recorded_value or not recorded_value.strip():
            return "unknown"
        if source_value.strip().casefold() != recorded_value.strip().casefold():
            return "mismatch"
    return "matched"


def _case_analysis_from_stages(
    case_state: CaseState,
    safety: SafetySupportAssessment,
    knowledge: LegalKnowledgeContext,
    journey: Journey,
    decision: DecisionScenario,
) -> CaseAnalysis:
    """Adapt canonical stage outputs to the established CaseAnalysis contract."""
    detected_safety = detect_case_safety_context(case_state)
    user_source_ids = [
        evidence.id for evidence in case_state.evidence
        if evidence.source == "user" and evidence.status == "user_reported"
    ]
    records_by_source = {item.source_id: item for item in knowledge.governed_sources}
    records_by_id = {item.id: item for item in knowledge.records}
    jurisdictions_by_id = {item.id: item for item in knowledge.jurisdictions}
    record_summaries: list[LegalKnowledgeRecordSummary] = []
    summary_records = knowledge.analysis_records if knowledge.analysis_records is not None else tuple(
        item for item in knowledge.records
        if item.type in {"legal_document", "legal_provision", "legal_rule", "legal_procedure"}
    )
    law_matches = build_law_matches(
        case_state,
        knowledge.records,
        knowledge.governed_sources,
    )
    matched_provision_ids = {item["candidate_id"] for item in law_matches}
    # Search by a broad classifier label can retrieve neighboring provisions
    # (for example, wage law for a workplace-harassment report). Keep those in
    # the local catalog, but do not attach them to this case's Guide or Twin
    # unless the recorded facts also produced an issue-linked candidate.
    summary_records = tuple(
        item for item in summary_records
        if item.type != "legal_provision" or item.id in matched_provision_ids
    )
    for item in summary_records:
        source = records_by_id.get(item.source or "")
        authority_tier = (
            source.authority_tier.name
            if isinstance(source, LegalSource) and source.authority_tier is not None
            else None
        )
        governed = records_by_source.get(item.id if isinstance(item, LegalSource) else (item.source or ""))
        source_jurisdiction = jurisdictions_by_id.get(item.jurisdiction or "")
        jurisdiction_label = None
        if source_jurisdiction is not None:
            jurisdiction_label = ", ".join(filter(None, (
                source_jurisdiction.country,
                source_jurisdiction.state,
                source_jurisdiction.district,
            ))) or source_jurisdiction.title
        record_summaries.append(LegalKnowledgeRecordSummary(
            id=item.id,
            title=item.title,
            type=item.type,
            status=item.status.value,
            jurisdiction=item.jurisdiction,
            authority=item.authority,
            source=item.source,
            source_url=item.source_url,
            reference=item.provision_reference if hasattr(item, "provision_reference") else None,
            version=item.version,
            effective_from=item.effective_from.isoformat() if item.effective_from else None,
            authority_tier=authority_tier,
            provenance=[{
                "source_id": reference.source_id,
                "retrieval_time": reference.retrieval_time.isoformat(),
                "document_id": reference.document_id,
                "provision_id": reference.provision_id,
                "page_section_reference": reference.page_section_reference,
                "source_url": reference.source_url,
            } for reference in item.provenance],
            source_verification_status=(governed.verification_status.value if governed else "unverified"),
            source_freshness_status=(governed.freshness_status.value if governed else "unknown"),
            source_applicability_status=(
                governed.applicability_status.value if governed else "applicability_not_established"
            ),
            jurisdiction_label=jurisdiction_label,
            jurisdiction_match_status=_source_jurisdiction_match_status(
                case_state, item.jurisdiction, jurisdictions_by_id,
            ),
        ))

    user_context = SafetyContextSummary(
        context=safety.context.value if safety.context.value != "uncertain" else "potentially_unsafe",
        confidence=detected_safety.confidence,
        urgency=safety.urgency.value,
        source_ids=user_source_ids,
        indicators=[SafetyIndicatorSummary(
            category=item.category,
            confidence=item.confidence,
            source_ids=user_source_ids,
        ) for item in detected_safety.indicators],
        recommended_safety_prompt=detected_safety.recommended_safety_prompt,
        women_safety_context=(
            WomenSafetyContextSummary.model_validate(safety.women_safety_context.as_summary_dict())
            if safety.women_safety_context is not None
            else None
        ),
    )
    return CaseAnalysis(
        safety_context=user_context,
        legal_knowledge=LegalKnowledgeSummary(
            status="records_found" if summary_records else "empty",
            records=record_summaries,
            law_matches=law_matches,
            support_resources=_legal_aid_support_resources(),
        ),
        journey=JourneySummary.model_validate(asdict(journey)),
        decision_scenario=DecisionScenarioSummary.model_validate(asdict(decision)),
    )


def _legal_aid_support_resources() -> list[dict[str, str]]:
    """Direct official NALSA options; eligibility and local availability vary."""
    return [
        {
            "id": "nalsa-legal-aid-information",
            "title": "NALSA legal aid information and helpline",
            "audience": "Everyone; eligibility and responsible institution depend on applicable rules.",
            "url": "https://nalsa.gov.in/promoting-inclusive-legal-system/",
            "phone": "15100",
            "purpose": "Find legal aid information and National/State/District/Taluka Legal Services institutions.",
        },
        {
            "id": "nalsa-legal-aid-application",
            "title": "Apply for legal aid online",
            "audience": "Applicants seeking legal aid in India; the form asks for location and eligibility details.",
            "url": "https://scourtapp.nic.in/lsams/nologin/applicationFiling.action?requestLocale=en",
            "purpose": "Official NALSA Legal Services Management System application form.",
        },
        {
            "id": "nalsa-womens-assistance",
            "title": "NALSA assistance for women",
            "audience": "Women facing legal issues.",
            "url": "https://nalsa.gov.in/womens-assistance/",
            "phone": "15100",
            "purpose": "Explains how to approach TLSC/DLSA/SLSA, apply online, or use the legal aid helpline.",
        },
    ]


def build_evidence_context(case_state: CaseState) -> EvidenceContext:
    """Group canonical records by status without upgrading or resolving them."""

    evidence_by_id = {item.id: item for item in case_state.evidence}
    records: dict[str, list[ContextRecord]] = {
        "user_reported": [],
        "evidence_supported": [],
        "inferred": [],
        "assumptions": [],
        "unknown": [],
        "conflicting": [],
    }

    def add(record: ContextRecord, group: str) -> None:
        records[group].append(record)

    for party in case_state.parties:
        source_ids = tuple(party.attributes.get("sourceIds", ()))
        name_status = party.attributes.get("nameStatus", "unknown")
        if party.name:
            source_refs = tuple(
                PipelineProvenance(
                    record_id=party.id,
                    source_type=evidence_by_id[source_id].source if source_id in evidence_by_id else "unknown_source",
                    source_id=source_id,
                    source_path=f"parties/{party.id}/name",
                    status=name_status,
                    details=party.name,
                )
                for source_id in source_ids
            ) or (_case_provenance(case_state, party.id, f"parties/{party.id}/name", name_status, party.name),)
            add(ContextRecord(
                id=_stable_id("party_name", case_state.id, party.id),
                kind="party_name",
                text=party.name,
                status=name_status if name_status in {"user_reported", "evidence_supported", "system_inferred", "assumption", "unknown", "conflicting"} else "unknown",
                source_ids=source_ids,
                provenance=source_refs,
            ), _status_group(name_status))
        role_status = party.attributes.get("roleStatus", "unknown")
        role_refs = tuple(
            PipelineProvenance(
                record_id=party.id,
                source_type=evidence_by_id[source_id].source if source_id in evidence_by_id else "unknown_source",
                source_id=source_id,
                source_path=f"parties/{party.id}/role",
                status=role_status,
                details=f"role={party.role}; relationship={party.relationship or ''}",
            )
            for source_id in source_ids
        ) or (_case_provenance(
            case_state,
            party.id,
            f"parties/{party.id}/role",
            role_status,
            f"role={party.role}; relationship={party.relationship or ''}",
        ),)
        add(ContextRecord(
            id=_stable_id("party_role", case_state.id, party.id),
            kind="party_role",
            text=f"{party.role}: {party.relationship or 'relationship not stated'}",
            status=role_status if role_status in {"user_reported", "evidence_supported", "system_inferred", "assumption", "unknown", "conflicting"} else "unknown",
            source_ids=source_ids,
            provenance=role_refs,
        ), _status_group(role_status))

    if case_state.person.name or case_state.person.contact:
        person_value = case_state.person.name or case_state.person.contact or "Person"
        source_id = next((item.id for item in case_state.evidence if item.source == "user"), case_state.id)
        add(ContextRecord(
            id=_stable_id("person", case_state.id, person_value),
            kind="person",
            text=person_value,
            status="user_reported",
            source_ids=(source_id,),
            provenance=(PipelineProvenance(
                record_id=case_state.id,
                source_type="user",
                source_id=source_id,
                source_path="person",
                status="user_reported",
                details="Person value supplied or extracted from the user input.",
            ),),
        ), "user_reported")

    jurisdiction = case_state.jurisdiction
    jurisdiction_values = {
        name: value
        for name, value in (
            ("country", jurisdiction.country),
            ("state", jurisdiction.state),
            ("district", jurisdiction.district),
            ("city", jurisdiction.city),
        )
        if value
    }
    if jurisdiction_values:
        basis_status = {
            "user_reported": "user_reported",
            "document": "evidence_supported",
            "inferred": "system_inferred",
            "unknown": "unknown",
        }[jurisdiction.basis]
        sources = [
            item for item in case_state.evidence
            if (jurisdiction.basis == "document" and item.source == "document")
            or (jurisdiction.basis == "user_reported" and item.source == "user")
        ]
        source_ids = tuple(item.id for item in sources) or (case_state.id,)
        add(ContextRecord(
            id=_stable_id("jurisdiction", case_state.id, str(jurisdiction_values)),
            kind="jurisdiction",
            text=", ".join(f"{name}={value}" for name, value in jurisdiction_values.items()),
            status=basis_status,  # type: ignore[arg-type] - mapped from Jurisdiction.basis.
            source_ids=source_ids,
            provenance=tuple(
                PipelineProvenance(
                    record_id=case_state.id,
                    source_type=source.source if source.id in evidence_by_id else "case_state",
                    source_id=source.id,
                    source_path="jurisdiction",
                    status=basis_status,
                    details=f"basis={jurisdiction.basis}; {source.title}" if source.id in evidence_by_id else f"basis={jurisdiction.basis}",
                )
                for source in sources
            ) or (_case_provenance(case_state, case_state.id, "jurisdiction", basis_status, f"basis={jurisdiction.basis}"),),
        ), _status_group(basis_status))

    for fact in case_state.facts:
        group = _status_group(fact.status)
        refs = _fact_provenance(case_state, fact, evidence_by_id)
        add(ContextRecord(
            id=fact.id,
            kind="fact",
            text=f"{fact.key} = {fact.value}",
            status=fact.status,
            source_ids=tuple(fact.sourceIds),
            provenance=refs,
        ), group)

    for claim in case_state.claims:
        group = _status_group(claim.status)
        refs = tuple(
            PipelineProvenance(
                record_id=claim.id,
                source_type=evidence_by_id[source_id].source if source_id in evidence_by_id else "unknown_source",
                source_id=source_id,
                source_path=f"claims/{claim.id}",
                status=claim.status,
                details=claim.text,
            )
            for source_id in claim.evidenceIds
        ) or (_case_provenance(case_state, claim.id, f"claims/{claim.id}", claim.status, claim.text),)
        add(ContextRecord(
            id=claim.id,
            kind="claim",
            text=claim.text,
            status=claim.status,
            source_ids=tuple(claim.evidenceIds),
            provenance=refs,
        ), group)

    for event in case_state.events:
        linked = [evidence_by_id[item] for item in event.evidenceIds if item in evidence_by_id]
        if any(item.status == "conflicting" for item in linked):
            status = "conflicting"
        elif any(item.source == "document" and item.status == "evidence_supported" for item in linked):
            status = "evidence_supported"
        elif linked:
            status = linked[0].status
        else:
            status = "unknown"
        group = _status_group(status)
        refs = tuple(
            PipelineProvenance(
                record_id=event.id,
                source_type=item.source,
                source_id=item.id,
                source_path=f"events/{event.id}",
                status=item.status,
                details=item.title,
            )
            for item in linked
        ) or (_case_provenance(case_state, event.id, f"events/{event.id}", status, event.description),)
        add(ContextRecord(
            id=event.id,
            kind="event",
            text=event.description,
            status=status,  # type: ignore[arg-type] - status is selected from CaseState values.
            source_ids=tuple(event.evidenceIds),
            provenance=refs,
        ), group)

    for item in case_state.evidence:
        group = _status_group(item.status)
        add(ContextRecord(
            id=item.id,
            kind="evidence",
            text=item.title,
            status=item.status,
            source_ids=(item.id,),
            provenance=(PipelineProvenance(
                record_id=item.id,
                source_type=item.source,
                source_id=item.id,
                source_path=f"evidence/{item.id}",
                status=item.status,
                details=item.title,
            ),),
        ), group)

    for issue in case_state.legalIssues:
        source_ids = tuple(item.id for item in case_state.evidence if item.source == "user")
        add(ContextRecord(
            id=issue.id,
            kind="preliminary_issue_classification",
            text=f"{issue.category}" + (f" / {issue.subcategory}" if issue.subcategory else ""),
            status="system_inferred",
            source_ids=source_ids or (case_state.id,),
            provenance=(PipelineProvenance(
                record_id=issue.id,
                source_type="case_state",
                source_id=case_state.id,
                source_path=f"legalIssues/{issue.id}",
                status="system_inferred",
                details="Preliminary issue classification; not a legal finding.",
            ),),
        ), "inferred")

    if case_state.intent is not None:
        source_id = next((item.id for item in case_state.evidence if item.source == "user"), case_state.id)
        add(ContextRecord(
            id=_stable_id("intent", case_state.id, case_state.intent.objective),
            kind="user_intent",
            text=case_state.intent.objective,
            status="user_reported",
            source_ids=(source_id,),
            provenance=(PipelineProvenance(
                record_id=case_state.id,
                source_type="user",
                source_id=source_id,
                source_path="intent/objective",
                status="user_reported",
                details=f"Recorded urgency label: {case_state.intent.urgency}.",
            ),),
        ), "user_reported")

    for index, value in enumerate(case_state.unknowns):
        record_id = _stable_id("unknown", case_state.id, str(index), value)
        add(ContextRecord(
            id=record_id,
            kind="question",
            text=value,
            status="unknown",
            source_ids=(case_state.id,),
            provenance=(_case_provenance(case_state, record_id, f"unknowns/{index}", "unknown", value),),
        ), "unknown")
    for index, value in enumerate(case_state.assumptions):
        record_id = _stable_id("assumption", case_state.id, str(index), value)
        add(ContextRecord(
            id=record_id,
            kind="assumption",
            text=value,
            status="assumption",
            source_ids=(case_state.id,),
            provenance=(_case_provenance(case_state, record_id, f"assumptions/{index}", "assumption", value),),
        ), "assumptions")
    for index, value in enumerate(case_state.conflicts):
        record_id = _stable_id("conflict", case_state.id, str(index), value)
        add(ContextRecord(
            id=record_id,
            kind="conflict",
            text=value,
            status="conflicting",
            source_ids=(case_state.id,),
            provenance=(_case_provenance(case_state, record_id, f"conflicts/{index}", "conflicting", value),),
        ), "conflicting")

    return EvidenceContext(**{
        name: tuple(sorted(values, key=lambda item: (item.id, item.text.casefold())))
        for name, values in records.items()
    })


def retrieve_legal_knowledge(
    case_state: CaseState,
    repository: LegalKnowledgeRepository | None = None,
) -> LegalKnowledgeContext:
    """Retrieve only local records matching recorded issue categories.

    With no configured repository the result is explicitly empty. When an
    in-memory store exposes graph links, only records connected to a matched
    issue or retrieved record are included in reasoning input.
    """

    if repository is None:
        return LegalKnowledgeContext()

    issue_tokens = {
        token
        for issue in case_state.legalIssues
        for token in (issue.id, issue.category, issue.subcategory)
        if token
    }
    matched: dict[str, KnowledgeItem] = {}
    direct_matches: dict[str, KnowledgeItem] = {}
    queries = sorted({issue.category for issue in case_state.legalIssues if issue.category.strip()})
    for query in queries:
        for item in search_legal_knowledge(query, repository=repository):
            matched[item.id] = item
            direct_matches[item.id] = item

    all_items = {
        item.id: item
        for item in getattr(repository, "items", ())
        if isinstance(item, KnowledgeItem)
    }
    analysis_records = dict(direct_matches)
    getter = getattr(repository, "get", None)
    for item in tuple(direct_matches.values()):
        authority = getter(item.authority) if callable(getter) and item.authority else None
        if isinstance(authority, Authority):
            analysis_records[authority.id] = authority
    relationships = tuple(
        sorted(
            getattr(repository, "relationships", ()),
            key=lambda item: (item.subject_id, str(item.relationship), item.object_id),
        )
    )
    selected_ids = set(matched)
    selected_relationships: dict[tuple[str, str, str], KnowledgeRelationship] = {}

    # Follow explicit issue and record links to fetch only related records.
    changed = True
    while changed:
        changed = False
        for relationship in relationships:
            key = (relationship.subject_id, str(relationship.relationship), relationship.object_id)
            touches_issue = relationship.subject_id in issue_tokens or relationship.object_id in issue_tokens
            touches_record = relationship.subject_id in selected_ids or relationship.object_id in selected_ids
            if not touches_issue and not touches_record:
                continue
            selected_relationships[key] = relationship
            for endpoint in (relationship.subject_id, relationship.object_id):
                if endpoint in all_items and endpoint not in selected_ids:
                    selected_ids.add(endpoint)
                    changed = True

    for item_id in tuple(sorted(selected_ids)):
        item = all_items.get(item_id)
        if item is None:
            continue
        referenced_ids = (
            item.source,
            item.authority,
            item.jurisdiction,
            getattr(item, "document_id", None),
            getattr(item, "provision_id", None),
            *getattr(item, "related_provision_ids", ()),
        )
        for reference_id in referenced_ids:
            if reference_id and reference_id in all_items:
                matched[reference_id] = all_items[reference_id]
        # Preserve explicitly cited official material (such as a Gazette
        # commencement notification) alongside the primary statute record.
        for reference in item.provenance:
            if reference.source_id in all_items:
                matched[reference.source_id] = all_items[reference.source_id]
        matched[item.id] = item

    # Keep the records returned directly by search even for repositories that
    # implement only the read protocol and do not expose ``items``.
    for item_id in selected_ids:
        if item_id in all_items:
            matched[item_id] = all_items[item_id]

    relevant_relationships = tuple(
        selected_relationships[key]
        for key in sorted(selected_relationships)
    )
    records = tuple(matched[key] for key in sorted(matched))
    return LegalKnowledgeContext(
        records=records,
        relationships=relevant_relationships,
        governed_sources=_govern_sources(records, repository),
        analysis_records=tuple(analysis_records[key] for key in sorted(analysis_records)),
    )


def _govern_sources(
    records: Sequence[KnowledgeItem],
    repository: LegalKnowledgeRepository,
) -> tuple[GovernedLegalSource, ...]:
    """Project retrieved source catalog facts into the governance contract.

    Verification is carried forward only when both the registered source and
    its explicit source-registry snapshot are verified and source provenance
    is present. Freshness and case-specific applicability remain unknown until
    separately reviewed.
    """
    getter = getattr(repository, "get", None)
    items = tuple(getattr(repository, "items", ()))
    source_ids = {
        record.id if isinstance(record, LegalSource) else record.source
        for record in records
        if isinstance(record, LegalSource) or record.source
    }
    governed: list[GovernedLegalSource] = []
    for source_id in sorted(source_ids):
        source_record = getter(source_id) if callable(getter) else None
        if not isinstance(source_record, LegalSource):
            governed.append(GovernedLegalSource(source_id=source_id))
            continue

        versions = [
            item for item in items
            if isinstance(item, RegistrySourceVersion) and item.source == source_id
        ]
        verified_versions = [
            item for item in versions
            if item.status.value == "verified" and item.provenance
        ]
        verified = source_record.status.value == "verified" and bool(verified_versions)
        version = max(
            verified_versions or versions,
            key=lambda item: (item.retrieved_at.isoformat() if item.retrieved_at else "", item.id),
            default=None,
        )
        refs = tuple(source_record.provenance) or (tuple(version.provenance) if version else ())
        retrieved_at = (
            source_record.retrieved_at
            or (version.retrieved_at if version else None)
            or (refs[0].retrieval_time if refs else None)
        )
        source_url = source_record.source_url or next(
            (reference.source_url for reference in refs if reference.source_url), None
        )
        jurisdiction_record = getter(source_record.jurisdiction) if (
            callable(getter) and source_record.jurisdiction
        ) else None
        jurisdiction_label = None
        if isinstance(jurisdiction_record, KnowledgeJurisdiction):
            jurisdiction_label = ", ".join(filter(None, (
                jurisdiction_record.country,
                jurisdiction_record.state,
                jurisdiction_record.district,
            ))) or jurisdiction_record.title
        reference = version.canonical_reference if version else None
        if not reference:
            reference = next((item.page_section_reference for item in refs if item.page_section_reference), None)
        evidence = None
        if verified and version is not None:
            evidence = (
                f"Verified catalog snapshot {version.id} includes explicit source provenance."
            )
        governed.append(GovernedLegalSource(
            source_id=source_id,
            authority=source_record.authority,
            title=source_record.title,
            jurisdiction=jurisdiction_label or source_record.jurisdiction,
            source_type=version.source_type.value if version and version.source_type else None,
            official_reference=reference,
            source_url=source_url,
            reference=reference,
            version=version.version if version else source_record.version,
            effective_date=(version.effective_from if version else source_record.effective_from),
            retrieved_at=retrieved_at,
            verification_status=(
                SourceVerificationStatus.VERIFIED if verified
                else SourceVerificationStatus.UNVERIFIED
            ),
            verification_evidence=evidence,
            freshness_status=SourceFreshnessStatus.UNKNOWN,
            applicability_status=SourceApplicabilityStatus.APPLICABILITY_NOT_ESTABLISHED,
        ))
    registry = SourceGovernanceRegistry()
    registry.add_many(governed)
    return registry.entries()


def build_analysis_timeline(case_state: CaseState, recorded_at: str) -> AnalysisTimelineReady:
    """Project the final CaseState through the existing LegalTwin engine."""

    twin = build_legal_twin(case_state)
    return AnalysisTimelineReady(
        case_id=case_state.id,
        timeline=generate_timeline(twin),
        snapshot=snapshot_at(twin, recorded_at),
    )


def _validate_request(request: CasePipelineRequest) -> None:
    if not isinstance(request, CasePipelineRequest):
        raise TypeError("request must be a CasePipelineRequest")
    if not isinstance(request.case_id, str) or not request.case_id.strip():
        raise ValueError("case_id must not be empty")
    if not isinstance(request.initial_statement, str) or not request.initial_statement.strip():
        raise ValueError("initial_statement must not be empty")
    if not isinstance(request.source_id, str) or not request.source_id.strip():
        raise ValueError("source_id must not be empty")
    _canonical_timestamp(request.recorded_at)
    for document in request.documents:
        if not isinstance(document, CasePipelineDocument):
            raise TypeError("documents must contain CasePipelineDocument values")
        if not isinstance(document.filename, str) or not document.filename.strip():
            raise ValueError("document filename must not be empty")
        if not isinstance(document.content, bytes):
            raise TypeError("document content must be bytes")
        if document.document_id is not None and not document.document_id.strip():
            raise ValueError("document_id must not be empty when supplied")
    supplied_ids = [item.document_id for item in request.documents if item.document_id]
    if len(supplied_ids) != len(set(supplied_ids)):
        raise ValueError("document_id values must be unique within one pipeline request")


def _canonical_timestamp(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("recorded_at must be an ISO date or datetime string")
    parsed = normalize_datetime(value)
    if parsed is None:
        raise ValueError("recorded_at must be a valid ISO date or datetime")
    return parsed.isoformat()


def _document_id(case_id: str, document: CasePipelineDocument, index: int) -> str:
    digest = hashlib.sha256(document.content).hexdigest()
    value = f"{case_id}\x1f{index}\x1f{document.filename}\x1f{digest}"
    return "doc_" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


def _stable_id(kind: str, *parts: str) -> str:
    value = "\x1f".join((kind, *parts)).encode("utf-8")
    return f"{kind}_{hashlib.sha256(value).hexdigest()[:16]}"


def _status_group(status: str) -> str:
    return {
        "user_reported": "user_reported",
        "evidence_supported": "evidence_supported",
        "system_inferred": "inferred",
        "assumption": "assumptions",
        "unknown": "unknown",
        "conflicting": "conflicting",
    }.get(status, "unknown")


def _fact_provenance(
    case_state: CaseState,
    fact: CaseFact,
    evidence_by_id: Mapping[str, EvidenceItem],
) -> tuple[PipelineProvenance, ...]:
    refs: list[PipelineProvenance] = []
    for source_id in fact.sourceIds:
        source = evidence_by_id.get(source_id)
        refs.append(PipelineProvenance(
            record_id=fact.id,
            source_type=source.source if source else "unknown_source",
            source_id=source_id,
            source_path=f"facts/{fact.id}",
            status=fact.status,
            details=source.title if source else "Source ID is not present in the CaseState evidence list.",
        ))
    for item in fact.provenance:
        refs.append(PipelineProvenance(
            record_id=fact.id,
            source_type="document",
            source_id=item.documentId,
            source_path=f"documents/{item.documentId}/pages/{item.pageNumber}",
            status=item.status,
            confidence=item.confidence,
            page_number=item.pageNumber,
            extraction_method=item.extractionMethod,
            details=f"{fact.key} = {fact.value}",
        ))
    if not refs:
        refs.append(_case_provenance(case_state, fact.id, f"facts/{fact.id}", fact.status, str(fact.value)))
    return tuple(refs)


def _case_provenance(
    case_state: CaseState,
    record_id: str,
    path: str,
    status: str,
    details: str | None = None,
) -> PipelineProvenance:
    return PipelineProvenance(
        record_id=record_id,
        source_type="case_state",
        source_id=case_state.id,
        source_path=path,
        status=status,
        details=details,
    )


def _answer_value(value: ImmediateDangerAnswer | str | None) -> str | None:
    if value is None:
        return None
    return value.value if isinstance(value, ImmediateDangerAnswer) else value


def _safety_language(value: str | None, detected: str | None) -> str | None:
    selected = value or detected
    if selected is None:
        return None
    normalized = selected.strip().casefold()
    if normalized in {"en", "english"}:
        return SafetyLanguage.ENGLISH.value
    if normalized in {"hi", "hindi"}:
        return SafetyLanguage.HINDI.value
    if normalized == "hinglish":
        return SafetyLanguage.HINGLISH.value
    if value is not None:
        raise ValueError("safety_language must be 'en', 'hi', or 'hinglish'")
    return None


def _assess_safety(
    case_state: CaseState,
    requested_language: str | None,
    immediate_danger: str | None,
) -> SafetySupportAssessment:
    return orchestrate_safety_support(
        case_state.initialStatement or "",
        language=_safety_language(requested_language, case_state.metadata.language),
        immediate_danger=immediate_danger,
        jurisdiction=case_state.jurisdiction.country,
        state=case_state.jurisdiction.state,
        case_state=case_state,
    )


@dataclass(frozen=True, slots=True)
class _JourneySafetyContext:
    context: _ContextValue


@dataclass(frozen=True, slots=True)
class _ContextValue:
    value: str


def _build_journey_with_safety(case_state: CaseState, safety: SafetySupportAssessment) -> Journey:
    context = safety.context.value
    if context == "uncertain":
        context = "potentially_unsafe"
    return build_journey(
        case_state,
        safety_assessment=_JourneySafetyContext(context=_ContextValue(context)),  # type: ignore[arg-type]
    )


def _process_document_deterministically(data: bytes, filename: str, document_id: str) -> DocumentResult:
    try:
        return process_document(data, filename, document_id=document_id)
    except DocumentProcessingError as exc:
        metadata = build_metadata(data, filename, page_count=0)
        return DocumentResult(
            document_id=document_id,
            metadata=metadata,
            classification=Classification(category="unknown", confidence=0.0),
            pages=(),
            evidence=(),
            status=DocumentProcessingStatus.FAILED,
            errors=(str(exc),),
        )


def _normalize_document_timestamp(result: DocumentResult, recorded_at: str) -> DocumentResult:
    metadata = replace(result.metadata, processing_timestamp=recorded_at)
    return replace(result, metadata=metadata)


def _case_document_record(result: DocumentResult) -> CaseDocument:
    metadata = result.metadata
    return CaseDocument(
        id=result.document_id,
        filename=metadata.filename,
        mimeType=metadata.mime_type,
        extension=metadata.extension,
        fileSize=metadata.file_size,
        sha256=metadata.sha256,
        pageCount=metadata.page_count,
        processingTimestamp=metadata.processing_timestamp,
        processingStatus=result.status.value,
        classification=result.classification.category,
        classificationConfidence=result.classification.confidence,
        classificationSignals=list(result.classification.signals),
        pages=[
            CaseDocumentPage(
                pageNumber=page.page_number,
                extractionMethod=page.extraction_method,
                processingStatus=page.status.value,
                textLength=len(page.text),
                confidence=page.confidence,
                providerName=page.provider_name,
            )
            for page in result.pages
        ],
        errors=list(result.errors),
    )


def _unresolved_questions(
    case_state: CaseState,
    reasoning: ReasoningResult,
    journey: Journey,
) -> tuple[ContextRecord, ...]:
    by_text: dict[str, ContextRecord] = {}

    def add(item: ContextRecord) -> None:
        key = " ".join(item.text.casefold().split())
        previous = by_text.get(key)
        if previous is None:
            by_text[key] = item
        elif item.provenance:
            merged = tuple(dict.fromkeys((*previous.provenance, *item.provenance)))
            by_text[key] = replace(previous, provenance=merged, source_ids=tuple(dict.fromkeys((*previous.source_ids, *item.source_ids))))

    for item in case_state.unknowns:
        record_id = _stable_id("unknown", case_state.id, item)
        add(ContextRecord(
            id=record_id,
            kind="question",
            text=item,
            status="unknown",
            source_ids=(case_state.id,),
            provenance=(_case_provenance(case_state, record_id, f"unknowns/{record_id}", "unknown", item),),
        ))
    for item in reasoning.unresolved_questions:
        refs = tuple(_reasoning_provenance(item.id, ref) for ref in item.source_references)
        add(ContextRecord(
            id=item.id,
            kind="question_or_assumption",
            text=item.text,
            status="assumption" if "ASSUMPTION_UNVERIFIED" in item.reason_codes else "unknown",
            source_ids=tuple(ref.source_id for ref in refs),
            provenance=refs,
        ))
    for item in journey.unknowns:
        source_id = f"journey:{journey.id}"
        add(ContextRecord(
            id=item.id,
            kind="journey_question",
            text=item.question,
            status="unknown",
            source_ids=(source_id,),
            provenance=(PipelineProvenance(
                record_id=item.id,
                source_type="journey",
                source_id=source_id,
                source_path=f"journey/unknowns/{item.id}",
                status="unknown",
                details=f"priority={item.priority}; related_to={item.related_to or ''}",
            ),),
        ))
    return tuple(sorted(by_text.values(), key=lambda item: (item.text.casefold(), item.id)))


def _blockers(
    case_state: CaseState,
    safety: SafetySupportAssessment,
    reasoning: ReasoningResult,
    execution: JourneyExecution,
) -> tuple[PipelineBlocker, ...]:
    blockers: list[PipelineBlocker] = []
    if not safety.legal_workflow_allowed:
        blockers.append(PipelineBlocker(
            code="safety_first_workflow",
            stage="safety_support",
            message="Safety support marks this as safety-first; ordinary legal workflow remains blocked pending safety review.",
            related_id=case_state.id,
        ))
    blockers.extend(
        PipelineBlocker(
            code=item.code,
            stage=item.stage.value,
            message=item.message,
            related_id=item.related_id,
        )
        for item in execution.blockers
    )
    for item in reasoning.evidence_gaps:
        blockers.append(PipelineBlocker(
            code="evidence_gap",
            stage="legal_reasoning",
            message=item.description,
            related_id=item.related_record_id or item.id,
        ))
    for item in reasoning.conflicts:
        blockers.append(PipelineBlocker(
            code="conflict_unresolved",
            stage="legal_reasoning",
            message=item.description,
            related_id=item.id,
        ))
    for item in reasoning.blocked_conclusions:
        # Only include blocked grounding/jurisdiction conclusions here. Limits
        # on entitlement and court-outcome prediction remain in legal_reasoning.
        if item.subject not in {"jurisdiction_specific_legal_grounding", "jurisdiction_specific_conclusion"}:
            continue
        code = item.reason_codes[0] if item.reason_codes else "legal_conclusion_blocked"
        blockers.append(PipelineBlocker(
            code=code,
            stage="legal_reasoning",
            message=item.explanation,
            related_id=item.id,
        ))
    unique: dict[tuple[str, str, str | None], PipelineBlocker] = {}
    for item in blockers:
        unique[(item.code, item.message, item.related_id)] = item
    return tuple(sorted(unique.values(), key=lambda item: (item.stage, item.code, item.message.casefold(), item.related_id or "")))


def _next_actions(safety: SafetySupportAssessment, execution: JourneyExecution) -> tuple[PipelineNextAction, ...]:
    if safety.workflow_disposition is WorkflowDisposition.SAFETY_FIRST:
        actions = [
            PipelineNextAction(
                id=_stable_id("safety_action", str(index), action),
                action=action,
                reason="Safety support sequence for the recorded safety context.",
                source="safety_support",
                stage="SAFETY",
            )
            for index, action in enumerate(safety.safe_next_step_sequence)
        ]
        return tuple(actions)
    return tuple(
        PipelineNextAction(
            id=item.id,
            action=item.description,
            reason=item.reason,
            source="journey_execution",
            stage=item.stage.value,
            condition=item.condition,
        )
        for item in execution.procedural_next_steps
    )


def _reasoning_provenance(record_id: str, item: Any) -> PipelineProvenance:
    return PipelineProvenance(
        record_id=record_id,
        source_type=item.source_type,
        source_id=item.source_id,
        source_path=item.source_path,
        status=item.status,
        confidence=item.confidence,
        page_number=item.page_number,
        details=item.details or item.locator,
    )


def _collect_provenance(
    case_state: CaseState,
    context: EvidenceContext,
    safety: SafetySupportAssessment,
    documents: Sequence[DocumentResult],
    knowledge: LegalKnowledgeContext,
    reasoning: ReasoningResult,
    execution: JourneyExecution,
    analysis: AnalysisTimelineReady,
) -> tuple[PipelineProvenance, ...]:
    refs: list[PipelineProvenance] = []
    for group in (
        context.user_reported,
        context.evidence_supported,
        context.inferred,
        context.assumptions,
        context.unknown,
        context.conflicting,
    ):
        refs.extend(ref for item in group for ref in item.provenance)
    user_evidence = next((item for item in case_state.evidence if item.source == "user"), None)
    for item in safety.trigger_evidence:
        refs.append(PipelineProvenance(
            record_id=f"safety:{item.category}",
            source_type="user_response" if item.origin == "user_response" else "user",
            source_id="immediate_danger" if item.origin == "user_response" else (user_evidence.id if user_evidence else case_state.id),
            source_path="safety/immediate_danger" if item.origin == "user_response" else "initialStatement",
            status="user_reported" if item.origin == "user_response" else "system_inferred",
            details=f"{item.category}: {item.matched_text}; trigger text is not a finding that conduct occurred.",
        ))
    for result in documents:
        refs.append(PipelineProvenance(
            record_id=result.document_id,
            source_type="document",
            source_id=result.document_id,
            source_path=f"documents/{result.document_id}",
            status=result.status.value,
            details=(
                f"filename={result.metadata.filename}; sha256={result.metadata.sha256}; "
                f"classification={result.classification.category}"
            ),
        ))
        for page in result.pages:
            refs.append(PipelineProvenance(
                record_id=f"{result.document_id}:page:{page.page_number}",
                source_type="document",
                source_id=result.document_id,
                source_path=f"documents/{result.document_id}/pages/{page.page_number}",
                status=page.status.value,
                page_number=page.page_number,
                extraction_method=page.extraction_method,
                details=f"page_text_length={len(page.text)}",
            ))
        for item in result.evidence:
            refs.append(PipelineProvenance(
                record_id=f"{result.document_id}:{item.field}:{item.page_number}",
                source_type="document",
                source_id=item.document_id,
                source_path=f"documents/{item.document_id}/pages/{item.page_number}",
                status=item.status.value,
                confidence=item.confidence,
                page_number=item.page_number,
                extraction_method=item.extraction_method,
                details=f"{item.field} = {item.value}",
            ))
    for item in knowledge.records:
        refs.append(PipelineProvenance(
            record_id=item.id,
            source_type="legal_knowledge",
            source_id=item.id,
            source_path=f"legal_knowledge/{item.id}",
            status=str(item.status),
            confidence=item.confidence,
            details=item.title,
        ))
        for reference in item.provenance:
            refs.append(PipelineProvenance(
                record_id=item.id,
                source_type="legal_source",
                source_id=reference.source_id,
                source_path=reference.page_section_reference or reference.provision_id or reference.document_id or "source",
                status=str(item.status),
                details=reference.source_url,
            ))
    for collection_name in (
        "reasoning_steps",
        "grounded_legal_statements",
        "supported_findings",
        "user_reported_findings",
        "unresolved_questions",
        "evidence_gaps",
        "conflicts",
        "risks",
        "possible_procedural_paths",
        "blocked_conclusions",
    ):
        for item in getattr(reasoning, collection_name):
            refs.extend(_reasoning_provenance(item.id, ref) for ref in item.source_references)
    for item in execution.provenance:
        refs.append(PipelineProvenance(
            record_id=item.target_id,
            source_type=item.source_type,
            source_id=item.source_id,
            source_path=f"journey_execution/{item.target_id}",
            status="recorded",
            details=item.detail,
        ))
    for item in analysis.timeline:
        refs.extend(
            PipelineProvenance(
                record_id=item.id,
                source_type=ref.source_type,
                source_id=ref.source_id,
                source_path=ref.source_path,
                status=ref.status,
                confidence=ref.confidence,
                page_number=ref.page_number,
                extraction_method=ref.extraction_method,
                details=ref.details,
            )
            for ref in item.provenance
        )
    unique: dict[tuple[Any, ...], PipelineProvenance] = {}
    for item in refs:
        key = (
            item.record_id,
            item.source_type,
            item.source_id,
            item.source_path,
            item.status,
            item.confidence,
            item.page_number,
            item.extraction_method,
            item.details,
        )
        unique[key] = item
    return tuple(unique[key] for key in sorted(unique, key=lambda value: tuple("" if part is None else str(part) for part in value)))


def _json_value(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if is_dataclass(value) and not isinstance(value, type):
        return {item.name: _json_value(getattr(value, item.name)) for item in fields(value)}
    if isinstance(value, Mapping):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json_value(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return sorted((_json_value(item) for item in value), key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))
    return value
