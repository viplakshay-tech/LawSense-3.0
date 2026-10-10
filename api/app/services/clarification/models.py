"""Data contracts for factual clarification questions."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ClarificationSource(BaseModel):
    """The exact unknown and path that grounded a generated question."""

    model_config = ConfigDict(frozen=True, alias_generator=_to_camel, populate_by_name=True)

    source_id: str
    source_type: Literal["case_state", "journey"]
    source_path: str
    text: str
    priority: str = "normal"
    related_to: str | None = None


class ClarificationQuestion(BaseModel):
    """A stable, localized question backed by one or more open unknowns."""

    model_config = ConfigDict(frozen=True, alias_generator=_to_camel, populate_by_name=True)

    id: str
    case_id: str
    category: Literal[
        "jurisdiction",
        "dates",
        "parties",
        "objective",
        "evidence",
        "safety",
        "other",
    ]
    target: str
    question: str
    language: Literal["english", "hindi", "hinglish"]
    priority: int = Field(ge=0)
    sources: tuple[ClarificationSource, ...]


class ClarificationQuestions(BaseModel):
    """Ordered clarification queue for a single CaseState."""

    model_config = ConfigDict(frozen=True, alias_generator=_to_camel, populate_by_name=True)

    case_id: str
    questions: tuple[ClarificationQuestion, ...] = ()

    @property
    def next_question(self) -> ClarificationQuestion | None:
        return self.questions[0] if self.questions else None
