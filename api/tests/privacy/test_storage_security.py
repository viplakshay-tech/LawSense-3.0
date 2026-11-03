from __future__ import annotations

import os
import stat
import tempfile
import unittest
from pathlib import Path

from app.core.storage_security import ensure_private_directory, prepare_private_file
from app.services.privacy.export import write_local_export


@unittest.skipUnless(os.name == "posix", "POSIX permission bits are not portable to Windows ACLs")
class LocalStoragePermissionTests(unittest.TestCase):
    def test_storage_directories_are_owner_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = ensure_private_directory(Path(directory) / "private-data")
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)

    def test_database_file_is_created_and_restricted_to_owner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = prepare_private_file(Path(directory) / "cases.sqlite")
            self.assertTrue(target.is_file())
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)

            # Existing databases are tightened too, rather than only newly-created ones.
            target.chmod(0o644)
            prepare_private_file(target)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)

    def test_local_json_export_is_owner_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = write_local_export(Path(directory) / "case-export.json", {"case": "private"})
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertIn('"case": "private"', target.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
