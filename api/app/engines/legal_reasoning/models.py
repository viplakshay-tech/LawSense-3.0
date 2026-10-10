"""Output contracts for deterministic, provenance-preserving legal reasoning.

The engine reports what the supplied CaseState and source records contain. It
does not decide legal entitlement, determine disputed facts, or forecast an
outcome.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ReasoningProvenance:
    source_type: str
    source_id: str
    source_path: str
    status: str
    confidence: float | None = None
    page_number: int | None = None
    locator: str | None = None
    details: str | None = None


@dataclass(frozen=True, slots=True)
class ReasoningStep:
    id: str
    text: str
    reason_codes: tuple[str, ...]
    source_references: tuple[ReasoningProvenance, ...]
    related_issue_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Finding:
    id: str
    text: str
    source_references: tuple[ReasoningProvenance, ...]
    related_issue_ids: tuple[str, ...] = ()
    reason_codes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class GroundedLegalStatement:
    id: str
    record_id: str
    record_title: str
    text: str
    record_status: str
    related_issue_ids: tuple[str, ...]
    source_references: tuple[ReasoningProvenance, ...]
    reason_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class UnresolvedQuestion:
    id: str
    text: str
    source_references: tuple[ReasoningProvenance, ...]
    reason_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EvidenceGap:
    id: str
    description: str
    related_record_id: str | None
    source_references: tuple[ReasoningProvenance, ...]
    reason_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Conflict:
    id: str
    description: str
    record_ids: tuple[str, ...]
    source_references: tuple[ReasoningProvenance, ...]
    reason_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ReasoningRisk:
    id: str
    description: str
    severity: str
    source_references: tuple[ReasoningProvenance, ...]
    reason_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PossibleProceduralPath:
    id: str
    procedure_record_id: str
    title: str
    steps: tuple[str, ...]
    authority_record_id: str | None
    authority_title: str | None
    status: str
    blocked_reason_codes: tuple[str, ...]
    source_references: tuple[ReasoningProvenance, ...]
    related_issue_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class BlockedConclusion:
    id: str
    subject: str
    explanation: str
    reason_codes: tuple[str, ...]
    source_references: tuple[ReasoningProvenance, ...]


@dataclass(frozen=True, slots=True)
class UncertaintyAssessment:
    level: str
    confidence: float | None
    confidence_status: str
    reason_codes: tuple[str, ...]
    source_references: tuple[ReasoningProvenance, ...] = ()


@dataclass(frozen=True, slots=True)
class ReasoningResult:
    case_id: str
    jurisdiction_status: str
    legal_knowledge_status: str
    reasoning_steps: tuple[ReasoningStep, ...]
    grounded_legal_statements: tuple[GroundedLegalStatement, ...]
    supported_findings: tuple[Finding, ...]
    user_reported_findings: tuple[Finding, ...]
    unresolved_questions: tuple[UnresolvedQuestion, ...]
    evidence_gaps: tuple[EvidenceGap, ...]
    conflicts: tuple[Conflict, ...]
    risks: tuple[ReasoningRisk, ...]
    possible_procedural_paths: tuple[PossibleProceduralPath, ...]
    blocked_conclusions: tuple[BlockedConclusion, ...]
    uncertainty: UncertaintyAssessment
    reason_codes: tuple[str, ...]
    user_objective: str | None = None
