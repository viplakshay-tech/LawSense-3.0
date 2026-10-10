from __future__ import annotations

import hashlib
import io
import json
import logging
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.services.privacy import (
    AuditEvent,
    AuditOutcome,
    ConsentPurpose,
    ConsentState,
    DataCategory,
    PrivacyClassification,
    RetentionPolicy,
    SecureDataReference,
    SensitivityLevel,
    classify_sensitive_data,
    delete_expired_local_file,
    delete_local_directory,
    delete_local_file,
    document_sha256,
    file_sha256,
    log_privacy_event,
    reference_export_metadata,
    redact_structure,
    redact_text,
    safe_log_fields,
    stream_sha256,
    to_export_json,
    write_local_export,
)


NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


class PrivacyFoundationTests(unittest.TestCase):
    def test_document_sha256_for_bytes_file_and_stream(self) -> None:
        payload = b"local legal document bytes"
        expected = hashlib.sha256(payload).hexdigest()
        self.assertEqual(document_sha256(payload), expected)
        stream = io.BytesIO(payload)
        self.assertEqual(stream_sha256(stream, chunk_size=3), expected)
        self.assertFalse(stream.closed)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "document.bin"
            path.write_bytes(payload)
            self.assertEqual(file_sha256(path, chunk_size=4), expected)

    def test_classification_uses_hints_mapping_keys_and_common_patterns(self) -> None:
        result = classify_sensitive_data(
            {"legal_narrative": "Asha wrote to help@example.test", "postal_address": "hidden"}
        )
        self.assertEqual(
            result.categories,
            frozenset({DataCategory.LEGAL, DataCategory.LOCATION, DataCategory.CONTACT}),
        )
        self.assertEqual(result.sensitivity_level, SensitivityLevel.RESTRICTED)
        self.assertIn("pattern.email", result.signals)
        self.assertNotIn("help@example.test", repr(result))
        self.assertEqual(classify_sensitive_data(None, hints="document").categories, {DataCategory.DOCUMENT})
        narrative = classify_sensitive_data("This rental agreement includes monthly rent and a court filing.")
        self.assertEqual(narrative.categories, {DataCategory.LEGAL, DataCategory.FINANCIAL})

    def test_redaction_masks_identifiers_and_sensitive_mapping_fields(self) -> None:
        text = "Email help@example.test; PAN ABCDE1234F; mobile 9876543210."
        redacted = redact_text(text)
        self.assertNotIn("help@example.test", redacted)
        self.assertNotIn("ABCDE1234F", redacted)
        self.assertNotIn("9876543210", redacted)
        nested = redact_structure({"user_narrative": "full statement", "note": "mail a@b.test"})
        self.assertEqual(nested["user_narrative"], "[REDACTED]")
        self.assertNotIn("a@b.test", nested["note"])
        financial = "Card 4111 1111 1111 1111, rent ₹30,000."
        safe_financial = redact_text(financial)
        self.assertNotIn("4111", safe_financial)
        self.assertNotIn("30,000", safe_financial)

    def test_safe_logging_emits_only_fixed_metadata(self) -> None:
        classification = PrivacyClassification(frozenset({DataCategory.LEGAL, DataCategory.DOCUMENT}))
        reference = SecureDataReference(
            reference_id="asha-rao-sensitive-id",
            classification=classification,
            created_at=NOW,
            sha256="a" * 64,
        )
        fields = safe_log_fields(
            "document.processed",
            reference=reference,
            outcome="success",
            error=ValueError("raw legal narrative must not be logged"),
        )
        self.assertEqual(fields["event"], "document.processed")
        self.assertNotIn("asha-rao-sensitive-id", repr(fields))
        self.assertNotIn("raw legal narrative", repr(fields))
        self.assertEqual(fields["error_type"], "valueerror")
        with self.assertRaises(ValueError):
            SecureDataReference(
                reference_id="full legal document text",
                classification=classification,
                created_at=NOW,
            )

        class CapturingHandler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                self.record = record

        logger = logging.Logger("privacy-test")
        handler = CapturingHandler()
        logger.addHandler(handler)
        logged = log_privacy_event(logger, "document.processed", reference=reference)
        self.assertEqual(handler.record.getMessage(), "privacy_event")
        self.assertNotIn("legal", handler.record.getMessage())
        self.assertEqual(handler.record.privacy, logged)

    def test_metadata_models_validate_time_and_retention(self) -> None:
        consent = ConsentState(
            purpose=ConsentPurpose.LOCAL_STORAGE,
            granted=True,
            decided_at=NOW,
            consent_id="consent-1",
            categories=frozenset({DataCategory.DOCUMENT}),
        )
        policy = RetentionPolicy(policy_id="keep-30-days", retain_for_days=30)
        reference = SecureDataReference(
            reference_id="ref-1",
            classification=PrivacyClassification(frozenset({DataCategory.DOCUMENT})),
            created_at=NOW,
            retention=policy,
        )
        event = AuditEvent(
            event_type="data.deleted",
            action="delete_local_file",
            outcome=AuditOutcome.SUCCESS,
            occurred_at=NOW,
            reference_id=reference.reference_id,
            categories=reference.classification.categories,
            event_id="event-1",
        )
        self.assertTrue(consent.granted)
        self.assertEqual(policy.expiry_for(NOW), NOW + timedelta(days=30))
        self.assertFalse(policy.is_expired(NOW, now=NOW + timedelta(days=29)))
        self.assertTrue(policy.is_expired(NOW, now=NOW + timedelta(days=30)))
        self.assertEqual(event.reference_id, "ref-1")
        self.assertIn('"data.deleted"', to_export_json(event))
        with self.assertRaises(ValueError):
            RetentionPolicy(retain_for_days=1, expires_at=NOW)

    def test_local_exports_are_stable_and_do_not_include_document_bytes(self) -> None:
        reference = SecureDataReference(
            reference_id="ref-2",
            classification=PrivacyClassification(frozenset({DataCategory.DOCUMENT})),
            created_at=NOW,
            sha256="b" * 64,
            size_bytes=22,
            storage_key="opaque-key-2",
        )
        metadata = reference_export_metadata(reference)
        serialized = to_export_json(metadata)
        self.assertEqual(serialized, to_export_json(metadata))
        self.assertNotIn("document bytes", serialized)
        self.assertEqual(json.loads(serialized)["sha256"], "b" * 64)
        with tempfile.TemporaryDirectory() as directory:
            path = write_local_export(Path(directory) / "export.json", metadata)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), metadata)
            with self.assertRaises(FileExistsError):
                write_local_export(path, {"replace": True})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), metadata)
            write_local_export(path, {"replacement": True}, overwrite=True)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"replacement": True})

    def test_deletion_helpers_are_local_and_retention_aware(self) -> None:
        policy = RetentionPolicy(retain_for_days=1)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file_path = root / "temporary.dat"
            file_path.write_bytes(b"local data")
            self.assertFalse(delete_expired_local_file(file_path, policy, created_at=NOW, now=NOW))
            self.assertTrue(file_path.exists())
            self.assertTrue(delete_expired_local_file(file_path, policy, created_at=NOW, now=NOW + timedelta(days=1)))
            self.assertFalse(file_path.exists())
            self.assertFalse(delete_local_file(file_path))

            child = root / "child"
            child.mkdir()
            (child / "item").write_text("x", encoding="utf-8")
            self.assertTrue(delete_local_directory(child, within=root))
            self.assertFalse(child.exists())
            with self.assertRaises(ValueError):
                delete_local_directory(root, within=root)


if __name__ == "__main__":
    unittest.main()
