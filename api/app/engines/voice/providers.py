"""Provider interfaces and safe local adapters for voice features.

No speech model is downloaded and no remote speech provider is contacted.
Applications select local providers through explicit configuration and can
report whether their required runtime is present.
"""

from __future__ import annotations

import importlib.util
import os
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Protocol

from .models import (
    AudioInput,
    InvalidAudioError,
    ProviderUnavailableError,
    VoiceLanguage,
)


class SpeechToTextProvider(Protocol):
    """Transcribe encoded audio using an explicitly configured provider."""

    @property
    def is_available(self) -> bool: ...

    def transcribe(self, audio: AudioInput) -> str:
        """Return provider-produced transcript text or raise a typed error."""
        ...


class LanguageDetector(Protocol):
    """Identify the language of an existing transcript without rewriting it."""

    @property
    def is_available(self) -> bool: ...

    def detect_language(self, text: str) -> str | VoiceLanguage: ...


class TextToSpeechProvider(Protocol):
    """Synthesize text locally or through a caller-selected provider."""

    @property
    def is_available(self) -> bool: ...

    def synthesize(self, text: str, language: VoiceLanguage) -> bytes:
        """Return synthesized audio bytes or raise ProviderUnavailableError."""
        ...


class LocalWhisperAdapter(Protocol):
    """Boundary for an optional, already-installed local Whisper runtime.

    Implementations must not download models in ``is_available`` or
    ``transcribe``. A missing package or model should report unavailable.
    """

    @property
    def is_available(self) -> bool: ...

    def transcribe(self, audio: AudioInput) -> str: ...


class LocalWhisperSpeechToTextProvider:
    """Adapt an optional local Whisper integration to SpeechToTextProvider.

    The adapter is deliberately supplied by the application. Omitting it does
    not import Whisper, inspect the machine, or fetch a model.
    """

    def __init__(self, adapter: LocalWhisperAdapter | None = None) -> None:
        self._adapter = adapter

    @property
    def is_available(self) -> bool:
        return self._adapter is not None and self._adapter.is_available

    def transcribe(self, audio: AudioInput) -> str:
        if not self.is_available:
            raise ProviderUnavailableError("Local Whisper is not configured or available.")
        assert self._adapter is not None
        return self._adapter.transcribe(audio)

    @property
    def provider_name(self) -> str:
        if self._adapter is not None:
            return getattr(self._adapter, "provider_name", "local-whisper")
        return "local-whisper"

    @property
    def processing_location(self) -> str:
        return "local"

    @property
    def detected_language(self) -> str | None:
        if self._adapter is None:
            return None
        value = getattr(self._adapter, "detected_language", None)
        return value if isinstance(value, str) else None


class FasterWhisperLocalAdapter:
    """Use an already-installed faster-whisper runtime and an on-disk model.

    Model downloads are deliberately not part of this adapter. Configure a
    directory containing a faster-whisper model with
    ``LAWSENSE_LOCAL_WHISPER_MODEL``. Audio is written to a temporary file and
    removed as soon as transcription completes.
    """

    provider_name = "faster-whisper"

    def __init__(
        self,
        model_path: str | Path,
        *,
        device: str | None = None,
        compute_type: str | None = None,
    ) -> None:
        self._model_path = Path(model_path).expanduser()
        self._device = device or os.getenv("LAWSENSE_LOCAL_WHISPER_DEVICE", "cpu")
        self._compute_type = compute_type or os.getenv("LAWSENSE_LOCAL_WHISPER_COMPUTE_TYPE", "int8")
        self._model = None
        self._detected_language: str | None = None
        self._lock = threading.Lock()

    @property
    def is_available(self) -> bool:
        if not self._model_path.is_dir():
            return False
        required_files = ("model.bin", "config.json", "tokenizer.json")
        if not all((self._model_path / name).is_file() for name in required_files):
            return False
        if not importlib.util.find_spec("faster_whisper"):
            return False
        return True

    @property
    def detected_language(self) -> str | None:
        return self._detected_language

    @staticmethod
    def _suffix(media_type: str) -> str:
        return {
            "audio/wav": ".wav",
            "audio/x-wav": ".wav",
            "audio/mpeg": ".mp3",
            "audio/mp3": ".mp3",
            "audio/mp4": ".mp4",
            "audio/m4a": ".m4a",
            "audio/ogg": ".ogg",
            "audio/webm": ".webm",
            "audio/flac": ".flac",
        }.get(media_type.casefold(), ".audio")

    def _get_model(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                str(self._model_path),
                device=self._device,
                compute_type=self._compute_type,
                local_files_only=True,
            )
        return self._model

    def transcribe(self, audio: AudioInput) -> str:
        if not self.is_available:
            raise ProviderUnavailableError("Local faster-whisper or its model is not available.")
        with self._lock:
            model = self._get_model()
            try:
                with tempfile.TemporaryDirectory(prefix="lawsense-voice-") as directory:
                    audio_path = Path(directory) / f"input{self._suffix(audio.media_type)}"
                    audio_path.write_bytes(audio.data)
                    segments, info = model.transcribe(
                        str(audio_path),
                        language=None,
                        beam_size=5,
                        vad_filter=True,
                    )
                    transcript = " ".join(
                        segment.text.strip() for segment in segments if segment.text.strip()
                    ).strip()
                    self._detected_language = getattr(info, "language", None)
                    return transcript
            except Exception as exc:
                # PyAV reports malformed media with InvalidDataError. Keep
                # runtime/model failures separate from bad user audio.
                if type(exc).__name__ in {"InvalidDataError", "UnsupportedCodecError"}:
                    raise InvalidAudioError("The supplied audio could not be decoded.") from exc
                raise


