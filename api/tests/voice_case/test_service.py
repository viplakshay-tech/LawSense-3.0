from __future__ import annotations

import tempfile
import unittest
import os
from pathlib import Path
from unittest.mock import patch

from app.db import database
from app.db.database import get_case
from app.engines.voice import AudioInput, VoiceProcessingStatus
from app.services.case_service import create_case_from_statement
from app.services.voice_case import VoiceCaseService, build_voice_case_service


class _SpeechProvider:
    is_available = True

    def __init__(self, transcript: str) -> None:
        self.transcript = transcript

    def transcribe(self, _audio: AudioInput) -> str:
        return self.transcript


class _LanguageDetector:
    is_available = True

    def __init__(self, language: str) -> None:
        self.language = language

    def detect_language(self, _text: str) -> str:
        return self.language


class _LocalSpeechProvider(_SpeechProvider):
    provider_name = "local-test"
    processing_location = "local"
    is_available = True


class VoiceCaseServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.db_patch = patch.object(database, "DB_PATH", Path(self.temp_dir.name) / "voice-case.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        database.init_db()

    def test_unconfigured_audio_provider_returns_unavailable_without_a_transcript(self) -> None:
        result = VoiceCaseService().transcribe_audio(AudioInput(b"audio", "audio/webm"))

        self.assertEqual(result.status, VoiceProcessingStatus.PROVIDER_UNAVAILABLE)
        self.assertIsNone(result.transcript)
        self.assertIsNone(result.case_state)

    def test_injected_provider_uses_existing_pipeline_without_persisting_draft(self) -> None:
        service = VoiceCaseService(speech_to_text_provider=_SpeechProvider("Mere landlord ne deposit wapas nahi kiya."))

        result = service.transcribe_audio(AudioInput(b"audio", "audio/webm"))

        self.assertEqual(result.status, VoiceProcessingStatus.SUCCESS)
        self.assertEqual(result.language.value if result.language else None, "hinglish")
        self.assertEqual(result.case_state.initialStatement if result.case_state else None, result.transcript)
        self.assertIsNone(get_case(result.case_state.id))

    def test_configured_local_model_is_reported_available_only_when_runtime_and_files_exist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory)
            (model_path / "model.bin").write_bytes(b"model")
            (model_path / "config.json").write_text("{}", encoding="utf-8")
            (model_path / "tokenizer.json").write_text("{}", encoding="utf-8")
            with patch.dict(os.environ, {"LAWSENSE_LOCAL_WHISPER_MODEL": str(model_path)}):
                with patch("app.engines.voice.providers.importlib.util.find_spec", return_value=object()):
                    service = build_voice_case_service()
                    self.assertTrue(service.speech_to_text_available)
                    self.assertEqual(service.speech_to_text_provider_name, "faster-whisper")
                    self.assertEqual(service.speech_to_text_processing_location, "local")

    def test_unavailable_local_provider_does_not_report_local_processing(self) -> None:
        class UnavailableLocalProvider(_LocalSpeechProvider):
            is_available = False

        service = VoiceCaseService(speech_to_text_provider=UnavailableLocalProvider("draft"))

        self.assertFalse(service.speech_to_text_available)
        self.assertIsNone(service.speech_to_text_provider_name)
        self.assertEqual(service.speech_to_text_processing_location, "none")

    def test_hindi_and_hinglish_transcripts_have_case_state_previews_without_saving(self) -> None:
        service = VoiceCaseService()
        hindi = service.preview_transcript("मेरे मकान मालिक ने जमा राशि वापस नहीं की।")
        hinglish = service.preview_transcript("Mere landlord ne deposit wapas nahi kiya.")

        self.assertEqual(hindi.status, VoiceProcessingStatus.SUCCESS)
        self.assertEqual(hindi.language.value if hindi.language else None, "hindi")
        self.assertEqual(hinglish.status, VoiceProcessingStatus.SUCCESS)
        self.assertEqual(hinglish.language.value if hinglish.language else None, "hinglish")
        self.assertIsNone(get_case(hindi.case_state.id if hindi.case_state else "missing"))

    def test_transcript_review_is_ephemeral_until_explicit_commit(self) -> None:
        case = create_case_from_statement(initial_statement="My landlord kept my deposit.")
        saved_before_review = get_case(case.id)

        preview = VoiceCaseService().preview_transcript(
            "He sent me repeated threats yesterday.",
            case_id=case.id,
        )

        self.assertEqual(preview.status, VoiceProcessingStatus.SUCCESS)
        self.assertIsNotNone(preview.case_state)
        self.assertEqual(get_case(case.id), saved_before_review)

        updated, _source_id, _language = VoiceCaseService().add_reviewed_transcript(
            case.id,
            "He sent me repeated threats yesterday.",
        )
        self.assertNotEqual(updated, saved_before_review)
        self.assertTrue(get_case(case.id).initialStatement.endswith("He sent me repeated threats yesterday."))

    def test_reviewed_transcript_keeps_separate_voice_provenance_and_refreshes_analysis(self) -> None:
        case = create_case_from_statement(initial_statement="My landlord kept my deposit.")

        updated, source_id, language = VoiceCaseService().add_reviewed_transcript(
            case.id,
            "He sent me repeated threats yesterday.",
        )

        self.assertEqual(language.value, "english")
        self.assertTrue(updated.initialStatement.endswith("He sent me repeated threats yesterday."))
        evidence = next(item for item in updated.evidence if item.id == source_id)
        self.assertEqual(evidence.source, "user")
        self.assertTrue(evidence.title.startswith("User-reviewed voice transcript"))
        self.assertTrue(evidence.extractedFacts)
        added_facts = [fact for fact in updated.facts if source_id in fact.sourceIds]
        self.assertTrue(added_facts)
        self.assertIsNotNone(updated.analysis)
        self.assertEqual(get_case(case.id).analysis, updated.analysis)

    def test_follow_up_statement_can_resolve_narrative_clarification_questions(self) -> None:
        case = create_case_from_statement(
            initial_statement="My landlord did not return my security deposit."
        )
        self.assertTrue(any("reason given" in item for item in case.unknowns))

        updated, _source_id, _language = VoiceCaseService().add_reviewed_transcript(
            case.id,
            "This happened in Pune. I have a rental agreement and a bank transfer receipt. "
            "The landlord said it was for wall damage.",
        )

        self.assertFalse(any("reason given" in item for item in updated.unknowns))
        self.assertFalse(any("rental agreement" in item for item in updated.unknowns))
        self.assertFalse(any("proof of the deposit" in item for item in updated.unknowns))

    def test_unsupported_language_is_not_extracted_or_committed(self) -> None:
        service = VoiceCaseService(language_detector=_LanguageDetector("french"))
        preview = service.preview_transcript("Bonjour, mon propriétaire a gardé le dépôt.")

        self.assertEqual(preview.status, VoiceProcessingStatus.UNSUPPORTED)
        self.assertIsNone(preview.case_state)


if __name__ == "__main__":
    unittest.main()
