"""Local-first voice interfaces for speech processing and CaseState creation."""

from .models import (
    AudioInput,
    InvalidAudioError,
    ProviderUnavailableError,
    VoiceLanguage,
    VoiceProcessingResult,
    VoiceProcessingStatus,
)
from .pipeline import normalize_transcript, process_audio
from .providers import (
    LanguageDetector,
    FasterWhisperLocalAdapter,
    EspeakNGTextToSpeechProvider,
    LocalLanguageDetector,
    LocalWhisperAdapter,
    LocalWhisperSpeechToTextProvider,
    PiperLocalTextToSpeechProvider,
    SpeechToTextProvider,
    TextToSpeechProvider,
)

__all__ = [
    "AudioInput",
    "EspeakNGTextToSpeechProvider",
    "FasterWhisperLocalAdapter",
    "InvalidAudioError",
    "LanguageDetector",
    "LocalLanguageDetector",
    "LocalWhisperAdapter",
    "LocalWhisperSpeechToTextProvider",
    "PiperLocalTextToSpeechProvider",
    "ProviderUnavailableError",
    "SpeechToTextProvider",
    "TextToSpeechProvider",
    "VoiceLanguage",
    "VoiceProcessingResult",
    "VoiceProcessingStatus",
    "normalize_transcript",
    "process_audio",
]
