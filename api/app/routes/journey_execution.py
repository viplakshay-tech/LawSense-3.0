"""HTTP boundary for deterministic journey execution snapshots."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from app.engines.legal_knowledge.models import LegalProvision, LegalRule
from app.schemas.case_analysis import AnalysisModel
from app.services.case_pipeline import run_persisted_case_pipeline
from app.services.case_service import get_case_state


router = APIRouter(prefix="/cases", tags=["journey-execution"])


class JourneyExecutionResponse(AnalysisModel):
    case_id: str
    status: Literal["available"]
    legal_knowledge_status: Literal["available", "unavailable"]
    execution: dict[str, Any]


@router.get("/{case_id}/journey/execution", response_model=JourneyExecutionResponse)
def read_journey_execution(case_id: str) -> JourneyExecutionResponse:
    case_state = get_case_state(case_id)
    if case_state is None:
        raise HTTPException(status_code=404, detail="Case not found")

    try:
        pipeline = run_persisted_case_pipeline(case_state)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    has_legal_knowledge = any(
        isinstance(item, (LegalProvision, LegalRule))
        for item in pipeline.legal_knowledge.records
    )
    return JourneyExecutionResponse(
        case_id=case_state.id,
        status="available",
        legal_knowledge_status="available" if has_legal_knowledge else "unavailable",
        execution=pipeline.journey_state.to_dict(),
    )
