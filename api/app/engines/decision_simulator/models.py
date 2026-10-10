"""Output contracts for conservative procedural path comparison.

The simulator describes candidate paths supplied by a Legal Journey. It does
not determine legal entitlement, predict a court outcome, or create routes.
"""

from __future__ import annotations

from dataclasses import dataclass


from app.engines.journey.models import (
    RequiredDocument,
    RequiredEvidence,
    Risk,
    Unknown,
)



@dataclass(frozen=True, slots=True)
class BlockingCondition:
    id: str
    description: str
    status: str = "blocking"


@dataclass(frozen=True, slots=True)
class PathStep:
    id: str
    action: str
    reason: str
    status: str
    related_requirement_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DecisionPath:
    id: str
    label: str
    description: str
    status: str
    steps: tuple[PathStep, ...]
    required_evidence_ids: tuple[str, ...] = ()
    required_document_ids: tuple[str, ...] = ()
    blocking_condition_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DecisionScenario:
    case_id: str
    current_state: str
    paths: tuple[DecisionPath, ...]
    required_evidence: tuple[RequiredEvidence, ...]
    required_documents: tuple[RequiredDocument, ...]
    unknowns: tuple[Unknown, ...]
    risks: tuple[Risk, ...]
    blocking_conditions: tuple[BlockingCondition, ...]
    next_action: str
    next_action_reason: str
    legal_information_status: str = "Verification required."
