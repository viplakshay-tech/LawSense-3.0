"""Stable result types for the safety detection engine.

Confidence describes how closely the narrative matches a local rule. It does
not express certainty that an event happened.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class SafetyCategory(str, Enum):
    NONE = "none"
    SENSITIVE = "sensitive"
    POTENTIALLY_UNSAFE = "potentially_unsafe"
    URGENT_SAFETY_CONTEXT = "urgent_safety_context"


class SafetyUrgency(str, Enum):
    NONE = "none"
    ELEVATED = "elevated"
    URGENT = "urgent"


@dataclass(frozen=True)
class SafetyIndicator:
    """A rule match tied to the text that triggered it."""

    category: str
    confidence: str
    matched_text: str
    source_text: str

    def as_dict(self) -> dict[str, str]:
        return {
            "category": self.category,
            "confidence": self.confidence,
            "matched_text": self.matched_text,
            "source_text": self.source_text,
        }


@dataclass(frozen=True)
class SafetyAssessment:
    """Assessment output suitable for use without an API or database layer."""

    context: SafetyCategory
    confidence: str
    indicators: tuple[SafetyIndicator, ...]
    source_text: str
    urgency: SafetyUrgency
    recommended_safety_prompt: str | None

    def as_dict(self) -> dict[str, object]:
        """Return a JSON-compatible representation without external libraries."""
        return {
            "context": self.context.value,
            "confidence": self.confidence,
            "indicators": [indicator.as_dict() for indicator in self.indicators],
            "source_text": self.source_text,
            "urgency": self.urgency.value,
            "recommended_safety_prompt": self.recommended_safety_prompt,
        }
