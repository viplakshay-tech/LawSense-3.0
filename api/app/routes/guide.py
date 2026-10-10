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


class GuideChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    message: str = Field(min_length=1, max_length=10_000)
    language: Literal["auto", "english", "hindi", "hinglish"] = "auto"
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


@router.post("/chat", response_model=GuideChatResponse)
def guide_chat(payload: GuideChatRequest) -> GuideChatResponse:
    """Return one optional local-language reply without changing case state."""
    result: AssistantResult = chat_with_local_model(
        message=payload.message,
        language=payload.language,
        verified_material=[item.model_dump() for item in payload.verified_material],
    )
    return GuideChatResponse(reply=result.reply, status=result.status, model=result.model)
