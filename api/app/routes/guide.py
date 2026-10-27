"""Optional plain-language assistant endpoint for the existing Guide UI."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.local_assistant import AssistantResult, chat_with_local_model


router = APIRouter(prefix="/guide", tags=["guide"])


class VerifiedMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=10_000)


GuideInformationStatus = Literal[
    "user_reported", "evidence_supported", "system_inferred",
    "assumption", "conflicting", "unknown",
]


class GuideCaseFact(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    key: str = Field(min_length=1, max_length=120)
    value: str = Field(max_length=500)
    status: GuideInformationStatus
    confidence: Literal["high", "medium", "low", "unknown"] = "unknown"


class GuideCaseEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=180)
    source: Literal["user", "document", "system"]
    status: GuideInformationStatus


class GuideCaseLegalSource(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=200)
    record_type: str = Field(max_length=80)
    status: str = Field(max_length=80)
    jurisdiction: str | None = Field(default=None, max_length=180)
    verification_status: str | None = Field(default=None, max_length=80)
    freshness_status: str | None = Field(default=None, max_length=80)
    applicability_status: str | None = Field(default=None, max_length=80)


class GuideCaseContext(BaseModel):
    """Compact case snapshot for local-language clarification, never a legal conclusion."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    case_title: str | None = Field(default=None, max_length=200)
    initial_statement: str | None = Field(default=None, max_length=2_000)
    user_objective: str | None = Field(default=None, max_length=250)
    objective_urgency: Literal["low", "medium", "high", "critical"] | None = None
    jurisdiction: str | None = Field(default=None, max_length=400)
    jurisdiction_basis: Literal["user_reported", "document", "inferred", "unknown"] = "unknown"
    facts: list[GuideCaseFact] = Field(default_factory=list, max_length=12)
    open_questions: list[str] = Field(default_factory=list, max_length=8)
    assumptions: list[str] = Field(default_factory=list, max_length=6)
    conflicts: list[str] = Field(default_factory=list, max_length=6)
    evidence: list[GuideCaseEvidence] = Field(default_factory=list, max_length=8)
    document_count: int = Field(default=0, ge=0, le=500)
    legal_issue_categories: list[str] = Field(default_factory=list, max_length=8)
    legal_knowledge_status: str | None = Field(default=None, max_length=80)
    legal_sources: list[GuideCaseLegalSource] = Field(default_factory=list, max_length=6)
    safety_context: Literal["none", "sensitive", "potentially_unsafe", "urgent_safety_context"] = "none"
    safety_urgency: Literal["none", "elevated", "urgent"] | None = None

    @model_validator(mode="after")
    def check_context_size(self) -> "GuideCaseContext":
        if len(self.model_dump_json()) > 12_000:
            raise ValueError("case_context must contain no more than 12,000 characters")
        return self


class GuideChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    message: str = Field(min_length=1, max_length=10_000)
    language: Literal["auto", "english", "hindi", "hinglish"] = "auto"
    verified_material: list[VerifiedMaterial] = Field(default_factory=list, max_length=10)
    case_context: GuideCaseContext | None = None

    @model_validator(mode="after")
    def check_material_size(self) -> "GuideChatRequest":
        total_chars = sum(len(item.title) + len(item.text) for item in self.verified_material)
        if total_chars > 20_000:
            raise ValueError("verified_material must contain no more than 20,000 characters in total")
        return self


class GuideChatResponse(BaseModel):
    reply: str = Field(min_length=1, max_length=6_000)
    status: Literal["ok", "unavailable"]
    model: str = Field(min_length=1, max_length=128)


@router.post("/chat", response_model=GuideChatResponse)
def guide_chat(payload: GuideChatRequest) -> GuideChatResponse:
    """Return one optional local-language reply without changing case state."""
    result: AssistantResult = chat_with_local_model(
        message=payload.message,
        language=payload.language,
        verified_material=[item.model_dump() for item in payload.verified_material],
        case_context=payload.case_context.model_dump(exclude_none=True) if payload.case_context else None,
    )
    return GuideChatResponse(reply=result.reply, status=result.status, model=result.model)
