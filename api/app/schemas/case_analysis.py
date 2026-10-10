"""API snapshots for analyses derived from the canonical CaseState."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class AnalysisModel(BaseModel):
    """Use API-style camelCase while accepting engine dataclass field names."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


JourneyStageName = Literal["UNDERSTAND", "FACTS", "EVIDENCE", "LAW", "OPTIONS", "NEXT_STEP"]


class SafetyIndicatorSummary(AnalysisModel):
    category: str
    confidence: str
    source_ids: list[str] = Field(default_factory=list)
    status: Literal["system_inferred"] = "system_inferred"


WomenSafetyDomainValue = Literal[
        "domestic_abuse",
        "sexual_violence",
        "workplace_sexual_harassment",
        "stalking",
        "threats_coercion",
        "cyber_harassment",
        "intimate_image_abuse",
        "dowry_related_abuse",
        "financial_control_abuse",
        "trafficking_exploitation",
    ]


class WomenSafetyDomainEvidenceSummary(AnalysisModel):
    domain: WomenSafetyDomainValue
    trigger_categories: list[str] = Field(default_factory=list)
    status: Literal["system_inferred"] = "system_inferred"


class WomenSafetyLegalIssueMappingSummary(AnalysisModel):
    domain: WomenSafetyDomainValue
    status: str
    candidate_issue_categories: list[str] = Field(default_factory=list)
    matched_case_issue_ids: list[str] = Field(default_factory=list)
    source_record_ids: list[str] = Field(default_factory=list)


class WomenSafetyProcedureSummary(AnalysisModel):
    record_id: str
    title: str
    jurisdiction: str | None = None
    verification_status: str | None = None
    applicability_status: str | None = None
    jurisdiction_match_status: str | None = None
    source_ids: list[str] = Field(default_factory=list)
    status: Literal["candidate_record_requires_review"] = "candidate_record_requires_review"


class WomenSafetyActionSummary(AnalysisModel):
    id: str
    type: str
    status: str
    condition: str | None = None
    requires_user_choice: bool = True
    jurisdiction_required: bool = False
    source_ids: list[str] = Field(default_factory=list)
    automatic_contact: Literal[False] = False


class WomenSafetySourceReferenceSummary(AnalysisModel):
    record_id: str
    source_id: str
    retrieval_time: str | None = None
    source_url: str | None = None
    provision_id: str | None = None
    page_section_reference: str | None = None
    jurisdiction: str | None = None
    verification_status: str | None = None
    freshness_status: str | None = None
    applicability_status: str | None = None
    jurisdiction_match_status: str | None = None


class WomenSafetyContextSummary(AnalysisModel):
    """Structured women-safety context derived from the shared Safety engine."""

    domains: list[WomenSafetyDomainValue] = Field(default_factory=list)
    domain_evidence: list[WomenSafetyDomainEvidenceSummary] = Field(default_factory=list)
    urgency: Literal["NORMAL", "CONCERNING", "URGENT", "IMMEDIATE_DANGER", "NOT_SURE"]
    immediate_danger_answer: Literal["yes", "no", "not_sure"] | None = None
    jurisdiction_status: Literal["known", "unknown"] = "unknown"
    jurisdiction: str | None = None
    state: str | None = None
    legal_issue_mappings: list[WomenSafetyLegalIssueMappingSummary] = Field(default_factory=list)
    procedures: list[WomenSafetyProcedureSummary] = Field(default_factory=list)
    actions: list[WomenSafetyActionSummary] = Field(default_factory=list)
    evidence_preservation_guidance: list[str] = Field(default_factory=list)
    legal_sources: list[WomenSafetySourceReferenceSummary] = Field(default_factory=list)
    contacted_anyone: Literal[False] = False


class SafetyContextSummary(AnalysisModel):
    context: Literal["none", "sensitive", "potentially_unsafe", "urgent_safety_context"]
    confidence: str
    urgency: Literal["none", "elevated", "urgent"]
    indicators: list[SafetyIndicatorSummary] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    assessment_status: Literal["system_inferred"] = "system_inferred"
    recommended_safety_prompt: str | None = None
    women_safety_context: WomenSafetyContextSummary | None = None


class LegalKnowledgeProvenance(AnalysisModel):
    source_id: str
    retrieval_time: str
    document_id: str | None = None
    provision_id: str | None = None
    page_section_reference: str | None = None
    source_url: str | None = None


class LegalKnowledgeRecordSummary(AnalysisModel):
    id: str
    title: str
    type: str
    status: str
    jurisdiction: str | None = None
    authority: str | None = None
    source: str | None = None
    source_url: str | None = None
    reference: str | None = None
    version: str | None = None
    effective_from: str | None = None
    authority_tier: str | None = None
    provenance: list[LegalKnowledgeProvenance] = Field(default_factory=list)
    source_verification_status: str | None = None
    source_freshness_status: str | None = None
    source_applicability_status: str | None = None
    jurisdiction_label: str | None = None
    jurisdiction_match_status: Literal[
        "matched",
        "mismatch",
        "unknown",
        "source_jurisdiction_unmapped",
    ] = "unknown"


class LegalMatchFactSummary(AnalysisModel):
    text: str
    source_id: str
    status: str


