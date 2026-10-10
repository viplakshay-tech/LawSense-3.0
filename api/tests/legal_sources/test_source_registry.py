from __future__ import annotations

import unittest
from dataclasses import replace
from datetime import date, datetime, timezone

from app.engines.legal_knowledge import (
    Authority,
    InMemoryLegalKnowledgeStore,
    Jurisdiction,
    KnowledgeStatus,
    LegalSource,
    SourceAuthorityTier,
    SourceReference,
    SourceVersion,
)
from app.engines.legal_sources import (
    LegalSourceRegistry,
    RegistrySourceVersion,
    SourceRegistryError,
    SourceRegistryValidationError,
    SourceType,
    validate_registry_version,
)


RETRIEVED_AT = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)
SOURCE_URL = "https://registry-fixture.invalid/law/alpha"


def make_catalog(
    *,
    source_id: str = "source-alpha",
    jurisdiction_id: str | None = "jurisdiction-test",
    authority_tier: SourceAuthorityTier = SourceAuthorityTier.TIER_1_PRIMARY_OFFICIAL,
) -> tuple[Authority, Jurisdiction, LegalSource]:
    authority = Authority(
        id="authority-test",
        title="Fixture authority",
        authority_type="fixture-only",
    )
    jurisdiction = Jurisdiction(
        id=jurisdiction_id or "jurisdiction-test",
        title="Fixture jurisdiction",
        country="Fixture country",
        jurisdiction_basis="Fixture-only test scope",
    )
    source = LegalSource(
        id=source_id,
        title="Fixture source identity",
        authority=authority.id,
        authority_tier=authority_tier,
        publisher_name="Fixture publisher",
        jurisdiction=jurisdiction_id,
    )
    return authority, jurisdiction, source


def make_version(
    source: LegalSource,
    *,
    version_id: str = "source-alpha-v1",
    version: str = "fixture-version-1",
    supersedes: str | None = None,
    status: KnowledgeStatus = KnowledgeStatus.VERIFIED,
    source_type: SourceType | None = SourceType.LEGISLATION,
    canonical_reference: str | None = "Fixture Act, section 1",
    source_url: str | None = SOURCE_URL,
    resource_identifier: str | None = None,
    jurisdiction: str | None = None,
    authority_tier: SourceAuthorityTier | None = None,
) -> RegistrySourceVersion:
    return RegistrySourceVersion(
        id=version_id,
        title="Fixture Act",
        source=source.id,
        authority=source.authority,
        jurisdiction=jurisdiction if jurisdiction is not None else source.jurisdiction,
        source_url=source_url,
        version=version,
        effective_from=date(2026, 1, 1),
        retrieved_at=RETRIEVED_AT,
        status=status,
        supersedes=supersedes,
        provenance=(
            SourceReference(
                source_id=source.id,
                retrieval_time=RETRIEVED_AT,
                page_section_reference="Fixture Act source record",
                source_url=source_url,
            ),
        ),
        source_type=source_type,
        canonical_reference=canonical_reference,
        resource_identifier=resource_identifier,
        publication_date=date(2025, 12, 15),
        publisher_name="Fixture publisher",
        authority_tier=authority_tier or source.authority_tier,
    )


class LegalSourceRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = InMemoryLegalKnowledgeStore()
        self.registry = LegalSourceRegistry(self.store)
        self.authority, self.jurisdiction, self.source = make_catalog()
        self.version = make_version(self.source)

    def test_register_uses_existing_legal_knowledge_catalog_models(self) -> None:
        entry = self.registry.register(
            self.source,
            self.version,
            authority=self.authority,
            jurisdiction=self.jurisdiction,
        )

        self.assertIs(self.store.get(self.authority.id), self.authority)
        self.assertIs(self.store.get(self.jurisdiction.id), self.jurisdiction)
        self.assertIs(self.store.get(self.source.id), self.source)
        self.assertIs(self.store.get(self.version.id), self.version)
        self.assertEqual(entry.authority, self.authority)
        self.assertEqual(entry.jurisdiction, self.jurisdiction)
        self.assertEqual(entry.id, self.source.id)

    def test_preexisting_legal_knowledge_records_can_be_reused(self) -> None:
        self.store.add_many((self.authority, self.jurisdiction))

        entry = self.registry.register(self.source, self.version)

        self.assertTrue(entry.is_authoritative)
        self.assertEqual(len(self.registry.legal_sources()), 1)
        self.assertEqual(self.store.items, (self.authority, self.jurisdiction, self.source, self.version))

    def test_entry_exposes_explicit_registry_metadata_without_rewriting_it(self) -> None:
        entry = self.registry.register(
            self.source,
            self.version,
            authority=self.authority,
            jurisdiction=self.jurisdiction,
        )

        self.assertEqual(entry.source_type, SourceType.LEGISLATION)
        self.assertEqual(entry.title, "Fixture Act")
        self.assertEqual(entry.publisher_name, "Fixture publisher")
        self.assertEqual(entry.canonical_reference, "Fixture Act, section 1")
        self.assertEqual(entry.source_url, SOURCE_URL)
        self.assertEqual(entry.publication_date, date(2025, 12, 15))
        self.assertEqual(entry.effective_date, date(2026, 1, 1))
        self.assertEqual(entry.version, "fixture-version-1")
        self.assertEqual(entry.retrieved_at, RETRIEVED_AT)
        self.assertEqual(entry.verification_status, KnowledgeStatus.VERIFIED)
        self.assertEqual(entry.authority_tier, SourceAuthorityTier.TIER_1_PRIMARY_OFFICIAL)
        self.assertEqual(entry.provenance, self.version.provenance)
        self.assertEqual(entry.current_version.resource_identifier, None)

    def test_source_type_covers_official_legal_and_assistance_material(self) -> None:
        self.assertTrue(
            {
                "legislation",
                "rules_regulations",
                "government_notification",
                "supreme_court_material",
                "high_court_material",
                "official_procedural_resource",
                "ecourts",
                "legal_aid_resource",
                "official_complaint_portal",
            }.issubset({source_type.value for source_type in SourceType})
        )
        with self.assertRaises(SourceRegistryValidationError):
            validate_registry_version(replace(self.version, source_type="made_up"))

    def test_unverified_records_can_be_retained_but_never_authoritative(self) -> None:
        version = make_version(
            self.source,
            status=KnowledgeStatus.UNVERIFIED,
            source_type=None,
            canonical_reference=None,
            source_url=None,
        )
        entry = self.registry.register(
            self.source,
            version,
            authority=self.authority,
            jurisdiction=self.jurisdiction,
        )

        self.assertEqual(entry.verification_status, KnowledgeStatus.UNVERIFIED)
        self.assertFalse(entry.is_authoritative)
        self.assertEqual(self.registry.authoritative_sources(), ())
        self.assertIsNone(entry.source_url)
        self.assertIsNone(entry.canonical_reference)

    def test_authoritative_requires_verification_and_official_tier(self) -> None:
        for tier in (
            SourceAuthorityTier.TIER_3_SECONDARY_VERIFIED,
            SourceAuthorityTier.TIER_4_UNVERIFIED_GENERAL,
        ):
            with self.subTest(tier=tier):
                authority, jurisdiction, source = make_catalog(
                    source_id=f"source-tier-{tier.value}", authority_tier=tier
                )
                version = make_version(
                    source,
                    version_id=f"{source.id}-v1",
                    authority_tier=tier,
                )
                registry = LegalSourceRegistry()
                entry = registry.register(
                    source,
                    version,
                    authority=authority,
                    jurisdiction=jurisdiction,
                )
                self.assertFalse(entry.is_authoritative)
                self.assertEqual(registry.authoritative_sources(), ())

        unverified = make_version(self.source, status=KnowledgeStatus.UNVERIFIED)
        self.assertFalse(unverified.is_authoritative)

    def test_verified_snapshot_requires_explicit_core_metadata_and_provenance(self) -> None:
        incomplete_versions = (
            replace(make_version(self.source), source_type=None),
            replace(make_version(self.source), canonical_reference=None),
            make_version(self.source, source_url=None, resource_identifier=None),
            replace(make_version(self.source), jurisdiction=None),
            replace(make_version(self.source), authority_tier=None),
            replace(make_version(self.source), retrieved_at=None),
        )
        for version in incomplete_versions:
            with self.subTest(version=version):
                with self.assertRaises(SourceRegistryValidationError):
                    validate_registry_version(version)

    def test_resource_identifier_can_be_used_without_inventing_a_url(self) -> None:
        version = make_version(
            self.source,
            source_url=None,
            resource_identifier="urn:fixture:authority:document:alpha",
            status=KnowledgeStatus.UNVERIFIED,
        )
        entry = self.registry.register(
            self.source,
            version,
            authority=self.authority,
            jurisdiction=self.jurisdiction,
        )

        self.assertIsNone(entry.source_url)
        self.assertEqual(
            entry.resource_identifier,
            "urn:fixture:authority:document:alpha",
        )

    def test_urls_must_be_explicit_absolute_http_or_https_urls(self) -> None:
        for malformed in ("", "registry/path", "javascript:alert(1)", "https:///missing-host"):
            with self.subTest(url=malformed):
                with self.assertRaises(SourceRegistryValidationError):
                    validate_registry_version(
                        make_version(self.source, source_url=malformed)
                    )

    def test_registry_resolves_jurisdiction_and_authority_instead_of_fabricating_them(self) -> None:
        with self.assertRaises(SourceRegistryValidationError):
            self.registry.register(self.source, self.version)
        self.assertEqual(self.store.items, ())

        with self.assertRaises(SourceRegistryValidationError):
            self.registry.register(
                self.source,
                self.version,
                authority=self.authority,
            )
        self.assertEqual(self.store.items, ())

    def test_registry_version_preserves_append_only_supersession_history(self) -> None:
        first = self.registry.register(
            self.source,
            self.version,
            authority=self.authority,
            jurisdiction=self.jurisdiction,
        )
        second_version = make_version(
            self.source,
            version_id="source-alpha-v2",
            version="fixture-version-2",
            supersedes=self.version.id,
            source_url="https://registry-fixture.invalid/law/alpha-v2",
            canonical_reference="Fixture Act, section 1 (amended)",
        )
        second = self.registry.append_version(second_version)

        self.assertIs(self.store.get(self.version.id), self.version)
        self.assertEqual(first.version, "fixture-version-1")
        self.assertEqual(second.version, "fixture-version-2")
        self.assertEqual(second.current_version.supersedes, self.version.id)
        self.assertEqual(self.registry.versions(self.source.id), (self.version, second_version))
        self.assertEqual(second.canonical_reference, "Fixture Act, section 1 (amended)")

    def test_updates_must_supersede_current_version_and_cannot_branch_or_replace_ids(self) -> None:
        self.registry.register(
            self.source,
            self.version,
            authority=self.authority,
            jurisdiction=self.jurisdiction,
        )
        second = make_version(
            self.source,
            version_id="source-alpha-v2",
            version="fixture-version-2",
            supersedes=self.version.id,
        )
        self.registry.append_version(second)

        with self.assertRaises(SourceRegistryError):
            self.registry.append_version(
                make_version(
                    self.source,
                    version_id="source-alpha-v3-branch",
                    version="fixture-version-3",
                    supersedes=self.version.id,
                )
            )
        with self.assertRaises(SourceRegistryError):
            self.registry.append_version(replace(second, title="Replacement"))
        with self.assertRaises(SourceRegistryError):
            self.registry.register(
                self.source,
                self.version,
                authority=self.authority,
                jurisdiction=self.jurisdiction,
            )
        self.assertEqual(len(self.registry.versions(self.source.id)), 2)

    def test_version_updates_require_registered_source_authority_and_jurisdiction(self) -> None:
        self.registry.register(
            self.source,
            self.version,
            authority=self.authority,
            jurisdiction=self.jurisdiction,
        )

        wrong_authority = replace(
            make_version(
                self.source,
                version_id="source-alpha-v2",
                version="fixture-version-2",
                supersedes=self.version.id,
            ),
            authority="different-authority",
        )
        with self.assertRaises(SourceRegistryError):
            self.registry.append_version(wrong_authority)

        wrong_jurisdiction = make_version(
            self.source,
            version_id="source-alpha-v2-jurisdiction",
            version="fixture-version-2",
            supersedes=self.version.id,
            jurisdiction="unknown-jurisdiction",
        )
        with self.assertRaises(SourceRegistryValidationError):
            self.registry.append_version(wrong_jurisdiction)
        self.assertEqual(len(self.registry.versions(self.source.id)), 1)

    def test_failed_registration_does_not_partially_write_catalog_or_source(self) -> None:
        invalid = make_version(self.source, canonical_reference=None)
        with self.assertRaises(SourceRegistryValidationError):
            self.registry.register(
                self.source,
                invalid,
                authority=self.authority,
                jurisdiction=self.jurisdiction,
            )
        self.assertEqual(self.store.items, ())

    def test_provenance_must_trace_the_same_source(self) -> None:
        bad = replace(
            self.version,
            provenance=(
                SourceReference(
                    source_id="other-source",
                    retrieval_time=RETRIEVED_AT,
                    page_section_reference="fixture locator",
                ),
            ),
        )
        with self.assertRaises(SourceRegistryValidationError):
            validate_registry_version(bad)

    def test_verified_provenance_must_preserve_snapshot_retrieval_time(self) -> None:
        bad = replace(
            self.version,
            retrieved_at=datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc),
        )
        with self.assertRaises(SourceRegistryValidationError):
            validate_registry_version(bad)

    def test_publication_and_effective_dates_reject_datetime_values(self) -> None:
        with self.assertRaises(SourceRegistryValidationError):
            validate_registry_version(
                replace(self.version, publication_date=RETRIEVED_AT)
            )
        with self.assertRaises(SourceRegistryValidationError):
            validate_registry_version(
                replace(self.version, effective_from=RETRIEVED_AT)
            )

    def test_retrieval_jobs_can_enumerate_current_sources_and_filter_authority(self) -> None:
        self.registry.register(
            self.source,
            self.version,
            authority=self.authority,
            jurisdiction=self.jurisdiction,
        )
        draft_source = LegalSource(
            id="source-draft",
            title="Unverified fixture source",
            authority=self.authority.id,
            authority_tier=SourceAuthorityTier.TIER_1_PRIMARY_OFFICIAL,
            jurisdiction=self.jurisdiction.id,
        )
        draft = make_version(
            draft_source,
            version_id="source-draft-v1",
            status=KnowledgeStatus.WITHDRAWN,
            source_type=None,
            canonical_reference=None,
            source_url=None,
        )
        self.registry.register(draft_source, draft)

        self.assertEqual(
            [entry.id for entry in self.registry.authoritative_sources(
                jurisdiction=self.jurisdiction.id,
                source_type=SourceType.LEGISLATION,
            )],
            [self.source.id],
        )
        self.assertEqual(
            [entry.id for entry in self.registry.retrieval_candidates()],
            [self.source.id],
        )

    def test_non_registry_source_version_remains_shared_legal_knowledge_item(self) -> None:
        self.registry.register(
            self.source,
            self.version,
            authority=self.authority,
            jurisdiction=self.jurisdiction,
        )
        self.assertIsInstance(self.store.get(self.version.id), SourceVersion)


if __name__ == "__main__":
    unittest.main()
