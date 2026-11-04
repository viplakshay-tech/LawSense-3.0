from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.engines.legal_sources.governance_models import SourceFreshnessStatus
from app.engines.legal_sources.source_catalog import (
    SourceCatalogError,
    load_source_catalog,
    record_source_freshness_review,
)


class LegalSourceCatalogTests(unittest.TestCase):
    def _write_catalog(self, directory: str, *, verified: bool = True) -> Path:
        path = Path(directory) / "sources.json"
        record = {
            "id": "source-test-act",
            "title": "Test Act",
            "publisher": "Government of India",
            "officialUrl": "https://example.gov.in/test-act.pdf",
            "version": "Act No. 1 of 2020",
            "verificationStatus": "verified_official" if verified else "unverified",
            "verificationDate": "2026-11-04" if verified else None,
            "verificationNote": "Matched the official title and Act number against the primary source." if verified else None,
            "retrievedAt": "2026-11-04T10:00:00+00:00",
            "freshnessStatus": "unknown",
            "freshnessCheckedAt": None,
            "freshnessEvidence": None,
        }
        path.write_text(json.dumps({"catalogVersion": "2026-11-04", "sources": [record]}, indent=2), encoding="utf-8")
        return path

    def test_catalog_rejects_non_government_hosts_and_credentialed_urls(self) -> None:
        for url in (
            "https://indiacode.nic.in.attacker.example/fake-act",
            "https://user@indiacode.nic.in/fake-act",
            "http://indiacode.nic.in/fake-act",
            "https://indiacode.nic.in:8443/fake-act",
        ):
            with self.subTest(url=url), tempfile.TemporaryDirectory() as directory:
                path = self._write_catalog(directory)
                catalog = json.loads(path.read_text(encoding="utf-8"))
                catalog["sources"][0]["officialUrl"] = url
                path.write_text(json.dumps(catalog), encoding="utf-8")
                with self.assertRaisesRegex(SourceCatalogError, "official government domain"):
                    load_source_catalog(path)

    def test_current_review_requires_matching_snapshot_version_and_timestamps(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_catalog(directory)
            reviewed = record_source_freshness_review(
                "source-test-act",
                SourceFreshnessStatus.CURRENT,
                checked_at=datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc),
                retrieved_at=datetime(2026, 11, 4, 11, 30, tzinfo=timezone.utc),
                version="Act No. 1 of 2020; official consolidated text checked 2026-11-04",
                evidence=(
                    "Compared the local provision text against the official consolidated Act "
                    "and reviewed all published amendments and commencement notifications."
                ),
                path=path,
            )
            self.assertEqual(reviewed.freshness_status, SourceFreshnessStatus.CURRENT)
            self.assertEqual(reviewed.retrieved_at, datetime(2026, 11, 4, 11, 30, tzinfo=timezone.utc))
            self.assertEqual(reviewed.version, "Act No. 1 of 2020; official consolidated text checked 2026-11-04")
            self.assertEqual(reviewed.freshness_checked_at, datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc))

    def test_stale_review_preserves_the_old_local_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_catalog(directory)
            before = load_source_catalog(path)["source-test-act"]
            reviewed = record_source_freshness_review(
                "source-test-act",
                "stale",
                checked_at=datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc),
                evidence=(
                    "The official publication contains a later amendment not reflected in "
                    "the local source snapshot; affected sections need reconciliation."
                ),
                path=path,
            )
            self.assertEqual(reviewed.freshness_status, SourceFreshnessStatus.STALE)
            self.assertEqual(reviewed.retrieved_at, before.retrieved_at)
            self.assertEqual(reviewed.version, before.version)

    def test_unknown_review_clears_review_timestamp_and_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_catalog(directory)
            record_source_freshness_review(
                "source-test-act",
                "current",
                checked_at=datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc),
                retrieved_at=datetime(2026, 11, 4, 11, 30, tzinfo=timezone.utc),
                version="Act No. 1 of 2020; checked",
                evidence="Compared the local Act text with the official source and checked amendments.",
                path=path,
            )
            reset = record_source_freshness_review("source-test-act", "unknown", path=path)
            self.assertEqual(reset.freshness_status, SourceFreshnessStatus.UNKNOWN)
            self.assertIsNone(reset.freshness_checked_at)
            self.assertIsNone(reset.freshness_evidence)

    def test_freshness_review_cannot_precede_retrieval_or_skip_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_catalog(directory)
            with self.assertRaisesRegex(SourceCatalogError, "must not precede"):
                record_source_freshness_review(
                    "source-test-act",
                    "current",
                    checked_at=datetime(2026, 11, 4, 9, 0, tzinfo=timezone.utc),
                    retrieved_at=datetime(2026, 11, 4, 10, 0, tzinfo=timezone.utc),
                    version="Act No. 1 of 2020",
                    evidence="A sufficiently detailed review evidence note for the source.",
                    path=path,
                )
            with self.assertRaisesRegex(SourceCatalogError, "at least 30 characters"):
                record_source_freshness_review(
                    "source-test-act",
                    "current",
                    checked_at=datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc),
                    retrieved_at=datetime(2026, 11, 4, 11, 0, tzinfo=timezone.utc),
                    version="Act No. 1 of 2020",
                    evidence="checked",
                    path=path,
                )

    def test_unverified_source_cannot_receive_freshness_review(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_catalog(directory, verified=False)
            with self.assertRaisesRegex(SourceCatalogError, "Verify the source identity"):
                record_source_freshness_review(
                    "source-test-act",
                    "stale",
                    checked_at=datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc),
                    evidence="The official publication has a newer version than the local snapshot.",
                    path=path,
                )

    def test_catalog_rejects_current_status_without_review_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_catalog(directory)
            catalog = json.loads(path.read_text(encoding="utf-8"))
            catalog["sources"][0]["freshnessStatus"] = "current"
            catalog["sources"][0]["freshnessCheckedAt"] = "2026-11-04T12:00:00+00:00"
            catalog["sources"][0]["freshnessEvidence"] = None
            path.write_text(json.dumps(catalog), encoding="utf-8")
            with self.assertRaisesRegex(SourceCatalogError, "requires retrievedAt"):
                load_source_catalog(path)


if __name__ == "__main__":
    unittest.main()