class LegalMatchSummary(AnalysisModel):
    candidate_id: str
    related_issue_ids: list[str] = Field(default_factory=list)
    act_title: str
    act_version: str | None = None
    effective_from: str | None = None
    effective_to: str | None = None
    provision_title: str
    provision_reference: str | None = None
    why_it_may_apply: str
    evidence_assessment: Literal["supported", "plausible", "unclear"]
    assessment_factors: dict[str, str] = Field(default_factory=dict)
    assessment_rationale: list[str] = Field(default_factory=list)
    supporting_facts: list[LegalMatchFactSummary] = Field(default_factory=list)
    missing_facts: list[str] = Field(default_factory=list)
    clarifying_questions: list[str] = Field(default_factory=list)
    conflicting_evidence: list[str] = Field(default_factory=list)
    jurisdiction: dict[str, Any] = Field(default_factory=dict)
    temporal_limitation: str
    limitations: list[str] = Field(default_factory=list)
    competent_authority: dict[str, Any] = Field(default_factory=dict)
    procedures: dict[str, Any] = Field(default_factory=dict)
    required_documents: dict[str, Any] = Field(default_factory=dict)
    verified_deadlines: dict[str, Any] = Field(default_factory=dict)
    official_filing_links: dict[str, Any] = Field(default_factory=dict)
    official_source_links: list[dict[str, Any]] = Field(default_factory=list)
    source: dict[str, Any] = Field(default_factory=dict)
    notice: str


class LegalSupportResourceSummary(AnalysisModel):
    id: str
    title: str
    audience: str
    url: str
    phone: str | None = None
    purpose: str
    verification_status: Literal["official_source_link"] = "official_source_link"


class LegalKnowledgeSummary(AnalysisModel):
    status: Literal["empty", "records_found"]
    records: list[LegalKnowledgeRecordSummary] = Field(default_factory=list)
    law_matches: list[LegalMatchSummary] = Field(default_factory=list)
    support_resources: list[LegalSupportResourceSummary] = Field(default_factory=list)


class JourneyStepSummary(AnalysisModel):
    id: str
    stage: JourneyStageName
    title: str
    description: str
    status: str = "informational"
    related_ids: list[str] = Field(default_factory=list)


class JourneyUnknownSummary(AnalysisModel):
    id: str
    question: str
    priority: str = "normal"
    related_to: str | None = None


class JourneyEvidenceSummary(AnalysisModel):
    id: str
    item: str
    purpose: str
    availability: str = "not_confirmed"


class JourneyDocumentSummary(AnalysisModel):
    id: str
    document: str
    purpose: str
    availability: str = "not_confirmed"


class JourneyPathSummary(AnalysisModel):
    id: str
    label: str
    description: str
    status: str = "verification_required"
    jurisdiction_required: bool = True


class JourneyRiskSummary(AnalysisModel):
    id: str
    description: str
    escalation_trigger: str
    severity: str = "undetermined"


class JourneyActionSummary(AnalysisModel):
    id: str
    action: str
    reason: str
    stage: JourneyStageName = "NEXT_STEP"
    condition: str | None = None


class JourneySummary(AnalysisModel):
    id: str
    case_id: str
    current_situation: str
    steps: list[JourneyStepSummary] = Field(default_factory=list)
    unknowns: list[JourneyUnknownSummary] = Field(default_factory=list)
    required_evidence: list[JourneyEvidenceSummary] = Field(default_factory=list)
    possible_paths: list[JourneyPathSummary] = Field(default_factory=list)
    required_documents: list[JourneyDocumentSummary] = Field(default_factory=list)
    next_actions: list[JourneyActionSummary] = Field(default_factory=list)
    escalation_points: list[JourneyRiskSummary] = Field(default_factory=list)
    jurisdiction_status: Literal["known", "unknown"]
    legal_knowledge_status: str


class SimulatorRequirementSummary(AnalysisModel):
    id: str
    item: str | None = None
    document: str | None = None
    purpose: str
    availability: str = "not_confirmed"


class SimulatorRiskSummary(AnalysisModel):
    id: str
    description: str
    escalation_trigger: str
    severity: str = "undetermined"


class SimulatorUnknownSummary(AnalysisModel):
    id: str
    question: str
    priority: str = "normal"
    related_to: str | None = None


class SimulatorBlockingConditionSummary(AnalysisModel):
    id: str
    description: str
    status: str = "blocking"


class SimulatorPathStepSummary(AnalysisModel):
    id: str
    action: str
    reason: str
    status: str
    related_requirement_ids: list[str] = Field(default_factory=list)


class SimulatorPathSummary(AnalysisModel):
    id: str
    label: str
    description: str
    status: str
    steps: list[SimulatorPathStepSummary] = Field(default_factory=list)
    required_evidence_ids: list[str] = Field(default_factory=list)
    required_document_ids: list[str] = Field(default_factory=list)
    blocking_condition_ids: list[str] = Field(default_factory=list)


class DecisionScenarioSummary(AnalysisModel):
    case_id: str
    current_state: str
    paths: list[SimulatorPathSummary] = Field(default_factory=list)
    required_evidence: list[SimulatorRequirementSummary] = Field(default_factory=list)
    required_documents: list[SimulatorRequirementSummary] = Field(default_factory=list)
    unknowns: list[SimulatorUnknownSummary] = Field(default_factory=list)
    risks: list[SimulatorRiskSummary] = Field(default_factory=list)
    blocking_conditions: list[SimulatorBlockingConditionSummary] = Field(default_factory=list)
    next_action: str
    next_action_reason: str
    legal_information_status: str = "Verification required."


class CaseAnalysis(AnalysisModel):
    """Parallel analysis results attached to, and keyed by, one CaseState."""

    safety_context: SafetyContextSummary
    legal_knowledge: LegalKnowledgeSummary
    journey: JourneySummary
    decision_scenario: DecisionScenarioSummary | None = None
