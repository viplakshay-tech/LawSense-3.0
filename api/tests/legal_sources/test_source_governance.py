from __future__ import annotations

import unittest
from datetime import date, datetime, timezone

from app.engines.legal_sources import (
    DuplicateSourceIdError,
    GovernedLegalSource,
    SourceApplicabilityStatus,
    SourceFreshnessStatus,
    SourceGovernanceRegistry,
    SourceGovernanceValidationError,
    SourceVerificationStatus,
    RetrievedSourceMaterial,
    record_retrieval,
    validate_governed_source,
    validate_source_jurisdiction,
)


RETRIEVED_AT = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)


def make_verified_source(**overrides: object) -> GovernedLegalSource:
    fields: dict[str, object] = {
        "source_id": "india-code-fixture-001",
        "authority": "Government of India",
        "title": "Fixture Act",
        "jurisdiction": "IN",
        "source_type": "legislation",
        "official_reference": "Fixture Act, 2026, Act 1",
        "source_url": "https://sources.example.invalid/acts/fixture-1",
        "reference": "Act 1 of 2026",
        "version": "2026-01",
        "publication_date": date(2026, 1, 2),
        "effective_date": date(2026, 2, 1),
        "retrieved_at": RETRIEVED_AT,
        "verification_status": SourceVerificationStatus.VERIFIED,
        "verification_evidence": "Manually matched title and citation to the official record.",
    }
    fields.update(overrides)
    return GovernedLegalSource(**fields)  # type: ignore[arg-type]


class SourceGovernanceTests(unittest.TestCase):
    def test_verified_source_requires_and_preserves_explicit_evidence(self) -> None:
        source = make_verified_source()

        validate_governed_source(source)
        registry = SourceGovernanceRegistry((source,))

        self.assertIs(registry.get(source.source_id), source)
        self.assertEqual(source.verification_status, SourceVerificationStatus.VERIFIED)
        self.assertEqual(source.source_url, "https://sources.example.invalid/acts/fixture-1")

    def test_unverified_is_the_default_and_is_registerable(self) -> None:
        source = GovernedLegalSource(source_id="unreviewed-record")

        validate_governed_source(source)
        SourceGovernanceRegistry((source,))

        self.assertEqual(source.verification_status, SourceVerificationStatus.UNVERIFIED)
        self.assertEqual(source.freshness_status, SourceFreshnessStatus.UNKNOWN)

    def test_stale_is_independent_of_verification(self) -> None:
        source = make_verified_source(freshness_status=SourceFreshnessStatus.STALE)

        validate_governed_source(source)

        self.assertEqual(source.verification_status, SourceVerificationStatus.VERIFIED)
        self.assertEqual(source.freshness_status, SourceFreshnessStatus.STALE)

    def test_missing_metadata_is_reported_and_cannot_be_called_verified(self) -> None:
        incomplete = GovernedLegalSource(source_id="incomplete-record")

        validate_governed_source(incomplete)
        self.assertEqual(
            incomplete.missing_verification_metadata,
            (
                "authority",
                "title",
                "jurisdiction",
                "source_type",
                "official_reference or source_url or reference",
                "retrieved_at",
            ),
        )

        with self.assertRaisesRegex(SourceGovernanceValidationError, "requires explicit"):
            validate_governed_source(
                GovernedLegalSource(
                    source_id="incomplete-verified-record",
                    verification_status=SourceVerificationStatus.VERIFIED,
                    verification_evidence="Reviewer supplied evidence",
                )
            )

    def test_verification_requires_evidence_even_when_other_metadata_is_complete(self) -> None:
        with self.assertRaisesRegex(SourceGovernanceValidationError, "verification_evidence"):
            validate_governed_source(make_verified_source(verification_evidence=None))

    def test_jurisdiction_mismatch_is_rejected_without_inference(self) -> None:
        source = make_verified_source(jurisdiction="IN-KA")

        with self.assertRaisesRegex(SourceGovernanceValidationError, "does not match"):
            validate_source_jurisdiction(source, "IN-DL")

    def test_retrieval_does_not_establish_applicability(self) -> None:
        source = GovernedLegalSource(source_id="retrieved-source")
        retrieved_source = record_retrieval(
            source,
            RetrievedSourceMaterial(
                source_id=source.source_id,
                retrieved_at=RETRIEVED_AT,
                payload=b"local fixture payload",
                reference="official record 7",
            ),
        )

        self.assertEqual(
            retrieved_source.applicability_status,
            SourceApplicabilityStatus.APPLICABILITY_NOT_ESTABLISHED,
        )
        self.assertEqual(retrieved_source.verification_status, SourceVerificationStatus.UNVERIFIED)
        self.assertEqual(retrieved_source.freshness_status, SourceFreshnessStatus.UNKNOWN)
        self.assertEqual(retrieved_source.retrieved_at, RETRIEVED_AT)
        self.assertEqual(retrieved_source.reference, "official record 7")
        potentially_relevant = make_verified_source(
            source_id="potential-source",
            applicability_status=SourceApplicabilityStatus.POTENTIALLY_RELEVANT,
        )
        validate_governed_source(potentially_relevant)
        self.assertEqual(
            potentially_relevant.applicability_status,
            SourceApplicabilityStatus.POTENTIALLY_RELEVANT,
        )

    def test_duplicate_source_ids_are_rejected_atomically(self) -> None:
        existing = GovernedLegalSource(source_id="duplicate")
        registry = SourceGovernanceRegistry((existing,))

        with self.assertRaises(DuplicateSourceIdError):
            registry.add(GovernedLegalSource(source_id="duplicate", title="replacement"))
        self.assertIs(registry.get("duplicate"), existing)

        with self.assertRaises(DuplicateSourceIdError):
            SourceGovernanceRegistry(
                (
                    GovernedLegalSource(source_id="first"),
                    GovernedLegalSource(source_id="first"),
                )
            )

    def test_invalid_url_is_rejected_instead_of_normalized_or_fabricated(self) -> None:
        with self.assertRaisesRegex(SourceGovernanceValidationError, "explicit absolute"):
            validate_governed_source(make_verified_source(source_url="www.example.invalid/act"))


if __name__ == "__main__":
    unittest.main()
