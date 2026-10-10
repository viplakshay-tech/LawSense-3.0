from __future__ import annotations

import unittest
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock, patch

from app.engines.voice import (
    AudioInput,
    EspeakNGTextToSpeechProvider,
    FasterWhisperLocalAdapter,
    InvalidAudioError,
    LocalLanguageDetector,
    LocalWhisperAdapter,
    LocalWhisperSpeechToTextProvider,
    ProviderUnavailableError,
    VoiceLanguage,
    VoiceProcessingStatus,
    process_audio,
)
from app.engines.voice.providers import (
    TextToSpeechProvider,
)


class MockSpeechToTextProvider:
    def __init__(self, transcript: str = "", *, available: bool = True, error: Exception | None = None) -> None:
        self.transcript = transcript
        self.is_available = available
        self.error = error
        self.calls: list[AudioInput] = []

    def transcribe(self, audio: AudioInput) -> str:
        self.calls.append(audio)
        if self.error:
            raise self.error
        return self.transcript


class LanguageAwareSpeechToTextProvider(MockSpeechToTextProvider):
    def __init__(self, transcript: str, detected_language: str) -> None:
        super().__init__(transcript)
        self.detected_language = detected_language


class MockLanguageDetector:
    def __init__(self, language: str, *, available: bool = True, error: Exception | None = None) -> None:
        self.language = language
        self.is_available = available
        self.error = error
        self.inputs: list[str] = []

    def detect_language(self, text: str) -> str:
        self.inputs.append(text)
        if self.error:
            raise self.error
        return self.language


class MockLocalWhisperAdapter:
    is_available = True

    def __init__(self, transcript: str) -> None:
        self.transcript = transcript
        self.calls: list[AudioInput] = []

    def transcribe(self, audio: AudioInput) -> str:
        self.calls.append(audio)
        return self.transcript


class VoicePipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.audio = AudioInput(data=b"mock encoded audio", media_type="audio/wav")

    def test_supported_languages_flow_through_case_state_pipeline(self) -> None:
        examples = (
            ("My landlord kept my deposit.", "english", VoiceLanguage.ENGLISH),
            ("मेरे मकान मालिक ने जमा राशि वापस नहीं की।", "hindi", VoiceLanguage.HINDI),
            ("Mere landlord ne deposit wapas nahi kiya.", "hinglish", VoiceLanguage.HINGLISH),
        )
        for index, (transcript, language_name, expected_language) in enumerate(examples):
            with self.subTest(language=language_name):
                stt = MockSpeechToTextProvider(transcript)
                detector = MockLanguageDetector(language_name)
                result = process_audio(
                    self.audio,
                    case_id=f"voice-case-{index}",
                    speech_to_text_provider=stt,
                    language_detector=detector,
                    created_at="2026-01-01T00:00:00+00:00",
                )

                self.assertEqual(result.status, VoiceProcessingStatus.SUCCESS)
                self.assertEqual(result.transcript, transcript)
                self.assertEqual(result.language, expected_language)
                self.assertEqual(detector.inputs, [transcript])
                self.assertIsNotNone(result.case_state)
                assert result.case_state is not None
                self.assertEqual(result.case_state.metadata.language, language_name)
                self.assertEqual(result.case_state.initialStatement, transcript)
                self.assertEqual(result.case_state.evidence[0].source, "user")

    def test_normalizes_whitespace_after_language_identification(self) -> None:
        stt = MockSpeechToTextProvider("  My landlord\n kept\tmy deposit.  ")
        detector = MockLanguageDetector("en")
        result = process_audio(
            self.audio,
            case_id="normalized-case",
            speech_to_text_provider=stt,
            language_detector=detector,
        )

        self.assertEqual(result.status, VoiceProcessingStatus.SUCCESS)
        self.assertEqual(detector.inputs, ["  My landlord\n kept\tmy deposit.  "])
        self.assertEqual(result.normalized_text, "My landlord kept my deposit.")

    def test_builtin_local_detector_covers_english_hindi_and_hinglish(self) -> None:
        detector = LocalLanguageDetector()
        self.assertEqual(detector.detect_language("My landlord kept my deposit."), "english")
        self.assertEqual(detector.detect_language("मेरे मकान मालिक ने पैसे रख लिए।"), "hindi")
        self.assertEqual(detector.detect_language("Mere landlord ne paise rakh liye."), "hinglish")

    def test_missing_or_unavailable_speech_provider_returns_explicit_state(self) -> None:
        for provider in (None, MockSpeechToTextProvider(available=False)):
            with self.subTest(provider=provider):
                result = process_audio(
                    self.audio,
                    case_id="unavailable-case",
                    speech_to_text_provider=provider,
                    language_detector=MockLanguageDetector("english"),
                )
                self.assertEqual(result.status, VoiceProcessingStatus.PROVIDER_UNAVAILABLE)
                self.assertIsNone(result.transcript)
                self.assertIsNone(result.case_state)

    def test_unconfigured_local_whisper_does_not_claim_transcription(self) -> None:
        provider = LocalWhisperSpeechToTextProvider()
        self.assertFalse(provider.is_available)
        result = process_audio(
            self.audio,
            case_id="no-whisper-case",
            speech_to_text_provider=provider,
            language_detector=MockLanguageDetector("english"),
        )

        self.assertEqual(result.status, VoiceProcessingStatus.PROVIDER_UNAVAILABLE)
        self.assertIsNone(result.transcript)
        self.assertIsNone(result.case_state)
        with self.assertRaises(ProviderUnavailableError):
            provider.transcribe(self.audio)

    def test_local_whisper_adapter_is_explicitly_injected(self) -> None:
        adapter = MockLocalWhisperAdapter("My landlord kept my deposit.")
        provider = LocalWhisperSpeechToTextProvider(cast(LocalWhisperAdapter, adapter))
        result = process_audio(
            self.audio,
            case_id="mock-whisper-case",
            speech_to_text_provider=provider,
            language_detector=MockLanguageDetector("english"),
        )

        self.assertEqual(result.status, VoiceProcessingStatus.SUCCESS)
        self.assertEqual(result.transcript, "My landlord kept my deposit.")
        self.assertEqual(adapter.calls, [self.audio])

    def test_missing_language_detector_returns_provider_unavailable_with_transcript(self) -> None:
        result = process_audio(
            self.audio,
            case_id="no-detector-case",
            speech_to_text_provider=MockSpeechToTextProvider("My landlord kept my deposit."),
            language_detector=None,
        )
        self.assertEqual(result.status, VoiceProcessingStatus.PROVIDER_UNAVAILABLE)
        self.assertEqual(result.transcript, "My landlord kept my deposit.")
        self.assertIsNone(result.case_state)

    def test_unavailable_language_detector_returns_provider_unavailable(self) -> None:
        result = process_audio(
            self.audio,
            case_id="detector-unavailable-case",
            speech_to_text_provider=MockSpeechToTextProvider("My landlord kept my deposit."),
            language_detector=MockLanguageDetector("english", available=False),
        )
        self.assertEqual(result.status, VoiceProcessingStatus.PROVIDER_UNAVAILABLE)
        self.assertIsNotNone(result.transcript)
        self.assertIsNone(result.case_state)

    def test_unsupported_language_is_not_sent_to_case_state(self) -> None:
        result = process_audio(
            self.audio,
            case_id="unsupported-case",
            speech_to_text_provider=MockSpeechToTextProvider("Bonjour, mon propriétaire a gardé le dépôt."),
            language_detector=MockLanguageDetector("french"),
        )
        self.assertEqual(result.status, VoiceProcessingStatus.UNSUPPORTED)
        self.assertEqual(result.detected_language, "french")
        self.assertIsNone(result.language)
        self.assertIsNone(result.case_state)

    def test_local_provider_language_prevents_foreign_latin_text_from_being_labeled_english(self) -> None:
        result = process_audio(
            self.audio,
            case_id="provider-unsupported-language-case",
            speech_to_text_provider=LanguageAwareSpeechToTextProvider(
                "Bonjour, mon propriétaire a gardé le dépôt.", "fr"
            ),
            language_detector=LocalLanguageDetector(),
        )

        self.assertEqual(result.status, VoiceProcessingStatus.UNSUPPORTED)
        self.assertEqual(result.detected_language, "fr")
        self.assertIsNone(result.case_state)

    def test_local_provider_still_allows_hinglish_detection_for_mixed_speech(self) -> None:
        result = process_audio(
            self.audio,
            case_id="provider-hinglish-case",
            speech_to_text_provider=LanguageAwareSpeechToTextProvider(
                "Mere landlord ne deposit wapas nahi kiya.", "hi"
            ),
            language_detector=LocalLanguageDetector(),
        )

        self.assertEqual(result.status, VoiceProcessingStatus.SUCCESS)
        self.assertEqual(result.language, VoiceLanguage.HINGLISH)

    def test_invalid_audio_is_rejected_before_provider_calls(self) -> None:
        stt = MockSpeechToTextProvider("must not be used")
        detector = MockLanguageDetector("english")
        invalid_values = (
            None,
            AudioInput(data=b"", media_type="audio/wav"),
            AudioInput(data=b"not audio", media_type="text/plain"),
        )
        for audio in invalid_values:
            with self.subTest(audio=audio):
                result = process_audio(
                    audio,
                    case_id="invalid-audio-case",
                    speech_to_text_provider=stt,
                    language_detector=detector,
                )
                self.assertEqual(result.status, VoiceProcessingStatus.INVALID_AUDIO)
                self.assertIsNone(result.transcript)
        self.assertEqual(stt.calls, [])
        self.assertEqual(detector.inputs, [])

    def test_provider_can_report_unreadable_audio(self) -> None:
        result = process_audio(
            self.audio,
            case_id="corrupt-audio-case",
            speech_to_text_provider=MockSpeechToTextProvider(error=InvalidAudioError()),
            language_detector=MockLanguageDetector("english"),
        )
        self.assertEqual(result.status, VoiceProcessingStatus.INVALID_AUDIO)
        self.assertIsNone(result.transcript)

    def test_empty_transcription_is_not_replaced_with_placeholder_text(self) -> None:
        result = process_audio(
            self.audio,
            case_id="empty-transcription-case",
            speech_to_text_provider=MockSpeechToTextProvider("  "),
            language_detector=MockLanguageDetector("english"),
        )
        self.assertEqual(result.status, VoiceProcessingStatus.PROCESSING_ERROR)
        self.assertIsNone(result.transcript)
        self.assertIsNone(result.case_state)

    def test_provider_and_language_errors_are_processing_errors(self) -> None:
        stt_error = process_audio(
            self.audio,
            case_id="stt-error-case",
            speech_to_text_provider=MockSpeechToTextProvider(error=RuntimeError("broken")),
            language_detector=MockLanguageDetector("english"),
        )
        language_error = process_audio(
            self.audio,
            case_id="language-error-case",
            speech_to_text_provider=MockSpeechToTextProvider("My landlord kept my deposit."),
            language_detector=MockLanguageDetector("english", error=RuntimeError("broken")),
        )
        self.assertEqual(stt_error.status, VoiceProcessingStatus.PROCESSING_ERROR)
        self.assertEqual(language_error.status, VoiceProcessingStatus.PROCESSING_ERROR)

    def test_tts_provider_interface_is_injectable_without_implementation(self) -> None:
        mock_tts = Mock()
        mock_tts.is_available = True
        mock_tts.synthesize.return_value = b"mock synthesized audio"
        provider = cast(TextToSpeechProvider, mock_tts)
        self.assertTrue(provider.is_available)
        self.assertEqual(provider.synthesize("नमस्ते", VoiceLanguage.HINDI), b"mock synthesized audio")

    def test_local_whisper_availability_requires_model_files_and_installed_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_dir = Path(directory)
            adapter = FasterWhisperLocalAdapter(model_dir)
            self.assertFalse(adapter.is_available)
            (model_dir / "model.bin").write_bytes(b"model")
            (model_dir / "config.json").write_text("{}", encoding="utf-8")
            (model_dir / "tokenizer.json").write_text("{}", encoding="utf-8")
            with patch("app.engines.voice.providers.importlib.util.find_spec", return_value=object()):
                self.assertTrue(adapter.is_available)

    def test_faster_whisper_uses_temporary_audio_and_keeps_detected_language(self) -> None:
        observed_paths: list[Path] = []

        class MockWhisperModel:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                pass

            def transcribe(self, path: str, **_kwargs: object):
                audio_path = Path(path)
                observed_paths.append(audio_path)
                return iter([SimpleNamespace(text=" Mere landlord ne deposit wapas nahi kiya. ")]), SimpleNamespace(language="hi")

        fake_runtime = SimpleNamespace(WhisperModel=MockWhisperModel)
        with tempfile.TemporaryDirectory() as directory:
            model_dir = Path(directory)
            for filename in ("model.bin", "config.json", "tokenizer.json"):
                (model_dir / filename).write_bytes(b"mock")
            adapter = FasterWhisperLocalAdapter(model_dir)
            with patch("app.engines.voice.providers.importlib.util.find_spec", return_value=object()):
                with patch.dict(sys.modules, {"faster_whisper": fake_runtime}):
                    transcript = adapter.transcribe(self.audio)

        self.assertEqual(transcript, "Mere landlord ne deposit wapas nahi kiya.")
        self.assertEqual(adapter.detected_language, "hi")
        self.assertEqual(len(observed_paths), 1)
        self.assertFalse(observed_paths[0].exists())

    def test_unconfigured_local_whisper_runtime_is_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_dir = Path(directory)
            (model_dir / "model.bin").write_bytes(b"model")
            (model_dir / "config.json").write_text("{}", encoding="utf-8")
            (model_dir / "tokenizer.json").write_text("{}", encoding="utf-8")
            with patch("app.engines.voice.providers.importlib.util.find_spec", return_value=None):
                self.assertFalse(FasterWhisperLocalAdapter(model_dir).is_available)

    def test_espeak_provider_synthesizes_locally_and_checks_availability(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "espeak-ng.exe"
            executable.write_bytes(b"test executable marker")
            provider = EspeakNGTextToSpeechProvider(str(executable))
            self.assertTrue(provider.is_available)
            with patch(
                "app.engines.voice.providers.subprocess.run",
                return_value=Mock(returncode=0, stdout=b"RIFFlocal-wav"),
            ) as run:
                audio = provider.synthesize("नमस्ते", VoiceLanguage.HINDI)
            self.assertEqual(audio, b"RIFFlocal-wav")
            self.assertEqual(run.call_args.args[0][2:5], ["hi", "--stdout", "--stdin"])
            self.assertEqual(run.call_args.kwargs["input"], "नमस्ते".encode("utf-8"))

    def test_unavailable_espeak_provider_fails_closed(self) -> None:
        with patch("app.engines.voice.providers.shutil.which", return_value=None):
            provider = EspeakNGTextToSpeechProvider()
        self.assertFalse(provider.is_available)
        with self.assertRaises(ProviderUnavailableError):
            provider.synthesize("Hello", VoiceLanguage.ENGLISH)


if __name__ == "__main__":
    unittest.main()
