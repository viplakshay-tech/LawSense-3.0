"""Data contracts for the local voice processing boundary."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from app.schemas.case_state import CaseState


class VoiceProcessingStatus(str, Enum):
    SUCCESS = "success"
    UNSUPPORTED = "unsupported"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    INVALID_AUDIO = "invalid_audio"
    PROCESSING_ERROR = "processing_error"


class VoiceLanguage(str, Enum):
    ENGLISH = "english"
    HINDI = "hindi"
    HINGLISH = "hinglish"


@dataclass(frozen=True, slots=True)
class AudioInput:
    """Encoded audio supplied by a caller; decoding belongs to the provider."""

    data: bytes
    media_type: str


@dataclass(frozen=True, slots=True)
class VoiceProcessingResult:
    """Result of turning audio into normalized text and a CaseState snapshot."""

    status: VoiceProcessingStatus
    transcript: str | None = None
    detected_language: str | None = None
    language: VoiceLanguage | None = None
    normalized_text: str | None = None
    case_state: CaseState | None = None
    detail: str | None = None


class ProviderUnavailableError(RuntimeError):
    """Raised by an adapter when its local implementation is not configured."""


class InvalidAudioError(ValueError):
    """Raised by an audio provider when encoded audio cannot be processed."""
