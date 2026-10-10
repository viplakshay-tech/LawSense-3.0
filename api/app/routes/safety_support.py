"""HTTP boundary for case-based safety support screening."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Body, HTTPException
from pydantic import Field

from app.engines.safety_support import (
    ImmediateDangerAnswer,
    ResourceCategory,
    SafetyLanguage,
    orchestrate_safety_support,
)
from app.schemas.case_analysis import AnalysisModel, WomenSafetyContextSummary
from app.services.case_service import get_case_state


router = APIRouter(prefix="/cases", tags=["safety-support"])


class SafetySupportRequest(AnalysisModel):
    immediate_danger: ImmediateDangerAnswer | None = None
    language: SafetyLanguage | None = None
    requested_resource_categories: list[ResourceCategory] = Field(default_factory=list, max_length=12)


class SafetyTriggerResponse(AnalysisModel):
    category: str
    matched_text: str
    situations: list[str] = Field(default_factory=list)
    origin: str
    source_type: Literal["case_state", "request"]
    source_id: str
    source_path: str


class SafetySupportAssessmentResponse(AnalysisModel):
    context: str
    situations: list[str] = Field(default_factory=list)
    urgency: str
    trigger_evidence: list[SafetyTriggerResponse] = Field(default_factory=list)
    uncertainty: list[str] = Field(default_factory=list)
    user_facing_safety_prompt: str | None = None
    evidence_preservation_guidance: list[str] = Field(default_factory=list)
    escalation_options: list[str] = Field(default_factory=list)
    resource_categories: list[str] = Field(default_factory=list)
    resources: list[dict[str, Any]] = Field(default_factory=list)
    resource_availability: list[dict[str, Any]] = Field(default_factory=list)
    resource_eligibility: list[dict[str, Any]] = Field(default_factory=list)
    safe_next_step_sequence: list[str] = Field(default_factory=list)
    language: str
    workflow_disposition: str
    legal_workflow_allowed: bool
    contacted_anyone: Literal[False] = False
    women_safety_context: WomenSafetyContextSummary


class SafetySupportResponse(AnalysisModel):
    case_id: str
    status: Literal["available"]
    resource_status: Literal["available", "unavailable"]
    contacted_anyone: Literal[False] = False
    assessment: SafetySupportAssessmentResponse


@router.post("/{case_id}/safety-support", response_model=SafetySupportResponse)
def assess_case_safety_support(
    case_id: str,
    payload: SafetySupportRequest | None = Body(default=None),
) -> SafetySupportResponse:
    case_state = get_case_state(case_id)
    if case_state is None:
        raise HTTPException(status_code=404, detail="Case not found")
    if not case_state.initialStatement or not case_state.initialStatement.strip():
        raise HTTPException(status_code=422, detail="Case has no usable initial statement")

    request = payload or SafetySupportRequest()
    jurisdiction = None
    state = None
    if case_state.jurisdiction.basis in {"user_reported", "document"}:
        jurisdiction = case_state.jurisdiction.country
        state = case_state.jurisdiction.state
        if jurisdiction and jurisdiction.strip().casefold() in {"india", "in"}:
            jurisdiction = "IN"

    try:
        result = orchestrate_safety_support(
            case_state.initialStatement,
            language=request.language,
            immediate_danger=request.immediate_danger,
            jurisdiction=jurisdiction,
            state=state,
            requested_resource_categories=request.requested_resource_categories,
            case_state=case_state,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if result.contacted_anyone or (
        result.women_safety_context is not None
        and result.women_safety_context.contacted_anyone
    ):
        # Fail closed if the engine ever gains side-effecting behavior.
        raise HTTPException(status_code=500, detail="Safety support contact state could not be verified")
    if result.women_safety_context is None:
        raise HTTPException(status_code=500, detail="Women safety context could not be verified")

    triggers = [
        SafetyTriggerResponse(
            category=item.category,
            matched_text=item.matched_text,
            situations=[situation.value for situation in item.situations],
            origin=item.origin,
            source_type="request" if item.origin == "user_response" else "case_state",
            source_id=case_state.id,
            source_path="immediateDanger" if item.origin == "user_response" else "initialStatement",
        )
        for item in result.trigger_evidence
    ]
    assessment = SafetySupportAssessmentResponse(
        context=result.context.value,
        situations=[item.value for item in result.situations],
        urgency=result.urgency.value,
        trigger_evidence=triggers,
        uncertainty=list(result.uncertainty),
        user_facing_safety_prompt=result.user_facing_safety_prompt,
        evidence_preservation_guidance=list(result.evidence_preservation_guidance),
        escalation_options=list(result.escalation_options),
        resource_categories=[item.value for item in result.resource_categories],
        resources=[item.as_dict() for item in result.resources],
        resource_availability=[item.as_dict() for item in result.resource_availability],
        resource_eligibility=[item.as_dict() for item in result.resource_eligibility],
        safe_next_step_sequence=list(result.safe_next_step_sequence),
        language=result.language.value,
        workflow_disposition=result.workflow_disposition.value,
        legal_workflow_allowed=result.legal_workflow_allowed,
        contacted_anyone=False,
        women_safety_context=WomenSafetyContextSummary.model_validate(
            result.women_safety_context.as_dict()
        ),
    )
    return SafetySupportResponse(
        case_id=case_state.id,
        status="available",
        resource_status="available" if result.resources else "unavailable",
        contacted_anyone=False,
        assessment=assessment,
    )
