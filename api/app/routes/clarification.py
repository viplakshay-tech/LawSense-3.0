"""Grounded clarification questions and provenance-linked answers."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.schemas.case_state import CaseState
from app.services.analysis_service import build_case_analysis
from app.services.case_service import get_case_state
from app.services.clarification import (
    ClarificationQuestions,
    apply_clarification_answer,
    build_clarification_questions,
    skip_clarification_question,
)
from app.db.database import save_case


router = APIRouter(prefix="/cases", tags=["clarification"])


class ClarificationAnswerRequest(BaseModel):
    answer: str = Field(..., min_length=1, max_length=10_000)


def _load_case(case_id: str) -> CaseState:
    case_state = get_case_state(case_id)
    if case_state is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case_state


@router.get("/{case_id}/clarification", response_model=ClarificationQuestions)
def read_clarification_questions(
    case_id: str,
    include_skipped: bool = Query(default=False),
) -> ClarificationQuestions:
    """Return only questions supported by current CaseState or Journey gaps."""
    case_state = _load_case(case_id)
    analysis = build_case_analysis(case_state)
    return build_clarification_questions(
        case_state,
        journey_unknowns=analysis.journey.unknowns,
        limit=None,
        include_skipped=include_skipped,
    )


@router.post(
    "/{case_id}/clarification/{question_id}/answer",
    response_model=CaseState,
)
def answer_clarification_question(
    case_id: str,
    question_id: str,
    payload: ClarificationAnswerRequest,
) -> CaseState:
    """Apply one current question answer and refresh all CaseState projections."""
    case_state = _load_case(case_id)
    question, journey_unknowns = _current_question(case_state, question_id, include_skipped=True)

    try:
        updated = apply_clarification_answer(
            case_state,
            question,
            payload.answer,
            journey_unknowns=journey_unknowns,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    updated.analysis = build_case_analysis(updated)
    save_case(updated)
    return updated


@router.post(
    "/{case_id}/clarification/{question_id}/skip",
    response_model=CaseState,
)
def skip_case_clarification_question(case_id: str, question_id: str) -> CaseState:
    """Dismiss one current question while preserving its UNKNOWN state."""
    case_state = _load_case(case_id)
    question, journey_unknowns = _current_question(case_state, question_id)
    try:
        updated = skip_clarification_question(
            case_state,
            question,
            journey_unknowns=journey_unknowns,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    updated.analysis = build_case_analysis(updated)
    save_case(updated)
    return updated


def _current_question(case_state: CaseState, question_id: str, *, include_skipped: bool = False):
    current_analysis = build_case_analysis(case_state)
    journey_unknowns = current_analysis.journey.unknowns
    queue = build_clarification_questions(
        case_state,
        journey_unknowns=journey_unknowns,
        limit=None,
        include_skipped=include_skipped,
    )
    question = next((item for item in queue.questions if item.id == question_id), None)
    if question is None:
        raise HTTPException(
            status_code=409,
            detail="This question no longer refers to an open case unknown. Refresh the case before answering.",
        )
    return question, journey_unknowns
