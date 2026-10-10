"""Immutable data contracts for a source-traceable legal knowledge layer.

These models describe records and relationships only. They contain no seeded
legal content and make no determination about legal applicability.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import IntEnum, StrEnum


class KnowledgeStatus(StrEnum):
    DRAFT = "draft"
    VERIFIED = "verified"
    UNVERIFIED = "unverified"
    SUPERSEDED = "superseded"
    WITHDRAWN = "withdrawn"


class SourceAuthorityTier(IntEnum):
    """Relative source trust, used for ordering rather than legal conclusions."""

    TIER_1_PRIMARY_OFFICIAL = 1
    TIER_2_OFFICIAL_INSTITUTIONAL = 2
    TIER_3_SECONDARY_VERIFIED = 3
    TIER_4_UNVERIFIED_GENERAL = 4


class RelationshipType(StrEnum):
    LAW_HAS_PROVISION = "law_has_provision"
    DOCUMENT_CONTAINS_PROVISION = "document_contains_provision"
    PROVISION_ADDRESSES_ISSUE = "provision_addresses_issue"
    ISSUE_SUGGESTS_PROCEDURE = "issue_suggests_procedure"
    PROCEDURE_AVAILABLE_AT_AUTHORITY = "procedure_available_at_authority"
    CASE_HAS_ISSUE = "case_has_issue"
    CASE_HAS_JURISDICTION = "case_has_jurisdiction"
    CASE_POSSIBLE_PROCEDURE = "case_possible_procedure"
    SUPERSEDES = "supersedes"


@dataclass(frozen=True, slots=True, kw_only=True)
class SourceReference:
    """A precise pointer back to the material supporting a knowledge item."""

    source_id: str
    retrieval_time: datetime
    document_id: str | None = None
    provision_id: str | None = None
    page_section_reference: str | None = None
    source_url: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class KnowledgeItem:
    """Common metadata carried by every stored knowledge record.

    ``authority``, ``jurisdiction`` and ``source`` are IDs of their respective
    catalog records. Legal statement types are required to resolve all three
    before a repository accepts them.
    """

    id: str
    title: str
    type: str = "knowledge_item"
    jurisdiction: str | None = None
    authority: str | None = None
    source: str | None = None
    source_url: str | None = None
    version: str | None = None
    effective_from: date | None = None
    effective_to: date | None = None
    retrieved_at: datetime | None = None
    status: KnowledgeStatus = KnowledgeStatus.DRAFT
    confidence: float | None = None
    provenance: tuple[SourceReference, ...] = ()
    supersedes: str | None = None
    superseded_by: str | None = None
    search_text: str = ""


@dataclass(frozen=True, slots=True, kw_only=True)
class LegalSource(KnowledgeItem):
    type: str = "legal_source"
    authority_tier: SourceAuthorityTier | None = None
    publisher_name: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class LegalDocument(KnowledgeItem):
    type: str = "legal_document"
    document_kind: str | None = None
    language: str | None = None
    content_digest: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class LegalProvision(KnowledgeItem):
    type: str = "legal_provision"
    document_id: str | None = None
    provision_reference: str | None = None
    text: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class LegalRule(KnowledgeItem):
    type: str = "legal_rule"
    provision_id: str | None = None
    rule_text: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class LegalProcedure(KnowledgeItem):
    type: str = "legal_procedure"
    related_provision_ids: tuple[str, ...] = ()
    steps: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True, kw_only=True)
class Authority(KnowledgeItem):
    type: str = "authority"
    authority_type: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class Jurisdiction(KnowledgeItem):
    type: str = "jurisdiction"
    country: str | None = None
    state: str | None = None
    district: str | None = None
    court_or_authority: str | None = None
    jurisdiction_basis: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class SourceVersion(KnowledgeItem):
    type: str = "source_version"
    content_digest: str | None = None
    record_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True, kw_only=True)
class KnowledgeRelationship:
    """A graph-ready directed edge; endpoints may be external case records."""

    subject_id: str
    relationship: RelationshipType
    object_id: str
    provenance: tuple[SourceReference, ...] = ()


LEGAL_STATEMENT_TYPES = (LegalDocument, LegalProvision, LegalRule, LegalProcedure)
SOURCE_BACKED_TYPES = (*LEGAL_STATEMENT_TYPES, SourceVersion)
