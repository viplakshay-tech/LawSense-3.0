"""Small, source-verified Indian legal knowledge seed.

The seed is deliberately hand-curated, local, and deterministic. It contains
short summaries of official source text rather than unverified advice or
procedural checklists. Source snapshots are recorded through the existing
legal-source registry.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from app.engines.legal_knowledge.models import (
    Authority,
    Jurisdiction,
    KnowledgeRelationship,
    KnowledgeStatus,
    LegalDocument,
    LegalProvision,
    LegalSource,
    RelationshipType,
    SourceAuthorityTier,
    SourceReference,
)
from app.engines.legal_knowledge.store import InMemoryLegalKnowledgeStore
from app.engines.legal_sources import LegalSourceRegistry, RegistrySourceVersion, SourceType


_VERIFIED_AT = datetime(2026, 10, 7, 21, 1, 55, tzinfo=timezone.utc)
_INDIA_JURISDICTION_ID = "jurisdiction-india"
_UTTARAKHAND_JURISDICTION_ID = "jurisdiction-uttarakhand"
_PARLIAMENT_AUTHORITY_ID = "authority-parliament-of-india"
_UTTARAKHAND_ASSEMBLY_AUTHORITY_ID = "authority-uttarakhand-state-legislative-assembly"
_PIB_AUTHORITY_ID = "authority-press-information-bureau"
_LABOUR_MINISTRY_AUTHORITY_ID = "authority-ministry-labour-employment"


@dataclass(frozen=True, slots=True)
class _SourceSeed:
    id: str
    title: str
    authority_id: str
    publisher_name: str
    source_url: str
    reference: str
    version: str
    publication_date: date
    effective_date: date | None
    authority_tier: SourceAuthorityTier = SourceAuthorityTier.TIER_1_PRIMARY_OFFICIAL
    source_type: SourceType = SourceType.LEGISLATION
    jurisdiction_id: str = _INDIA_JURISDICTION_ID
    retrieved_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class _ProvisionSeed:
    id: str
    source_id: str
    reference: str
    title: str
    text: str
    search_text: str
    issue_categories: tuple[str, ...]


_SOURCES = (
    _SourceSeed(
        id="source-indiacode-uttarakhand-tenancy-act-2021",
        title="The Uttarakhand Tenancy Act, 2021",
        authority_id=_UTTARAKHAND_ASSEMBLY_AUTHORITY_ID,
        publisher_name="India Code, Government of India",
        source_url="https://indiacode.gov.in/handle/123456789/613822",
        reference="Act No. 02 of 2022; Sections 1(3) and 11",
        version=(
            "Act No. 02 of 2022 as published in India Code; commencement notification "
            "under section 1(3) not verified"
        ),
        publication_date=date(2022, 1, 27),
        effective_date=None,
        jurisdiction_id=_UTTARAKHAND_JURISDICTION_ID,
    ),
    _SourceSeed(
        id="source-pib-model-tenancy-act-adoption-2021",
        title="Cabinet approves Model Tenancy Act for circulation to States/UTs for adoption",
        authority_id=_PIB_AUTHORITY_ID,
        publisher_name="Press Information Bureau, Government of India",
        source_url="https://www.pib.gov.in/PressReleasePage.aspx?PRID=1723636&lang=2&reg=48",
        reference="PIB release ID 1723636, 2 June 2021",
        version="Official PIB release published 2021-06-02",
        publication_date=date(2021, 6, 2),
        effective_date=None,
        authority_tier=SourceAuthorityTier.TIER_2_OFFICIAL_INSTITUTIONAL,
        source_type=SourceType.OTHER_OFFICIAL,
    ),
    _SourceSeed(
        id="source-india-code-consumer-protection-act-2019",
        title="The Consumer Protection Act, 2019",
        authority_id=_PARLIAMENT_AUTHORITY_ID,
        publisher_name="India Code, Government of India",
        source_url="https://www.indiacode.nic.in/indiacode/handle/123456789/16103?view_type=browse",
        reference="The Consumer Protection Act, 2019 (Act No. 35 of 2019)",
        version="Act No. 35 of 2019; India Code record 123456789/16103",
        publication_date=date(2019, 8, 9),
        # The Act's provisions had staged commencement; no single effective
        # date is assigned to this document snapshot.
        effective_date=None,
    ),
    _SourceSeed(
        id="source-india-code-code-on-wages-2019",
        title="The Code on Wages, 2019",
        authority_id=_PARLIAMENT_AUTHORITY_ID,
        publisher_name="India Code, Government of India",
        source_url="https://indiacode.gov.in/handle/123456789/496699",
        reference="The Code on Wages, 2019 (Act No. 29 of 2019)",
        version="Act No. 29 of 2019; India Code text as on 2025-11-21",
        publication_date=date(2019, 8, 8),
        effective_date=date(2025, 11, 21),
    ),
    _SourceSeed(
        id="source-pib-labour-codes-commencement-2025",
        title="Union Government's Four Labour Codes Simplify and Streamline Labour Laws",
        authority_id=_LABOUR_MINISTRY_AUTHORITY_ID,
        publisher_name="Press Information Bureau, Ministry of Labour & Employment, Government of India",
        source_url="https://www.pib.gov.in/PressReleasePage.aspx?PRID=2194018&lang=1&reg=1",
        reference="PIB release ID 2194018, 25 November 2025",
        version="Official PIB release published 2025-11-25",
        publication_date=date(2025, 11, 25),
        effective_date=None,
        authority_tier=SourceAuthorityTier.TIER_2_OFFICIAL_INSTITUTIONAL,
        source_type=SourceType.OTHER_OFFICIAL,
    ),
    _SourceSeed(
        id="source-gazette-code-on-wages-commencement-2025",
        title="Gazette of India notification bringing the Code on Wages, 2019 into force",
        authority_id=_LABOUR_MINISTRY_AUTHORITY_ID,
        publisher_name="Gazette of India, Government of India",
        source_url="https://egazette.gov.in/WriteReadData/2025/267885.pdf",
        reference="S.O. 5322(E), dated 21 November 2025; Code on Wages, 2019 commencement and repeal/transition provisions",
        version="Official Gazette PDF; notification S.O. 5322(E)",
        publication_date=date(2025, 11, 21),
        effective_date=date(2025, 11, 21),
        authority_tier=SourceAuthorityTier.TIER_1_PRIMARY_OFFICIAL,
        source_type=SourceType.GOVERNMENT_NOTIFICATION,
        retrieved_at=datetime(2026, 10, 10, 0, 0, tzinfo=timezone.utc),
    ),
    _SourceSeed(
        id="source-india-code-posh-act-2013",
        title=(
            "The Sexual Harassment of Women at Workplace (Prevention, "
            "Prohibition and Redressal) Act, 2013"
        ),
        authority_id=_PARLIAMENT_AUTHORITY_ID,
        publisher_name="India Code, Government of India",
        source_url="https://indiacode.gov.in/handle/123456789/496008",
        reference="The Sexual Harassment of Women at Workplace Act, 2013 (Act No. 14 of 2013)",
        version="Act No. 14 of 2013; India Code text last updated 2021-08-31",
        publication_date=date(2013, 4, 22),
        effective_date=date(2013, 12, 9),
    ),
    _SourceSeed(
        id="source-india-code-domestic-violence-act-2005",
        title="The Protection of Women from Domestic Violence Act, 2005",
        authority_id=_PARLIAMENT_AUTHORITY_ID,
        publisher_name="India Code, Government of India",
        source_url="https://indiacode.gov.in/handle/123456789/496007",
        reference="The Protection of Women from Domestic Violence Act, 2005 (Act No. 43 of 2005)",
        version="Act No. 43 of 2005; official India Code text",
        publication_date=date(2005, 9, 13),
        effective_date=date(2006, 10, 26),
    ),
)


_PROVISIONS = (
    _ProvisionSeed(
        id="provision-uttarakhand-tenancy-act-2021-section-11-security-deposit",
        source_id="source-indiacode-uttarakhand-tenancy-act-2021",
        reference="Section 11(1)(a)–(b) and Section 11(2); commencement under Section 1(3)",
        title="Uttarakhand Tenancy Act, 2021 — security deposit (State-specific; commencement unverified)",
        text=(
            "Section 11(1)(a)–(b) of the published Uttarakhand Tenancy Act text sets a "
            "maximum security deposit of two months' rent for residential premises and six "
            "months' rent for non-residential premises. Section 11(2) provides for return "
            "of the deposit when vacant possession is delivered, after permitted deductions. "
            "This is Uttarakhand-specific text and cannot be generalized to other States or "
            "Union Territories. Section 1(3) makes commencement dependent on a State "
            "Government Gazette notification; this source record does not verify that "
            "notification or current operation. Applicability is therefore unverified."
        ),
        search_text=(
            "housing tenancy tenant landlord rent lease security deposit rental refund "
            "residential premises Uttarakhand state law"
        ),
        issue_categories=("housing",),
    ),
    _ProvisionSeed(
        id="provision-consumer-protection-2019-section-2-10",
        source_id="source-india-code-consumer-protection-act-2019",
        reference="Section 2(10)",
        title="Consumer Protection Act, 2019 — defect in goods or products",
        text=(
            "Section 2(10) defines defect in relation to goods or a product to include a "
            "fault, imperfection or shortcoming in quality, quantity, potency, purity or "
            "standard required by law, contract, or a trader's representation."
        ),
        search_text="consumer defect defective goods product quality quantity seller purchase",
        issue_categories=("consumer",),
    ),
    _ProvisionSeed(
        id="provision-consumer-protection-2019-section-2-11",
        source_id="source-india-code-consumer-protection-act-2019",
        reference="Section 2(11)",
        title="Consumer Protection Act, 2019 — deficiency",
        text=(
            "Section 2(11) defines deficiency in relation to a service to include a fault, "
            "imperfection, shortcoming or inadequacy in quality, nature or manner of "
            "performance required by law or undertaken under a contract or otherwise. It "
            "also includes specified negligence or omission causing loss or injury and "
            "deliberate withholding of relevant information. Whether particular conduct "
            "meets the definition depends on the facts."
        ),
        search_text="consumer service deficiency quality manner of performance refund",
        issue_categories=("consumer",),
    ),
    _ProvisionSeed(
        id="provision-consumer-protection-2019-section-39-1-c",
        source_id="source-india-code-consumer-protection-act-2019",
        reference="Section 39(1)(c)",
        title="Consumer Protection Act, 2019 — return of price or charges",
        text=(
            "Where the District Consumer Disputes Redressal Commission is satisfied on a "
            "ground covered by section 39(1), it may direct the opposite party to return "
            "the price or service charges paid, with such interest as it decides."
        ),
        search_text="consumer refund return price charges paid interest consumer commission remedy",
        issue_categories=("consumer",),
    ),
    _ProvisionSeed(
        id="provision-code-on-wages-2019-section-17",
        source_id="source-india-code-code-on-wages-2019",
        reference="Section 17(1)–(4)",
        title="Code on Wages, 2019 — time limit for payment of wages",
        text=(
            "Section 17 sets wage-payment deadlines by wage period: daily wages at the end "
            "of the shift, weekly wages before the weekly holiday, fortnightly wages before "
            "the end of the second day after the fortnight, and monthly wages before the "
            "seventh day of the succeeding month. Wages following removal, dismissal, "
            "retrenchment, resignation or establishment closure are due within two working "
            "days. The appropriate Government may provide another time limit, and other "
            "law-specific time limits are preserved by subsections (3) and (4)."
        ),
        search_text="employment employee employer salary wages unpaid delayed wage payment termination resignation",
        issue_categories=("employment",),
    ),
    _ProvisionSeed(
        id="provision-posh-2013-section-3",
        source_id="source-india-code-posh-act-2013",
        reference="Section 3",
        title="Sexual Harassment of Women at Workplace Act, 2013 — prevention",
        text=(
            "Section 3 prohibits sexual harassment of a woman at a workplace and addresses "
            "circumstances connected with sexual harassment, including specified promises, "
            "threats, hostile treatment and humiliating or health-affecting conduct."
        ),
        search_text="workplace_harassment workplace sexual harassment woman prevention employment",
        issue_categories=("workplace_harassment",),
    ),
    _ProvisionSeed(
        id="provision-posh-2013-sections-4-and-6",
        source_id="source-india-code-posh-act-2013",
        reference="Sections 4(1) and 6(1)",
        title="Sexual Harassment of Women at Workplace Act, 2013 — Internal and Local Committees",
        text=(
            "Section 4 provides for an Internal Committee at a workplace. Under section 6, "
            "the district Local Committee receives complaints from establishments where an "
            "Internal Committee was not constituted because there are fewer than ten workers, "
            "and complaints against the employer."
        ),
        search_text="workplace_harassment workplace sexual harassment internal committee local committee district employer",
        issue_categories=("workplace_harassment",),
    ),
    _ProvisionSeed(
        id="provision-posh-2013-section-9",
        source_id="source-india-code-posh-act-2013",
        reference="Section 9(1)–(2)",
        title="Sexual Harassment of Women at Workplace Act, 2013 — complaint period",
        text=(
            "Section 9 provides for a written workplace sexual-harassment complaint within "
            "three months of the incident, or, for a series of incidents, within three months "
            "of the last incident. The Internal or Local Committee may extend that limit by "
            "up to a further three months for recorded reasons. Subsection (2) addresses a "
            "complaint made by another person in specified circumstances."
        ),
        search_text="workplace_harassment sexual harassment complaint incident three months extension",
        issue_categories=("workplace_harassment",),
    ),
    _ProvisionSeed(
        id="provision-domestic-violence-2005-section-3",
        source_id="source-india-code-domestic-violence-act-2005",
        reference="Section 3",
        title="Protection of Women from Domestic Violence Act, 2005 — domestic violence",
        text=(
            "Section 3 defines domestic violence to include specified physical, sexual, "
            "verbal and emotional, and economic abuse, and conduct connected with unlawful "
            "demands for dowry or other property. The statutory definition and domestic "
            "relationship requirements control."
        ),
        search_text="family domestic violence woman dowry_related_harassment abuse threats protection",
        issue_categories=("family", "dowry_related_harassment"),
    ),
    _ProvisionSeed(
        id="provision-domestic-violence-2005-section-17",
        source_id="source-india-code-domestic-violence-act-2005",
        reference="Section 17",
        title="Protection of Women from Domestic Violence Act, 2005 — residence right",
        text=(
            "Section 17 recognizes a right of a woman in a domestic relationship to reside "
            "in the shared household, whether or not she has title or a beneficial interest "
            "in it, subject to the section's wording and protections."
        ),
        search_text="family domestic violence shared household residence woman relationship",
        issue_categories=("family",),
    ),
    _ProvisionSeed(
        id="provision-domestic-violence-2005-section-18",
        source_id="source-india-code-domestic-violence-act-2005",
        reference="Section 18",
        title="Protection of Women from Domestic Violence Act, 2005 — protection orders",
        text=(
            "Section 18 empowers a Magistrate, after giving the parties an opportunity to be "
            "heard and on being satisfied that domestic violence has taken place or is likely "
            "to take place, to grant a protection order in the terms permitted by the section."
        ),
        search_text="family domestic violence protection order magistrate safety woman threats",
        issue_categories=("family", "dowry_related_harassment"),
    ),
    _ProvisionSeed(
        id="provision-domestic-violence-2005-section-20",
        source_id="source-india-code-domestic-violence-act-2005",
        reference="Section 20",
        title="Protection of Women from Domestic Violence Act, 2005 — monetary reliefs",
        text=(
            "Section 20 permits a Magistrate to direct monetary relief to meet expenses and "
            "losses resulting from domestic violence, including the categories listed in the "
            "section such as loss of earnings, medical expenses, property damage and "
            "maintenance."
        ),
        search_text="family domestic violence monetary relief loss earnings medical property maintenance",
        issue_categories=("family", "dowry_related_harassment"),
    ),
)


def build_authoritative_legal_knowledge_seed() -> InMemoryLegalKnowledgeStore:
    """Create a fresh deterministic repository containing the verified seed."""

    source_by_id = {source.id: source for source in _SOURCES}
    authority_source_refs: dict[str, list[SourceReference]] = {}
    jurisdiction_refs = []
    for spec in _SOURCES:
        retrieved_at = spec.retrieved_at or _VERIFIED_AT
        reference = SourceReference(
            source_id=spec.id,
            retrieval_time=retrieved_at,
            page_section_reference="Official source publication and territorial scope",
            source_url=spec.source_url,
        )
        authority_source_refs.setdefault(spec.authority_id, []).append(reference)
        jurisdiction_refs.append(reference)

    parliament = Authority(
        id=_PARLIAMENT_AUTHORITY_ID,
        title="Parliament of India",
        authority_type="national legislature",
        status=KnowledgeStatus.VERIFIED,
        provenance=tuple(authority_source_refs[_PARLIAMENT_AUTHORITY_ID]),
    )
    uttarakhand_assembly = Authority(
        id=_UTTARAKHAND_ASSEMBLY_AUTHORITY_ID,
        title="Uttarakhand Legislative Assembly",
        authority_type="state legislature",
        status=KnowledgeStatus.VERIFIED,
        provenance=tuple(authority_source_refs[_UTTARAKHAND_ASSEMBLY_AUTHORITY_ID]),
    )
    pib = Authority(
        id=_PIB_AUTHORITY_ID,
        title="Press Information Bureau, Government of India",
        authority_type="central government press information service",
        status=KnowledgeStatus.VERIFIED,
        provenance=tuple(authority_source_refs[_PIB_AUTHORITY_ID]),
    )
    labour_ministry = Authority(
        id=_LABOUR_MINISTRY_AUTHORITY_ID,
        title="Ministry of Labour & Employment, Government of India",
        authority_type="central government ministry",
        status=KnowledgeStatus.VERIFIED,
        provenance=tuple(authority_source_refs[_LABOUR_MINISTRY_AUTHORITY_ID]),
    )
    india = Jurisdiction(
        id=_INDIA_JURISDICTION_ID,
        title="India — central legal materials",
        country="India",
        jurisdiction_basis=(
            "Central Indian statutes or central-government model material. "
            "State/UT law and fact-specific applicability still require review."
        ),
        status=KnowledgeStatus.VERIFIED,
        provenance=tuple(
            reference for spec, reference in zip(_SOURCES, jurisdiction_refs)
            if spec.jurisdiction_id == _INDIA_JURISDICTION_ID
        ),
    )
    uttarakhand = Jurisdiction(
        id=_UTTARAKHAND_JURISDICTION_ID,
        title="Uttarakhand — State legal materials",
        country="India",
        state="Uttarakhand",
        jurisdiction_basis=(
            "The cited tenancy statute is territorially limited to Uttarakhand. Its section "
            "1(3) requires commencement by State Government Gazette notification; that "
            "notification and current operation have not been verified."
        ),
        status=KnowledgeStatus.UNVERIFIED,
        provenance=tuple(
            reference for spec, reference in zip(_SOURCES, jurisdiction_refs)
            if spec.jurisdiction_id == _UTTARAKHAND_JURISDICTION_ID
        ),
    )

    store = InMemoryLegalKnowledgeStore()
    store.add_many((parliament, uttarakhand_assembly, pib, labour_ministry, india, uttarakhand))
    registry = LegalSourceRegistry(store)

    for spec in _SOURCES:
        retrieved_at = spec.retrieved_at or _VERIFIED_AT
        source_reference = SourceReference(
            source_id=spec.id,
            retrieval_time=retrieved_at,
            page_section_reference=spec.reference,
            source_url=spec.source_url,
        )
        source = LegalSource(
            id=spec.id,
            title=spec.title,
            authority=spec.authority_id,
            jurisdiction=spec.jurisdiction_id,
            source_url=spec.source_url,
            version=spec.version,
            effective_from=spec.effective_date,
            retrieved_at=retrieved_at,
            status=KnowledgeStatus.VERIFIED,
            provenance=(source_reference,),
            authority_tier=spec.authority_tier,
            publisher_name=spec.publisher_name,
        )
        registry.register(
            source,
            RegistrySourceVersion(
                id=f"{spec.id}-snapshot-1",
                title=spec.title,
                source=spec.id,
                authority=spec.authority_id,
                jurisdiction=spec.jurisdiction_id,
                source_url=spec.source_url,
                version=spec.version,
                effective_from=spec.effective_date,
                retrieved_at=retrieved_at,
                status=KnowledgeStatus.VERIFIED,
                provenance=(source_reference,),
                source_type=spec.source_type,
                canonical_reference=spec.reference,
                publication_date=spec.publication_date,
                publisher_name=spec.publisher_name,
                authority_tier=spec.authority_tier,
            ),
        )

    document_by_source: dict[str, LegalDocument] = {}
    for spec in _SOURCES:
        retrieved_at = spec.retrieved_at or _VERIFIED_AT
        document_id = f"document-{spec.id.removeprefix('source-')}"
        document_by_source[spec.id] = LegalDocument(
            id=document_id,
            title=spec.title,
            jurisdiction=spec.jurisdiction_id,
            authority=spec.authority_id,
            source=spec.id,
            source_url=spec.source_url,
            version=spec.version,
            effective_from=spec.effective_date,
            retrieved_at=retrieved_at,
            status=KnowledgeStatus.VERIFIED,
            search_text=f"{spec.title} {spec.reference} {spec.version}",
            document_kind=(
                "official legislation"
                if spec.source_type is SourceType.LEGISLATION
                else "official government publication"
            ),
            language="en",
            provenance=(SourceReference(
                source_id=spec.id,
                document_id=document_id,
                page_section_reference=spec.reference,
                retrieval_time=retrieved_at,
                source_url=spec.source_url,
            ),),
        )

    provisions = []
    provision_specs = {item.id: item for item in _PROVISIONS}
    for spec in _PROVISIONS:
        source = source_by_id[spec.source_id]
        document = document_by_source[spec.source_id]
        source_retrieved_at = source.retrieved_at or _VERIFIED_AT
        supporting_provenance = (
            SourceReference(
                source_id=source.id,
                document_id=document.id,
                provision_id=spec.id,
                page_section_reference=spec.reference,
                retrieval_time=source_retrieved_at,
                source_url=source.source_url,
            ),
        )
        if spec.id == "provision-code-on-wages-2019-section-17":
            supporting_provenance += (
                SourceReference(
                    source_id="source-pib-labour-codes-commencement-2025",
                    page_section_reference=(
                        "PIB release ID 2194018: four Labour Codes made effective "
                        "from 2025-11-21"
                    ),
                    retrieval_time=source_by_id[
                        "source-pib-labour-codes-commencement-2025"
                    ].retrieved_at or _VERIFIED_AT,
                    source_url=source_by_id[
                        "source-pib-labour-codes-commencement-2025"
                    ].source_url,
                ),
            )
            supporting_provenance += (
                SourceReference(
                    source_id="source-gazette-code-on-wages-commencement-2025",
                    page_section_reference=(
                        "S.O. 5322(E): Code on Wages commencement from 21 November 2025; "
                        "section 69 repeals the Payment of Wages Act, 1936 subject to transition/savings"
                    ),
                    retrieval_time=source_by_id[
                        "source-gazette-code-on-wages-commencement-2025"
                    ].retrieved_at or _VERIFIED_AT,
                    source_url=source_by_id[
                        "source-gazette-code-on-wages-commencement-2025"
                    ].source_url,
                ),
            )
        provisions.append(LegalProvision(
            id=spec.id,
            title=spec.title,
            jurisdiction=source.jurisdiction_id,
            authority=source.authority_id,
            source=source.id,
            source_url=source.source_url,
            version=source.version,
            effective_from=source.effective_date,
            retrieved_at=source_retrieved_at,
            status=KnowledgeStatus.VERIFIED,
            confidence=1.0,
            search_text=spec.search_text,
            document_id=document.id,
            provision_reference=spec.reference,
            text=spec.text,
            provenance=supporting_provenance,
        ))

    store.add_many((*document_by_source.values(), *provisions))

    for provision in provisions:
        spec = provision_specs[provision.id]
        source = source_by_id[spec.source_id]
        for category in spec.issue_categories:
            # These curated index links determine retrieval relevance only;
            # legal applicability and outcomes remain for the reasoning layer.
            store.add_relationship(KnowledgeRelationship(
                subject_id=provision.id,
                relationship=RelationshipType.PROVISION_ADDRESSES_ISSUE,
                object_id=category,
                provenance=(SourceReference(
                    source_id=source.id,
                    document_id=document_by_source[source.id].id,
                    provision_id=provision.id,
                    page_section_reference=spec.reference,
                    retrieval_time=source_retrieved_at,
                    source_url=source.source_url,
                ),),
            ))

    return store


__all__ = ["build_authoritative_legal_knowledge_seed"]