class EspeakNGTextToSpeechProvider:
    """Free local TTS via an installed eSpeak NG executable."""

    provider_name = "espeak-ng"
    processing_location = "local"

    def __init__(self, executable: str | None = None, *, timeout_seconds: int = 30) -> None:
        self._executable = executable or shutil.which("espeak-ng")
        self._timeout_seconds = timeout_seconds

    @property
    def is_available(self) -> bool:
        return bool(self._executable and Path(self._executable).is_file())

    def synthesize(self, text: str, language: VoiceLanguage) -> bytes:
        if not self.is_available or self._executable is None:
            raise ProviderUnavailableError("Local eSpeak NG is not installed or configured.")
        if not isinstance(text, str) or not text.strip():
            return b""
        voice = {
            VoiceLanguage.ENGLISH: "en",
            VoiceLanguage.HINDI: "hi",
            # eSpeak NG has Hindi and Indian English voices, but no dedicated
            # Hinglish voice. Hindi is the closest built-in option.
            VoiceLanguage.HINGLISH: "hi",
        }[language]
        try:
            result = subprocess.run(
                [self._executable, "-v", voice, "--stdout", "--stdin"],
                check=False,
                capture_output=True,
                input=text.encode("utf-8"),
                timeout=self._timeout_seconds,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ProviderUnavailableError("Local eSpeak NG could not start.") from exc
        if result.returncode != 0 or not result.stdout:
            raise ProviderUnavailableError("Local eSpeak NG could not synthesize this response.")
        return result.stdout


_DEVANAGARI = re.compile(r"[\u0900-\u097f]")
_LATIN = re.compile(r"[A-Za-z]")
_HINGLISH_MARKERS = re.compile(
    r"\b(?:aap|acha|accha|agar|apna|apne|bas|chahiye|dikha|diya|dunga|dungi|"
    r"hai|hain|hoon|hua|huya|kaise|kar|karenge|karke|karo|karta|karte|karungi|"
    r"kiya|kyun|kya|matlab|mera|mere|meri|mujhe|nahi|nahin|paise|paisa|"
    r"raha|rahe|rahi|sakta|sakti|tha|the|thi|toh|tum|wala|wali|"
    r"yaar|zara|kiraya|kirayedar)\b",
    re.IGNORECASE,
)


class LocalLanguageDetector:
    """Small dependency-free detector for English, Hindi, and Hinglish.

    This is a script and vocabulary heuristic, not a statistical language
    model. Applications can inject a stronger local detector through the same
    interface.
    """

    @property
    def is_available(self) -> bool:
        return True

    def detect_language(self, text: str) -> str:
        devanagari = bool(_DEVANAGARI.search(text))
        latin = bool(_LATIN.search(text))
        marker = bool(_HINGLISH_MARKERS.search(text))

        if devanagari:
            return VoiceLanguage.HINGLISH.value if latin else VoiceLanguage.HINDI.value
        if marker:
            return VoiceLanguage.HINGLISH.value
        if latin:
            return VoiceLanguage.ENGLISH.value
        return "unknown"
