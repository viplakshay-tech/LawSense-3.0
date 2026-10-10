"""Local-first audio-to-CaseState orchestration."""

from __future__ import annotations

import unicodedata

from app.engines.case_state import extract_case_state

from .models import (
    AudioInput,
    InvalidAudioError,
    ProviderUnavailableError,
    VoiceLanguage,
    VoiceProcessingResult,
    VoiceProcessingStatus,
)
from .providers import LanguageDetector, SpeechToTextProvider


_LANGUAGE_ALIASES: dict[str, VoiceLanguage] = {
    "en": VoiceLanguage.ENGLISH,
    "english": VoiceLanguage.ENGLISH,
    "hi": VoiceLanguage.HINDI,
    "hindi": VoiceLanguage.HINDI,
    "hinglish": VoiceLanguage.HINGLISH,
}


def normalize_transcript(text: str) -> str:
    """Normalize Unicode and whitespace while preserving the spoken wording."""
    return " ".join(unicodedata.normalize("NFC", text).split())


def _normalized_language(value: str | VoiceLanguage) -> VoiceLanguage | None:
    if isinstance(value, VoiceLanguage):
        return value
    if not isinstance(value, str):
        return None
    return _LANGUAGE_ALIASES.get(value.strip().casefold())


def _error_result(
    status: VoiceProcessingStatus,
    detail: str,
    *,
    transcript: str | None = None,
    detected_language: str | None = None,
    language: VoiceLanguage | None = None,
    normalized_text: str | None = None,
) -> VoiceProcessingResult:
    return VoiceProcessingResult(
        status=status,
        transcript=transcript,
        detected_language=detected_language,
        language=language,
        normalized_text=normalized_text,
        detail=detail,
    )


def process_audio(
    audio: AudioInput | None,
    *,
    case_id: str,
    speech_to_text_provider: SpeechToTextProvider | None,
    language_detector: LanguageDetector | None,
    source_id: str = "voice-transcription",
    source_title: str = "Voice transcription",
    created_at: str | None = None,
) -> VoiceProcessingResult:
    """Transcribe audio and pass supported-language text to CaseState extraction.

    The function performs no persistence, route handling, model discovery,
    downloads, or network access. Providers must be explicitly injected.
    """
    if not isinstance(audio, AudioInput):
        return _error_result(
            VoiceProcessingStatus.INVALID_AUDIO,
            "Audio input is required.",
        )
    if not isinstance(audio.data, (bytes, bytearray, memoryview)) or not audio.data:
        return _error_result(
            VoiceProcessingStatus.INVALID_AUDIO,
            "Audio must contain non-empty encoded bytes.",
        )
    media_type = audio.media_type.split(";", 1)[0].strip().casefold() if isinstance(audio.media_type, str) else ""
    if not media_type.startswith("audio/"):
        return _error_result(
            VoiceProcessingStatus.INVALID_AUDIO,
            "Audio media_type must identify an audio format.",
        )
    if not isinstance(case_id, str) or not case_id.strip():
        return _error_result(
            VoiceProcessingStatus.PROCESSING_ERROR,
            "A non-empty case_id is required.",
        )
    if speech_to_text_provider is None:
        return _error_result(
            VoiceProcessingStatus.PROVIDER_UNAVAILABLE,
            "Speech-to-text provider is not configured.",
        )

    encoded_audio = AudioInput(data=bytes(audio.data), media_type=media_type)
    try:
        if not speech_to_text_provider.is_available:
            return _error_result(
                VoiceProcessingStatus.PROVIDER_UNAVAILABLE,
                "Speech-to-text provider is unavailable.",
            )
        transcript = speech_to_text_provider.transcribe(encoded_audio)
    except ProviderUnavailableError:
        return _error_result(
            VoiceProcessingStatus.PROVIDER_UNAVAILABLE,
            "Speech-to-text provider is unavailable.",
        )
    except InvalidAudioError:
        return _error_result(
            VoiceProcessingStatus.INVALID_AUDIO,
            "Speech-to-text provider could not decode the supplied audio.",
        )
    except Exception:
        return _error_result(
            VoiceProcessingStatus.PROCESSING_ERROR,
            "Speech-to-text processing failed.",
        )

    if not isinstance(transcript, str) or not transcript.strip():
        return _error_result(
            VoiceProcessingStatus.PROCESSING_ERROR,
            "Speech-to-text provider returned no transcription.",
        )

    if language_detector is None:
        return _error_result(
            VoiceProcessingStatus.PROVIDER_UNAVAILABLE,
            "Language detector is not configured.",
            transcript=transcript,
        )

    try:
        if not language_detector.is_available:
            return _error_result(
                VoiceProcessingStatus.PROVIDER_UNAVAILABLE,
                "Language detector is unavailable.",
                transcript=transcript,
            )
        detected = language_detector.detect_language(transcript)
    except ProviderUnavailableError:
        return _error_result(
            VoiceProcessingStatus.PROVIDER_UNAVAILABLE,
            "Language detector is unavailable.",
            transcript=transcript,
        )
    except Exception:
        return _error_result(
            VoiceProcessingStatus.PROCESSING_ERROR,
            "Language identification failed.",
            transcript=transcript,
        )

    provider_language = getattr(speech_to_text_provider, "detected_language", None)
    provider_language = provider_language.strip().casefold() if isinstance(provider_language, str) else None
    normalized_provider_language = _normalized_language(provider_language) if provider_language else None
    if provider_language and normalized_provider_language is None:
        # Preserve an actual provider language result so, for example, French
        # Latin text is not mislabeled English by the lightweight local
        # script heuristic.
        detected = provider_language
    elif normalized_provider_language is not None and detected not in {
        VoiceLanguage.HINGLISH,
        VoiceLanguage.HINGLISH.value,
    }:
        detected = normalized_provider_language

    detected_language = detected.value if isinstance(detected, VoiceLanguage) else (
        detected if isinstance(detected, str) else None
    )
    language = _normalized_language(detected) if isinstance(detected, (str, VoiceLanguage)) else None
    normalized_text = normalize_transcript(transcript)
    if language is None:
        return _error_result(
            VoiceProcessingStatus.UNSUPPORTED,
            "Only English, Hindi, and Hinglish are supported.",
            transcript=transcript,
            detected_language=detected_language,
            normalized_text=normalized_text,
        )

    try:
        case_state = extract_case_state(
            normalized_text,
            case_id=case_id,
            source_id=source_id,
            source_type="user",
            source_title=source_title,
            language=language.value,
            created_at=created_at,
        )
        # Preserve the voice detector's result if the narrative extractor's
        # independent language heuristic classifies the wording differently.
        case_state.metadata.language = language.value
        # Keep the actual transcript-derived statement on the canonical model.
        case_state.initialStatement = normalized_text
    except Exception:
        return _error_result(
            VoiceProcessingStatus.PROCESSING_ERROR,
            "CaseState extraction failed.",
            transcript=transcript,
            detected_language=detected_language,
            language=language,
            normalized_text=normalized_text,
        )

    return VoiceProcessingResult(
        status=VoiceProcessingStatus.SUCCESS,
        transcript=transcript,
        detected_language=detected_language,
        language=language,
        normalized_text=normalized_text,
        case_state=case_state,
    )
