from __future__ import annotations

import hashlib
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.db import database
from app.schemas.case_state import CaseState
from app.services.privacy.case_deletion import delete_case_locally


CASE_ID = "11111111-1111-4111-8111-111111111111"


class CaseDeletionServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db_patch = patch.object(database, "DB_PATH", self.root / "lawsense.sqlite")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        database.init_db()
        self.data_dir = self.root / "private-data"
        self.case = CaseState(
            id=CASE_ID,
            initialStatement="Test-only legal case narrative.",
            metadata={
                "createdAt": "2026-10-27T00:00:00+00:00",
                "updatedAt": "2026-10-27T00:00:00+00:00",
            },
        )
        database.save_case(self.case)

    def _document_directory(self) -> Path:
        key = hashlib.sha256(CASE_ID.encode("utf-8")).hexdigest()[:32]
        directory = self.data_dir / "documents" / key
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def test_deletes_case_drafts_packages_and_uploaded_documents(self) -> None:
        document_directory = self._document_directory()
        stored_document = document_directory / "agreement.pdf"
        stored_document.write_bytes(b"synthetic upload bytes")

        with database.get_connection() as connection:
            connection.execute(
                "INSERT INTO document_drafts (id, case_id, draft_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("draft-1", CASE_ID, '{"content":"synthetic draft"}', "t0", "t0"),
            )
            connection.execute(
                "INSERT INTO document_packages (id, case_id, package_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("package-1", CASE_ID, '{"documents":[]}', "t0", "t0"),
            )
            connection.commit()

        result = delete_case_locally(CASE_ID, data_dir=self.data_dir)

        self.assertTrue(result.deleted)
        self.assertTrue(result.uploaded_documents_removed)
        self.assertIsNone(database.get_case(CASE_ID))
        self.assertFalse(stored_document.exists())
        self.assertFalse(document_directory.exists())
        with database.get_connection() as connection:
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM document_drafts WHERE case_id = ?", (CASE_ID,)
            ).fetchone()[0], 0)
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM document_packages WHERE case_id = ?", (CASE_ID,)
            ).fetchone()[0], 0)
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM deleted_case_tombstones"
            ).fetchone()[0], 1)

        # An operation that started before deletion cannot restore stale data.
        with self.assertRaises(database.CasePermanentlyDeletedError):
            database.save_case(self.case)
        with self.assertRaises(database.CasePermanentlyDeletedError):
            database.save_document_draft(SimpleNamespace(caseId=CASE_ID))
        with self.assertRaises(database.CasePermanentlyDeletedError):
            database.save_document_package(SimpleNamespace(caseId=CASE_ID))

    def test_unknown_case_does_not_delete_an_unrelated_directory(self) -> None:
        unrelated = self.data_dir / "documents" / "unrelated"
        unrelated.mkdir(parents=True)
        sentinel = unrelated / "keep.txt"
        sentinel.write_text("keep", encoding="utf-8")

        result = delete_case_locally("22222222-2222-4222-8222-222222222222", data_dir=self.data_dir)

        self.assertFalse(result.deleted)
        self.assertTrue(sentinel.exists())
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")

    @unittest.skipUnless(hasattr(os, "symlink"), "Symbolic links are not available")
    def test_symlinked_case_document_directory_stops_deletion(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        sentinel = outside / "keep.txt"
        sentinel.write_text("keep", encoding="utf-8")
        documents_root = self.data_dir / "documents"
        documents_root.mkdir(parents=True)
        link = documents_root / hashlib.sha256(CASE_ID.encode("utf-8")).hexdigest()[:32]
        try:
            link.symlink_to(outside, target_is_directory=True)
        except OSError as exc:
            self.skipTest(f"Symlink creation is not permitted: {exc}")

        with self.assertRaises(ValueError):
            delete_case_locally(CASE_ID, data_dir=self.data_dir)

        self.assertIsNotNone(database.get_case(CASE_ID))
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")

    def test_cleanup_failure_is_reported_instead_of_claiming_all_bytes_removed(self) -> None:
        document_directory = self._document_directory()
        stored_document = document_directory / "private.pdf"
        stored_document.write_bytes(b"synthetic upload bytes")

        with patch(
            "app.services.privacy.case_deletion.delete_local_directory",
            side_effect=PermissionError("synthetic file lock"),
        ):
            result = delete_case_locally(CASE_ID, data_dir=self.data_dir)

        self.assertTrue(result.deleted)
        self.assertFalse(result.uploaded_documents_removed)
        self.assertIn("could not be fully deleted", result.cleanup_warning or "")
        self.assertIsNone(database.get_case(CASE_ID))
        pending = list((self.data_dir / "documents").glob("_lawsense_deletion_pending_*"))
        self.assertEqual(len(pending), 1)
        self.assertTrue((pending[0] / "private.pdf").exists())


if __name__ == "__main__":
    unittest.main()
