from __future__ import annotations

import unittest
from dataclasses import replace
from datetime import datetime, timezone

from app.engines.legal_knowledge import (
    Authority,
    InMemoryLegalKnowledgeStore,
    Jurisdiction,
    KnowledgeStatus,
    LegalDocument,
    LegalKnowledgeStoreError,
    LegalKnowledgeValidationError,
    LegalProvision,
    LegalSource,
    MockLegalSourceAdapter,
    SourceAuthorityTier,
    SourceReference,
    SourceVersion,
    get_provision,
    ingest_discovered_sources,
    search_legal_knowledge,
    validate_knowledge_item,
)


RETRIEVED_AT = datetime(2026, 1, 15, 12, 0, tzinfo=timezone.utc)


def make_catalog(
    *,
    source_id: str = "source-fixture",
    authority_tier: SourceAuthorityTier = SourceAuthorityTier.TIER_1_PRIMARY_OFFICIAL,
) -> tuple[Authority, Jurisdiction, LegalSource]:
    authority = Authority(id="authority-fixture", title="Fixture authority")
    jurisdiction = Jurisdiction(
        id="jurisdiction-fixture",
        title="Fixture jurisdiction",
        country="Fixture country",
        state="Fixture state",
        district="Fixture district",
        court_or_authority="Fixture venue",
        jurisdiction_basis="Fixture-only test scope",
    )
    source = LegalSource(
        id=source_id,
        title="Fixture source",
        authority=authority.id,
        authority_tier=authority_tier,
        publisher_name="Fixture publisher",
    )
    return authority, jurisdiction, source


def make_document(
    source: LegalSource,
    jurisdiction: Jurisdiction,
    authority: Authority,
    *,
    document_id: str = "document-fixture",
    version: str = "fixture-v1",
) -> LegalDocument:
    return LegalDocument(
        id=document_id,
        title="Fixture document",
        jurisdiction=jurisdiction.id,
        authority=authority.id,
        source=source.id,
        version=version,
        retrieved_at=RETRIEVED_AT,
        status=KnowledgeStatus.VERIFIED,
        search_text="fixture searchable content",
        provenance=(
            SourceReference(
                source_id=source.id,
                document_id=document_id,
                page_section_reference="fixture locator",
                retrieval_time=RETRIEVED_AT,
            ),
        ),
    )


def make_provision(
    source: LegalSource,
    jurisdiction: Jurisdiction,
    authority: Authority,
    document: LegalDocument,
    *,
    provision_id: str = "provision-fixture",
    version: str = "fixture-v1",
    supersedes: str | None = None,
    status: KnowledgeStatus = KnowledgeStatus.VERIFIED,
    text: str = "fixture searchable content",
) -> LegalProvision:
    return LegalProvision(
        id=provision_id,
        title="Fixture record",
        jurisdiction=jurisdiction.id,
        authority=authority.id,
        source=source.id,
        version=version,
        document_id=document.id,
        provision_reference="fixture reference",
        text=text,
        status=status,
        retrieved_at=RETRIEVED_AT,
        search_text=text,
        supersedes=supersedes,
        provenance=(
            SourceReference(
                source_id=source.id,
                document_id=document.id,
                provision_id=provision_id,
                page_section_reference="fixture locator",
                retrieval_time=RETRIEVED_AT,
            ),
        ),
    )


class LegalKnowledgeInfrastructureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.authority, self.jurisdiction, self.source = make_catalog()
        self.document = make_document(self.source, self.jurisdiction, self.authority)
        self.provision = make_provision(
            self.source, self.jurisdiction, self.authority, self.document
        )

    def test_source_validation_requires_authority_and_tier(self) -> None:
        validate_knowledge_item(self.source)
        with self.assertRaises(LegalKnowledgeValidationError):
            validate_knowledge_item(replace(self.source, authority=None))
        with self.assertRaises(LegalKnowledgeValidationError):
            validate_knowledge_item(replace(self.source, authority_tier=None))

    def test_legal_provision_validation_requires_document_and_version(self) -> None:
        validate_knowledge_item(self.provision)
        with self.assertRaises(LegalKnowledgeValidationError):
            validate_knowledge_item(replace(self.provision, document_id=None))
        with self.assertRaises(LegalKnowledgeValidationError):
            validate_knowledge_item(replace(self.provision, version=None))

    def test_authority_tier_orders_retrieval_by_source_strength(self) -> None:
        authority, jurisdiction, primary = make_catalog(source_id="source-primary")
        secondary = replace(
            primary,
            id="source-general",
            title="Fixture general source",
            authority_tier=SourceAuthorityTier.TIER_4_UNVERIFIED_GENERAL,
        )
        primary_document = make_document(
            primary, jurisdiction, authority, document_id="document-primary"
        )
        general_document = make_document(
            secondary, jurisdiction, authority, document_id="document-general"
        )
        primary_item = make_provision(
            primary,
            jurisdiction,
            authority,
            primary_document,
            provision_id="provision-primary",
        )
        general_item = make_provision(
            secondary,
            jurisdiction,
            authority,
            general_document,
            provision_id="provision-general",
        )
        store = InMemoryLegalKnowledgeStore()
        store.add_many(
            (authority, jurisdiction, primary, secondary, primary_document,
             general_document, primary_item, general_item)
        )

        results = search_legal_knowledge(
            "fixture searchable",
            filters={"type": "legal_provision"},
            repository=store,
        )
        self.assertEqual([item.id for item in results], ["provision-primary", "provision-general"])
        self.assertEqual(secondary.authority_tier, SourceAuthorityTier.TIER_4_UNVERIFIED_GENERAL)

    def test_jurisdiction_has_extensible_geography_and_is_required_for_provisions(self) -> None:
        validate_knowledge_item(self.jurisdiction)
        self.assertEqual(self.jurisdiction.country, "Fixture country")
        self.assertEqual(self.jurisdiction.state, "Fixture state")
        self.assertEqual(self.jurisdiction.district, "Fixture district")
        self.assertEqual(self.jurisdiction.court_or_authority, "Fixture venue")
        with self.assertRaises(LegalKnowledgeValidationError):
            validate_knowledge_item(replace(self.provision, jurisdiction=None))
        with self.assertRaises(LegalKnowledgeValidationError):
            validate_knowledge_item(replace(self.jurisdiction, country=None))

    def test_provenance_must_trace_the_same_source_and_a_locator(self) -> None:
        with self.assertRaises(LegalKnowledgeValidationError):
            validate_knowledge_item(replace(self.provision, provenance=()))
        mismatched = replace(
            self.provision,
            provenance=(
                SourceReference(
                    source_id="different-source",
                    document_id=self.document.id,
                    retrieval_time=RETRIEVED_AT,
                ),
            ),
        )
        with self.assertRaises(LegalKnowledgeValidationError):
            validate_knowledge_item(mismatched)
        unlocated = replace(
            self.provision,
            provenance=(SourceReference(source_id=self.source.id, retrieval_time=RETRIEVED_AT),),
        )
        with self.assertRaises(LegalKnowledgeValidationError):
            validate_knowledge_item(unlocated)

    def test_source_version_records_keep_explicit_version_metadata(self) -> None:
        version = SourceVersion(
            id="source-version-fixture",
            title="Fixture source snapshot",
            source=self.source.id,
            authority=self.authority.id,
            version="snapshot-fixture-v1",
            retrieved_at=RETRIEVED_AT,
            record_ids=(self.document.id, self.provision.id),
            provenance=(
                SourceReference(
                    source_id=self.source.id,
                    document_id=self.document.id,
                    page_section_reference="fixture snapshot locator",
                    retrieval_time=RETRIEVED_AT,
                ),
            ),
        )
        validate_knowledge_item(version)
        store = InMemoryLegalKnowledgeStore()
        store.add_many((self.authority, self.jurisdiction, self.source, self.document, self.provision, version))
        self.assertEqual(store.get(version.id).version, "snapshot-fixture-v1")
        with self.assertRaises(LegalKnowledgeStoreError):
            store.add(replace(self.provision, title="Attempted replacement"))

    def test_supersession_is_append_only_and_reverse_link_is_derived(self) -> None:
        previous = replace(self.provision, status=KnowledgeStatus.SUPERSEDED)
        successor = make_provision(
            self.source,
            self.jurisdiction,
            self.authority,
            self.document,
            provision_id="provision-fixture-v2",
            version="fixture-v2",
            supersedes=previous.id,
            text="later fixture content",
        )
        store = InMemoryLegalKnowledgeStore()
        store.add_many(
            (self.authority, self.jurisdiction, self.source, self.document, previous, successor)
        )

        self.assertEqual(store.get(previous.id), previous)
        self.assertIsNone(previous.superseded_by)
        self.assertEqual(store.superseding_record(previous.id), successor)
        self.assertEqual(store.relationships[0].subject_id, successor.id)

    def test_invalid_knowledge_is_rejected_without_partial_batch_write(self) -> None:
        store = InMemoryLegalKnowledgeStore()
        invalid = replace(self.provision, source=None)
        with self.assertRaises(LegalKnowledgeValidationError):
            store.add_many((self.authority, self.jurisdiction, invalid))
        self.assertEqual(store.items, ())

    def test_retrieval_functions_are_empty_without_store_and_filter_local_data(self) -> None:
        self.assertEqual(search_legal_knowledge("anything"), ())
        self.assertIsNone(get_provision("missing"))
        store = InMemoryLegalKnowledgeStore()
        store.add_many((self.authority, self.jurisdiction, self.source, self.document, self.provision))
        self.assertEqual(
            search_legal_knowledge(
                "fixture searchable",
                jurisdiction=self.jurisdiction.id,
                filters={"type": "legal_provision"},
                repository=store,
            ),
            (self.provision,),
        )
        self.assertEqual(get_provision(self.provision.id, repository=store), self.provision)

    def test_mock_adapter_runs_all_local_stages_without_rewriting_records(self) -> None:
        adapter = MockLegalSourceAdapter(
            self.source,
            (self.provision,),
            retrieved_at=RETRIEVED_AT,
        )
        records = ingest_discovered_sources(adapter)
        self.assertEqual(records, (self.provision,))
        self.assertEqual(records[0].version, self.provision.version)

    def test_catalog_references_must_resolve_before_storage(self) -> None:
        store = InMemoryLegalKnowledgeStore()
        with self.assertRaises(LegalKnowledgeStoreError):
            store.add(self.provision)
        self.assertEqual(store.items, ())


if __name__ == "__main__":
    unittest.main()
