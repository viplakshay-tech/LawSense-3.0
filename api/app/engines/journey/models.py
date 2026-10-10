"""Internal, conservative data contracts for procedural journey planning.

These models describe information to collect and verification still needed. They
do not state legal rights, recommend a legal route, or predict an outcome.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class JourneyStage(StrEnum):
    UNDERSTAND = "UNDERSTAND"
    FACTS = "FACTS"
    EVIDENCE = "EVIDENCE"
    LAW = "LAW"
    OPTIONS = "OPTIONS"
    NEXT_STEP = "NEXT_STEP"


@dataclass(frozen=True, slots=True)
class JourneyStep:
    id: str
    stage: JourneyStage
    title: str
    description: str
    status: str = "informational"
    related_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Unknown:
    id: str
    question: str
    priority: str = "normal"
    related_to: str | None = None


@dataclass(frozen=True, slots=True)
class RequiredEvidence:
    id: str
    item: str
    purpose: str
    availability: str = "not_confirmed"


@dataclass(frozen=True, slots=True)
class RequiredDocument:
    id: str
    document: str
    purpose: str
    availability: str = "not_confirmed"


@dataclass(frozen=True, slots=True)
class PossiblePath:
    id: str
    label: str
    description: str
    status: str = "verification_required"
    jurisdiction_required: bool = True


@dataclass(frozen=True, slots=True)
class Risk:
    id: str
    description: str
    escalation_trigger: str
    severity: str = "undetermined"


@dataclass(frozen=True, slots=True)
class NextAction:
    id: str
    action: str
    reason: str
    stage: JourneyStage = JourneyStage.NEXT_STEP
    condition: str | None = None


@dataclass(frozen=True, slots=True)
class Journey:
    id: str
    case_id: str
    current_situation: str
    steps: tuple[JourneyStep, ...]
    unknowns: tuple[Unknown, ...]
    required_evidence: tuple[RequiredEvidence, ...]
    possible_paths: tuple[PossiblePath, ...]
    required_documents: tuple[RequiredDocument, ...]
    next_actions: tuple[NextAction, ...]
    escalation_points: tuple[Risk, ...]
    jurisdiction_status: str
    legal_knowledge_status: str = "Legal knowledge verification required."

    def steps_for(self, stage: JourneyStage) -> tuple[JourneyStep, ...]:
        """Return this journey's steps for one pipeline stage, in order."""

        return tuple(step for step in self.steps if step.stage == stage)
