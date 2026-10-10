"""HTTP boundary for complete, source-aware case analysis."""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from app.engines.legal_reasoning import ReasoningResult
from app.schemas.case_analysis import AnalysisModel, CaseAnalysis
from app.schemas.case_state import CaseState
from app.services.case_pipeline import run_persisted_case_pipeline
from app.services.case_service import get_case_state


router = APIRouter(prefix="/cases", tags=["analysis"])


class CompleteCaseAnalysisResponse(AnalysisModel):
    case_id: str
    status: Literal["available"]
    legal_knowledge_status: Literal[
        "available", "unavailable", "insufficient_or_blocked", "records_present_but_not_linked"
    ]
    case_analysis: CaseAnalysis
    legal_reasoning: dict[str, Any]


class LegalReasoningResponse(AnalysisModel):
    case_id: str
    status: Literal["available"]
    legal_knowledge_status: Literal[
        "available", "unavailable", "insufficient_or_blocked", "records_present_but_not_linked"
    ]
    result: dict[str, Any]


def _legal_knowledge_status(result: ReasoningResult) -> str:
    """Expose record availability without implying that every record is usable."""
    if result.legal_knowledge_status == "source_grounded_records_present":
        return "available"
    return result.legal_knowledge_status


def _camel_case(key: str) -> str:
    first, *rest = key.split("_")
    return first + "".join(part[:1].upper() + part[1:] for part in rest)


def _json_result(value: Any) -> Any:
    """Convert engine dataclasses to stable JSON values and API-style keys."""
    if is_dataclass(value):
        value = asdict(value)
    value = jsonable_encoder(value)
    if isinstance(value, dict):
        return {_camel_case(str(key)): _json_result(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json_result(item) for item in value]
    return value


def _load_case(case_id: str) -> CaseState:
    case_state = get_case_state(case_id)
    if case_state is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case_state


@router.get("/{case_id}/analysis", response_model=CompleteCaseAnalysisResponse)
def read_complete_case_analysis(case_id: str) -> CompleteCaseAnalysisResponse:
    case_state = _load_case(case_id)
    try:
        pipeline = run_persisted_case_pipeline(case_state)
        analysis = pipeline.case_analysis
        reasoning = pipeline.legal_reasoning
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return CompleteCaseAnalysisResponse(
        case_id=case_state.id,
        status="available",
        legal_knowledge_status=_legal_knowledge_status(reasoning),
        case_analysis=analysis,
        legal_reasoning=_json_result(reasoning),
    )


@router.get("/{case_id}/legal-reasoning", response_model=LegalReasoningResponse)
def read_legal_reasoning(case_id: str) -> LegalReasoningResponse:
    case_state = _load_case(case_id)
    try:
        reasoning = run_persisted_case_pipeline(case_state).legal_reasoning
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return LegalReasoningResponse(
        case_id=case_state.id,
        status="available",
        legal_knowledge_status=_legal_knowledge_status(reasoning),
        result=_json_result(reasoning),
    )
