"""Deterministic, source-grounded legal reasoning engine."""

from app.engines.legal_reasoning.engine import REASON_CODE_MESSAGES, reason_about_case
from app.engines.legal_reasoning.models import (
    BlockedConclusion,
    Conflict,
    EvidenceGap,
    Finding,
    GroundedLegalStatement,
    PossibleProceduralPath,
    ReasoningProvenance,
    ReasoningResult,
    ReasoningRisk,
    ReasoningStep,
    UncertaintyAssessment,
    UnresolvedQuestion,
)

__all__ = [
    "BlockedConclusion",
    "Conflict",
    "EvidenceGap",
    "Finding",
    "GroundedLegalStatement",
    "PossibleProceduralPath",
    "REASON_CODE_MESSAGES",
    "ReasoningProvenance",
    "ReasoningResult",
    "ReasoningRisk",
    "ReasoningStep",
    "UncertaintyAssessment",
    "UnresolvedQuestion",
    "reason_about_case",
]
