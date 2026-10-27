"""Optional plain-language assistant endpoint for the existing Guide UI."""

from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.case_state import CaseState
from app.services.case_service import get_case_state
from app.services.local_assistant import AssistantResult, chat_with_local_model


router = APIRouter(prefix="/guide", tags=["guide"])


class VerifiedMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=10_000)


class GuideChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    message: str = Field(min_length=1, max_length=10_000)
    language: Literal["auto", "english", "hindi", "hinglish"] = "auto"
    case_id: str | None = Field(default=None, min_length=1, max_length=64)
    # Backward-compatible request field only. Content sent by a caller is not
    # independently authenticated by this endpoint and must never be treated
    # as authoritative legal source material.
    verified_material: list[VerifiedMaterial] = Field(default_factory=list, max_length=10)

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


def _case_context(case_state: CaseState) -> list[dict[str, str]]:
    """Build a small context window from the saved case without changing it."""
    entries: list[dict[str, str]] = []

    def add(label: str, value: str, status: str, limit: int) -> None:
        text = value.strip()
        if not text or len(entries) >= 20:
            return
        entries.append({
            "label": label[:120],
            "status": status[:40],
            "text": text[:limit],
        })

    if case_state.initialStatement:
        add("Original account", case_state.initialStatement, "user_reported", 4_000)

    for fact in case_state.facts[:8]:
        try:
            value = fact.value if isinstance(fact.value, str) else json.dumps(
                fact.value, ensure_ascii=False, default=str
            )
        except (TypeError, ValueError):
            value = str(fact.value)
        add(f"Recorded fact: {fact.key}", value, str(fact.status), 1_000)

    for question in case_state.unknowns[:4]:
        add("Open question", question, "unknown", 500)
    for assumption in case_state.assumptions[:3]:
        add("Recorded assumption", assumption, "assumption", 500)
    for conflict in case_state.conflicts[:3]:
        add("Unresolved conflict", conflict, "conflicting", 500)

    # Keep total prompt context bounded, even if a case contains many long values.
    bounded: list[dict[str, str]] = []
    remaining = 18_000
    for entry in entries:
        overhead = len(entry["label"]) + len(entry["status"]) + 8
        available = remaining - overhead
        if available <= 0:
            break
        value = entry["text"][:available]
        bounded.append({**entry, "text": value})
        remaining -= overhead + len(value)
    return bounded


@router.post("/chat", response_model=GuideChatResponse)
def guide_chat(payload: GuideChatRequest) -> GuideChatResponse:
    """Return one optional local-language reply without changing case state."""
    case_context: list[dict[str, str]] = []
    if payload.case_id:
        case_state = get_case_state(payload.case_id)
        if case_state is None:
            raise HTTPException(status_code=404, detail="Case not found")
        case_context = _case_context(case_state)

    result: AssistantResult = chat_with_local_model(
        message=payload.message,
        language=payload.language,
        verified_material=[item.model_dump() for item in payload.verified_material],
        case_context=case_context,
    )
    return GuideChatResponse(reply=result.reply, status=result.status, model=result.model)
