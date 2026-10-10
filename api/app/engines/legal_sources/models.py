"""Registry-specific metadata layered on the shared legal knowledge records."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum

from app.engines.legal_knowledge.models import (
    Authority,
    Jurisdiction,
    KnowledgeStatus,
    LegalSource,
    SourceReference,
    SourceAuthorityTier,
    SourceVersion,
)


class SourceType(StrEnum):
    """Kinds of legal and official information the registry can track."""

    LEGISLATION = "legislation"
    RULES_REGULATIONS = "rules_regulations"
    GOVERNMENT_NOTIFICATION = "government_notification"
    SUPREME_COURT_MATERIAL = "supreme_court_material"
    HIGH_COURT_MATERIAL = "high_court_material"
    OFFICIAL_PROCEDURAL_RESOURCE = "official_procedural_resource"
    ECOURTS = "ecourts"
    LEGAL_AID_RESOURCE = "legal_aid_resource"
    OFFICIAL_COMPLAINT_PORTAL = "official_complaint_portal"
    OTHER_OFFICIAL = "other_official"


@dataclass(frozen=True, slots=True, kw_only=True)
class RegistrySourceVersion(SourceVersion):
    """A complete, append-only registry snapshot for one shared legal source.

    Common fields (authority, jurisdiction, title, URL, effective date, version,
    retrieval time, verification status, supersession, and provenance) come
    from ``SourceVersion``. This type stores only source-registry metadata that
    the shared legal knowledge model does not define.
    """

    source_type: SourceType | None = None
    canonical_reference: str | None = None
    resource_identifier: str | None = None
    publication_date: date | None = None
    publisher_name: str | None = None
    authority_tier: SourceAuthorityTier | None = None

    @property
    def effective_date(self) -> date | None:
        """Friendly registry name for the shared model's effective_from field."""

        return self.effective_from

    @property
    def verification_status(self) -> KnowledgeStatus:
        """Friendly registry name for the shared model's status field."""

        return self.status

    @property
    def is_authoritative(self) -> bool:
        """Whether this verified snapshot qualifies as an authoritative source.

        Registry validation enforces completeness for verified records. The
        explicit tier check prevents verified secondary or unverified sources
        from being promoted to authoritative status.
        """

        return (
            self.status is KnowledgeStatus.VERIFIED
            and self.authority_tier
            in (
                SourceAuthorityTier.TIER_1_PRIMARY_OFFICIAL,
                SourceAuthorityTier.TIER_2_OFFICIAL_INSTITUTIONAL,
            )
            and self.source_type is not None
            and bool(self.canonical_reference and self.canonical_reference.strip())
            and bool(self.source_url or self.resource_identifier)
            and bool(self.jurisdiction)
            and self.retrieved_at is not None
            and bool(self.provenance)
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class SourceRegistryEntry:
    """A stable legal-knowledge source with its current registry snapshot."""

    source: LegalSource
    current_version: RegistrySourceVersion
    versions: tuple[RegistrySourceVersion, ...]
    authority: Authority
    jurisdiction: Jurisdiction | None

    @property
    def id(self) -> str:
        return self.source.id

    @property
    def source_type(self) -> SourceType | None:
        return self.current_version.source_type

    @property
    def jurisdiction_id(self) -> str | None:
        return self.current_version.jurisdiction

    @property
    def title(self) -> str:
        return self.current_version.title

    @property
    def publisher_name(self) -> str | None:
        return self.current_version.publisher_name or self.source.publisher_name

    @property
    def canonical_reference(self) -> str | None:
        return self.current_version.canonical_reference

    @property
    def source_url(self) -> str | None:
        return self.current_version.source_url

    @property
    def resource_identifier(self) -> str | None:
        return self.current_version.resource_identifier

    @property
    def publication_date(self) -> date | None:
        return self.current_version.publication_date

    @property
    def effective_date(self) -> date | None:
        return self.current_version.effective_date

    @property
    def version(self) -> str | None:
        return self.current_version.version

    @property
    def retrieved_at(self) -> datetime | None:
        return self.current_version.retrieved_at

    @property
    def supersedes(self) -> str | None:
        return self.current_version.supersedes

    @property
    def verification_status(self) -> KnowledgeStatus:
        return self.current_version.verification_status

    @property
    def authority_tier(self) -> SourceAuthorityTier | None:
        return self.current_version.authority_tier

    @property
    def provenance(self) -> tuple[SourceReference, ...]:
        return self.current_version.provenance

    @property
    def is_authoritative(self) -> bool:
        return self.current_version.is_authoritative


__all__ = [
    "Authority",
    "Jurisdiction",
    "KnowledgeStatus",
    "LegalSource",
    "RegistrySourceVersion",
    "SourceAuthorityTier",
    "SourceRegistryEntry",
    "SourceType",
]
