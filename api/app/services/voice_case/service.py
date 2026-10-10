"""Case workflow integration for the local-first voice engine.

Audio providers are injected explicitly. Transcript previews are ephemeral;
only a reviewed transcript is added to a persisted CaseState.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from app.db.database import get_case, save_case
from app.engines.case_state import extract_case_state
from app.engines.voice import (
    AudioInput,
    LanguageDetector,
    EspeakNGTextToSpeechProvider,
    LocalLanguageDetector,
    LocalWhisperSpeechToTextProvider,
    ProviderUnavailableError,
    SpeechToTextProvider,
    TextToSpeechProvider,
    VoiceLanguage,
    VoiceProcessingResult,
    VoiceProcessingStatus,
    normalize_transcript,
    process_audio,
)
from app.schemas.case_state import CaseState
from app.services.analysis_service import build_case_analysis


_LANGUAGES = {
    "en": VoiceLanguage.ENGLISH,
    "english": VoiceLanguage.ENGLISH,
    "hi": VoiceLanguage.HINDI,
    "hindi": VoiceLanguage.HINDI,
    "hinglish": VoiceLanguage.HINGLISH,
}
MAX_TRANSCRIPT_LENGTH = 30_000


class VoiceCaseError(ValueError):
    """A voice transcript could not be reviewed or added to the case."""

    def __init__(self, message: str, *, status: VoiceProcessingStatus = VoiceProcessingStatus.PROCESSING_ERROR):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True, slots=True)
class VoiceTranscriptPreview:
    """Ephemeral extraction result for transcript review in the UI."""

    status: VoiceProcessingStatus
    transcript: str | None = None
    detected_language: str | None = None
    language: VoiceLanguage | None = None
    case_state: CaseState | None = None
    detail: str | None = None


class VoiceCaseService:
    """Connect speech providers, transcript review, CaseState, and analysis."""

    def __init__(
        self,
        *,
        speech_to_text_provider: SpeechToTextProvider | None = None,
        language_detector: LanguageDetector | None = None,
        text_to_speech_provider: TextToSpeechProvider | None = None,
    ) -> None:
        self._speech_to_text_provider = speech_to_text_provider
        self._text_to_speech_provider = text_to_speech_provider
        # This detector is deterministic, local, and has no added dependency.
        self._language_detector = language_detector if language_detector is not None else LocalLanguageDetector()

    @property
    def speech_to_text_available(self) -> bool:
        """Whether the explicitly injected audio provider can run now."""
        try:
            return self._speech_to_text_provider is not None and self._speech_to_text_provider.is_available
        except Exception:
            return False

    @property
    def language_detector_available(self) -> bool:
        """Whether the selected transcript language detector can run now."""
        try:
            return self._language_detector.is_available
        except Exception:
            return False

    @property
    def speech_to_text_provider_name(self) -> str | None:
        if not self.speech_to_text_available or self._speech_to_text_provider is None:
            return None
        return getattr(self._speech_to_text_provider, "provider_name", "configured speech provider")

    @property
    def speech_to_text_processing_location(self) -> str:
        if not self.speech_to_text_available:
            return "none"
        return getattr(self._speech_to_text_provider, "processing_location", "server")

    @property
    def text_to_speech_available(self) -> bool:
        try:
            return self._text_to_speech_provider is not None and self._text_to_speech_provider.is_available
        except Exception:
            return False

    @property
    def text_to_speech_provider_name(self) -> str | None:
        if not self.text_to_speech_available or self._text_to_speech_provider is None:
            return None
        return getattr(self._text_to_speech_provider, "provider_name", "configured speech output")

    @property
    def text_to_speech_processing_location(self) -> str:
        if not self.text_to_speech_available or self._text_to_speech_provider is None:
            return "none"
        return getattr(self._text_to_speech_provider, "processing_location", "server")

    def synthesize_speech(self, text: str, language: VoiceLanguage) -> bytes:
        provider = self._text_to_speech_provider
        if provider is None or not self.text_to_speech_available:
            raise ProviderUnavailableError("Text-to-speech provider is not configured or available.")
        return provider.synthesize(text, language)

    def transcribe_audio(self, audio: AudioInput) -> VoiceProcessingResult:
        """Run the existing audio pipeline without persisting its draft state."""
        return process_audio(
            audio,
            case_id=f"voice-draft-{uuid4()}",
            speech_to_text_provider=self._speech_to_text_provider,
            language_detector=self._language_detector,
            source_id=f"voice-audio-{uuid4()}",
            source_title="Voice transcript (not yet reviewed)",
        )

    def preview_transcript(
        self,
        transcript: str,
        *,
        case_id: str | None = None,
    ) -> VoiceTranscriptPreview:
        """Detect language and extract a non-persisted CaseState preview."""
        if not isinstance(transcript, str) or not transcript.strip():
            raise VoiceCaseError("Transcript must not be empty.", status=VoiceProcessingStatus.INVALID_AUDIO)
        if len(transcript) > MAX_TRANSCRIPT_LENGTH:
            raise VoiceCaseError(
                f"Transcript must be {MAX_TRANSCRIPT_LENGTH} characters or fewer.",
                status=VoiceProcessingStatus.INVALID_AUDIO,
            )
        if not self.language_detector_available:
            return VoiceTranscriptPreview(
                status=VoiceProcessingStatus.PROVIDER_UNAVAILABLE,
                transcript=transcript,
                detail="Language detector is unavailable.",
            )

        try:
            detected = self._language_detector.detect_language(transcript)
        except ProviderUnavailableError:
            return VoiceTranscriptPreview(
                status=VoiceProcessingStatus.PROVIDER_UNAVAILABLE,
                transcript=transcript,
                detail="Language detector is unavailable.",
            )
        except Exception:
            return VoiceTranscriptPreview(
                status=VoiceProcessingStatus.PROCESSING_ERROR,
                transcript=transcript,
                detail="Language identification failed.",
            )

        detected_language = detected.value if isinstance(detected, VoiceLanguage) else (
            detected if isinstance(detected, str) else None
        )
        language = detected if isinstance(detected, VoiceLanguage) else (
            _LANGUAGES.get(detected.strip().casefold()) if isinstance(detected, str) else None
        )
        if language is None:
            return VoiceTranscriptPreview(
                status=VoiceProcessingStatus.UNSUPPORTED,
                transcript=transcript,
                detected_language=detected_language,
                detail="Only English, Hindi, and Hinglish are supported.",
            )

        normalized = normalize_transcript(transcript)
        draft_case_id = case_id or f"voice-preview-{uuid4()}"
        try:
            state = extract_case_state(
                normalized,
                case_id=draft_case_id,
                source_id="voice-transcript-preview",
                source_type="user",
                source_title="Voice transcript preview",
                language=language.value,
                created_at=datetime.now(timezone.utc).isoformat(),
            )
            state.initialStatement = normalized
            state.metadata.language = language.value
        except Exception:
            return VoiceTranscriptPreview(
                status=VoiceProcessingStatus.PROCESSING_ERROR,
                transcript=transcript,
                detected_language=detected_language,
                language=language,
                detail="CaseState extraction failed.",
            )

        return VoiceTranscriptPreview(
            status=VoiceProcessingStatus.SUCCESS,
            transcript=transcript,
            detected_language=detected_language,
            language=language,
            case_state=state,
        )

    def add_reviewed_transcript(
        self,
        case_id: str,
        transcript: str,
        *,
        input_method: str = "voice",
    ) -> tuple[CaseState, str, VoiceLanguage]:
        """Add user-approved transcript evidence and refresh case analysis."""
        if input_method not in {"voice", "text"}:
            raise VoiceCaseError("inputMethod must be 'voice' or 'text'.")
        existing = get_case(case_id)
        if existing is None:
            raise VoiceCaseError("Case not found.", status=VoiceProcessingStatus.PROCESSING_ERROR)

        preview = self.preview_transcript(transcript, case_id=case_id)
        if preview.status != VoiceProcessingStatus.SUCCESS or preview.language is None:
            raise VoiceCaseError(
                preview.detail or "Transcript could not be processed.",
                status=preview.status,
            )

        source_id = f"{input_method}-statement-{uuid4()}"
        normalized = normalize_transcript(transcript)
        now = datetime.now(timezone.utc).isoformat()
        addition = extract_case_state(
            normalized,
            case_id=case_id,
            source_id=source_id,
            source_type="user",
            source_title=(
                f"User-reviewed voice transcript · {preview.language.value.title()}"
                if input_method == "voice"
                else "Additional user statement"
            ),
            language=preview.language.value,
            created_at=now,
        )

        # Keep the full narrative available to the existing safety and journey
        # engines while each extracted record points to its own voice source.
        original = existing.initialStatement or ""
        previous_unknowns = list(existing.unknowns)
        existing.initialStatement = f"{original}\n\n{transcript}" if original else transcript
        existing.facts.extend(addition.facts)
        existing.events.extend(addition.events)
        existing.evidence.extend(addition.evidence)
        existing.claims.extend(addition.claims)
        existing.legalIssues.extend(addition.legalIssues)
        existing.parties.extend(
            party for party in addition.parties
            if all(current.id != party.id for current in existing.parties)
        )
        existing.assumptions = list(dict.fromkeys([*existing.assumptions, *addition.assumptions]))
        existing.conflicts = list(dict.fromkeys([*existing.conflicts, *addition.conflicts]))

        if existing.jurisdiction.basis == "unknown" and addition.jurisdiction.basis != "unknown":
            existing.jurisdiction = addition.jurisdiction
        elif (
            existing.jurisdiction.city
            and addition.jurisdiction.city
            and existing.jurisdiction.city.casefold() != addition.jurisdiction.city.casefold()
        ):
            existing.conflicts.append(
                "The added statement reports a different city; both source statements are retained for clarification."
            )
        if existing.intent is None:
            existing.intent = addition.intent
        elif addition.intent and existing.intent.objective.casefold() != addition.intent.objective.casefold():
            existing.conflicts.append(
                "The added statement states a different desired outcome; clarification is needed."
            )

        # Recompute narrative-derived clarification prompts across all retained
        # statements so answered questions can clear from the next journey.
        baseline_unknowns: set[str] = set()
        if original.strip():
            try:
                baseline = extract_case_state(
                    original,
                    case_id=case_id,
                    source_id="voice-clarification-baseline",
                    source_type="user",
                    language=existing.metadata.language,
                    created_at=now,
                )
                baseline_unknowns = set(baseline.unknowns)
            except Exception:
                baseline_unknowns = set()
        aggregate = extract_case_state(
            existing.initialStatement,
            case_id=case_id,
            source_id="voice-clarification-review",
            source_type="user",
            language=preview.language.value,
            created_at=now,
        )
        externally_recorded_unknowns = [item for item in previous_unknowns if item not in baseline_unknowns]
        existing.unknowns = list(dict.fromkeys([*externally_recorded_unknowns, *aggregate.unknowns]))

        if not existing.metadata.language:
            existing.metadata.language = preview.language.value
        existing.metadata.updatedAt = now
        existing.analysis = build_case_analysis(existing)
        existing.metadata.updatedAt = datetime.now(timezone.utc).isoformat()
        save_case(existing)
        return existing, source_id, preview.language


def build_voice_case_service(
    *,
    speech_to_text_provider: SpeechToTextProvider | None = None,
    language_detector: LanguageDetector | None = None,
    text_to_speech_provider: TextToSpeechProvider | None = None,
) -> VoiceCaseService:
    """Create a service, selecting optional local providers only when configured."""
    if speech_to_text_provider is None:
        import os

        model_path = os.getenv("LAWSENSE_LOCAL_WHISPER_MODEL")
        if model_path:
            from app.engines.voice import FasterWhisperLocalAdapter

            speech_to_text_provider = LocalWhisperSpeechToTextProvider(
                FasterWhisperLocalAdapter(model_path)
            )
    if text_to_speech_provider is None:
        text_to_speech_provider = EspeakNGTextToSpeechProvider()
    return VoiceCaseService(
        speech_to_text_provider=speech_to_text_provider,
        language_detector=language_detector,
        text_to_speech_provider=text_to_speech_provider,
    )
