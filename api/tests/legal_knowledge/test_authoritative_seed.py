from __future__ import annotations

import json
import unittest
from pathlib import Path

from app.engines.legal_knowledge.models import (
    Authority,
    Jurisdiction,
    KnowledgeStatus,
    LegalDocument,
    LegalProvision,
    LegalSource,
    SourceAuthorityTier,
    SourceVersion,
)
from app.engines.legal_knowledge.seed import build_authoritative_legal_knowledge_seed
from app.engines.legal_sources import LegalSourceRegistry
from app.services.legal_knowledge_service import search_legal_knowledge


class AuthoritativeLegalKnowledgeSeedTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = build_authoritative_legal_knowledge_seed()

    def test_seed_contains_only_verified_source_backed_material(self) -> None:
        sources = [item for item in self.store.items if isinstance(item, LegalSource)]
        documents = [item for item in self.store.items if isinstance(item, LegalDocument)]
        provisions = [item for item in self.store.items if isinstance(item, LegalProvision)]
        self.assertEqual(len(sources), 8)
        self.assertEqual(len(documents), 8)
        self.assertEqual(len(provisions), 12)

        for item in (*sources, *documents, *provisions):
            with self.subTest(record=item.id):
                self.assertEqual(item.status, KnowledgeStatus.VERIFIED)
                self.assertTrue(item.title)
                self.assertTrue(item.authority)
                self.assertTrue(item.source_url)
                self.assertTrue(item.version)
                self.assertTrue(item.provenance)
                self.assertTrue(all(ref.source_url for ref in item.provenance))
                self.assertTrue(all(ref.retrieval_time.tzinfo for ref in item.provenance))
                authority = self.store.get(item.authority)
                self.assertIsInstance(authority, Authority)
                jurisdiction = self.store.get(item.jurisdiction)
                self.assertIsInstance(jurisdiction, Jurisdiction)
                source = self.store.get(item.source) if item.source else item
                self.assertIsInstance(source, LegalSource)
                self.assertIn(
                    source.authority_tier,
                    {
                        SourceAuthorityTier.TIER_1_PRIMARY_OFFICIAL,
                        SourceAuthorityTier.TIER_2_OFFICIAL_INSTITUTIONAL,
                    },
                )
                self.assertTrue(item.source_url.startswith("https://"))
                hostname = item.source_url.split("/", 3)[2].casefold()
                self.assertTrue(
                    hostname == "indiacode.nic.in"
                    or hostname.endswith(".indiacode.nic.in")
                    or hostname == "indiacode.gov.in"
                    or hostname == "egazette.gov.in"
                    or hostname == "egazette.nic.in"
                    or hostname == "pib.gov.in"
                    or hostname.endswith(".pib.gov.in"),
                    item.source_url,
                )

        for provision in provisions:
            self.assertTrue(provision.provision_reference)
            self.assertTrue(provision.text)
            self.assertEqual(provision.provenance[0].document_id, provision.document_id)
            self.assertEqual(provision.provenance[0].provision_id, provision.id)

    def test_registered_snapshots_are_complete_verified_and_official(self) -> None:
        registry = LegalSourceRegistry(self.store)
        entries = registry.authoritative_sources()
        self.assertEqual(len(entries), 8)
        self.assertTrue(all(entry.is_authoritative for entry in entries))
        self.assertEqual(
            {entry.authority_tier for entry in entries},
            {
                SourceAuthorityTier.TIER_1_PRIMARY_OFFICIAL,
                SourceAuthorityTier.TIER_2_OFFICIAL_INSTITUTIONAL,
            },
        )

        versions = [item for item in self.store.items if isinstance(item, SourceVersion)]
        self.assertEqual(len(versions), 8)
        for version in versions:
            with self.subTest(snapshot=version.id):
                self.assertEqual(version.status, KnowledgeStatus.VERIFIED)
                self.assertTrue(version.authority)
                self.assertTrue(version.source)
                self.assertTrue(version.jurisdiction)
                self.assertTrue(version.version)
                self.assertTrue(version.source_url)
                self.assertIsNotNone(version.publication_date)
                self.assertIsNotNone(version.authority_tier)
                self.assertTrue(version.canonical_reference)
                self.assertTrue(version.provenance)
                entry = registry.get(version.source)
                self.assertIsNotNone(entry)
                self.assertTrue(entry.canonical_reference)
                self.assertEqual(version.source_url, entry.source_url)

    def test_seed_retrieval_is_deterministic_and_uses_issue_terms(self) -> None:
        cases = {
            "housing": "provision-uttarakhand-tenancy-act-2021-section-11-security-deposit",
            "consumer": "provision-consumer-protection-2019-section-2-10",
            "employment": "provision-code-on-wages-2019-section-17",
            "workplace_harassment": "provision-posh-2013-section-3",
            "family": "provision-domestic-violence-2005-section-17",
            "dowry_related_harassment": "provision-domestic-violence-2005-section-3",
        }
        for query, expected_id in cases.items():
            with self.subTest(query=query):
                first = search_legal_knowledge(query, repository=self.store)
                second = search_legal_knowledge(query, repository=self.store)
                self.assertEqual(tuple(item.id for item in first), tuple(item.id for item in second))
                self.assertIn(expected_id, {item.id for item in first})

    def test_service_defaults_to_seed_and_returns_referenceable_records(self) -> None:
        results = search_legal_knowledge("consumer")
        provision = next(
            item for item in results
            if isinstance(item, LegalProvision)
            and item.id == "provision-consumer-protection-2019-section-39-1-c"
        )
        self.assertEqual(provision.provision_reference, "Section 39(1)(c)")
        self.assertEqual(provision.status, KnowledgeStatus.VERIFIED)
        self.assertEqual(
            provision.source_url,
            "https://www.indiacode.nic.in/indiacode/handle/123456789/16103?view_type=browse",
        )

    def test_model_tenancy_and_wage_effective_dates_have_official_support(self) -> None:
        housing = self.store.get("provision-uttarakhand-tenancy-act-2021-section-11-security-deposit")
        wages = self.store.get("provision-code-on-wages-2019-section-17")
        self.assertIsInstance(housing, LegalProvision)
        self.assertIsInstance(wages, LegalProvision)
        self.assertIn("Uttarakhand-specific", housing.text)
        self.assertIn("Section 1(3)", housing.text)
        self.assertEqual(housing.jurisdiction, "jurisdiction-uttarakhand")
        self.assertEqual(self.store.get(housing.jurisdiction).status, KnowledgeStatus.UNVERIFIED)
        self.assertTrue(any(
            ref.source_id == "source-pib-labour-codes-commencement-2025"
            and "2025-11-21" in (ref.page_section_reference or "")
            for ref in wages.provenance
        ))
        gazette = self.store.get("source-gazette-code-on-wages-commencement-2025")
        self.assertIsInstance(gazette, LegalSource)
        self.assertEqual(gazette.source_url, "https://egazette.gov.in/WriteReadData/2025/267885.pdf")
        self.assertTrue(any(
            ref.source_id == gazette.id
            and "S.O. 5322(E)" in (ref.page_section_reference or "")
            for ref in wages.provenance
        ))
        housing_source = self.store.get("source-indiacode-uttarakhand-tenancy-act-2021")
        self.assertEqual(
            housing_source.source_url,
            "https://indiacode.gov.in/handle/123456789/613822",
        )
        self.assertIsNone(housing_source.effective_from)
        self.assertIn("commencement notification", housing_source.version)

    def test_migrated_india_code_links_match_verified_act_records(self) -> None:
        expected_urls = {
            "source-indiacode-uttarakhand-tenancy-act-2021":
                "https://indiacode.gov.in/handle/123456789/613822",
            "source-india-code-consumer-protection-act-2019":
                "https://www.indiacode.nic.in/indiacode/handle/123456789/16103?view_type=browse",
            "source-india-code-code-on-wages-2019":
                "https://indiacode.gov.in/handle/123456789/496699",
            "source-india-code-posh-act-2013":
                "https://indiacode.gov.in/handle/123456789/496008",
            "source-india-code-domestic-violence-act-2005":
                "https://indiacode.gov.in/handle/123456789/496007",
        }
        for source_id, expected_url in expected_urls.items():
            with self.subTest(source=source_id):
                source = self.store.get(source_id)
                self.assertIsInstance(source, LegalSource)
                self.assertEqual(source.source_url, expected_url)
                provisions = [
                    item for item in self.store.items
                    if isinstance(item, LegalProvision) and item.source == source_id
                ]
                self.assertTrue(provisions)
                self.assertTrue(all(item.source_url == expected_url for item in provisions))

        consumer_act = self.store.get("source-india-code-consumer-protection-act-2019")
        self.assertIsInstance(consumer_act, LegalSource)
        self.assertEqual(consumer_act.title, "The Consumer Protection Act, 2019")
        self.assertEqual(consumer_act.authority, "authority-parliament-of-india")
        self.assertEqual(consumer_act.jurisdiction, "jurisdiction-india")
        self.assertIsNone(consumer_act.effective_from)
        consumer_snapshot = next(
            item for item in self.store.items
            if isinstance(item, SourceVersion) and item.source == consumer_act.id
        )
        self.assertEqual(
            consumer_snapshot.canonical_reference,
            "The Consumer Protection Act, 2019 (Act No. 35 of 2019)",
        )
        self.assertEqual(consumer_snapshot.publication_date.isoformat(), "2019-08-09")
        self.assertEqual(consumer_snapshot.version, "Act No. 35 of 2019; India Code record 123456789/16103")

    def test_india_code_catalog_uses_the_current_portal_and_verified_tenancy_record(self) -> None:
        catalog_path = (
            Path(__file__).resolve().parents[4]
            / "data"
            / "knowledge"
            / "source_catalog"
            / "sources.json"
        )
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        sources = {source["id"]: source for source in catalog["sources"]}

        self.assertEqual(sources["india-code"]["officialUrl"], "https://indiacode.gov.in/")
        self.assertEqual(sources["india-code"]["verificationDate"], "2026-10-09")
        tenancy = sources["uttarakhand-tenancy-act-2021"]
        self.assertEqual(
            tenancy["officialUrl"],
            "https://indiacode.gov.in/handle/123456789/613822",
        )
        self.assertEqual(tenancy["verificationDate"], "2026-10-09")
        self.assertIn("commencement notification under section 1(3) not verified", tenancy["version"])


if __name__ == "__main__":
    unittest.main()
