"""Fail-closed validation for registry metadata and verified source snapshots."""

from __future__ import annotations

from datetime import date, datetime
from urllib.parse import urlsplit

from app.engines.legal_knowledge.models import (
    Authority,
    Jurisdiction,
    KnowledgeStatus,
    LegalSource,
    SourceAuthorityTier,
)
from app.engines.legal_knowledge.validation import (
    LegalKnowledgeValidationError,
    validate_knowledge_item,
)

from app.engines.legal_sources.models import RegistrySourceVersion, SourceType
from app.engines.legal_sources.governance_models import SourceFreshnessStatus


class SourceRegistryValidationError(LegalKnowledgeValidationError):
    """Raised when registry metadata is incomplete or inconsistent."""


def _optional_text(value: object, field_name: str) -> None:
    if value is not None and (not isinstance(value, str) or not value.strip()):
        raise SourceRegistryValidationError(f"{field_name} must be non-empty text when supplied.")


def _validate_url(value: object, field_name: str) -> None:
    _optional_text(value, field_name)
    if value is None:
        return
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise SourceRegistryValidationError(f"{field_name} must be an explicit absolute HTTP(S) URL.")


def validate_source_identity(source: LegalSource) -> None:
    """Validate a source identity using the shared legal knowledge contract."""

    if not isinstance(source, LegalSource):
        raise SourceRegistryValidationError("A registry source must use the shared LegalSource model.")
    try:
        validate_knowledge_item(source)
    except LegalKnowledgeValidationError as exc:
        raise SourceRegistryValidationError(str(exc)) from exc
    _validate_url(source.source_url, "source_url")


def validate_registry_version(version: RegistrySourceVersion) -> None:
    """Validate a registry snapshot without inventing missing metadata.

    Draft and unverified records may retain unknown metadata as ``None``. A
    verified snapshot must have enough explicit information and provenance to
    be checked before it can qualify as authoritative.
    """

    if not isinstance(version, RegistrySourceVersion):
        raise SourceRegistryValidationError("Registry snapshots must use RegistrySourceVersion.")
    try:
        validate_knowledge_item(version)
    except LegalKnowledgeValidationError as exc:
        raise SourceRegistryValidationError(str(exc)) from exc

    if version.type != "source_version":
        raise SourceRegistryValidationError("Registry version type must be 'source_version'.")
    if version.source_type is not None and not isinstance(version.source_type, SourceType):
        raise SourceRegistryValidationError("source_type must be a supported SourceType value.")
    if version.authority_tier is not None and not isinstance(version.authority_tier, SourceAuthorityTier):
        raise SourceRegistryValidationError("authority_tier must be a SourceAuthorityTier value.")
    _optional_text(version.canonical_reference, "canonical_reference")
    _optional_text(version.resource_identifier, "resource_identifier")
    _optional_text(version.publisher_name, "publisher_name")
    _optional_text(version.verification_evidence, "verification_evidence")
    _optional_text(version.freshness_evidence, "freshness_evidence")
    _validate_url(version.source_url, "source_url")
    if not isinstance(version.freshness_status, SourceFreshnessStatus):
        raise SourceRegistryValidationError("freshness_status must be a SourceFreshnessStatus value.")
    if version.freshness_checked_at is not None and (
        not isinstance(version.freshness_checked_at, datetime)
        or version.freshness_checked_at.tzinfo is None
        or version.freshness_checked_at.utcoffset() is None
    ):
        raise SourceRegistryValidationError("freshness_checked_at must be timezone-aware.")
    if version.freshness_status is not SourceFreshnessStatus.UNKNOWN:
        if version.freshness_checked_at is None or not version.freshness_evidence:
            raise SourceRegistryValidationError(
                "A reviewed freshness status requires freshness_checked_at and freshness_evidence."
            )
        if version.retrieved_at is None:
            raise SourceRegistryValidationError(
                "A reviewed freshness status requires a retrieved source snapshot."
            )
        if version.freshness_checked_at < version.retrieved_at:
            raise SourceRegistryValidationError(
                "freshness_checked_at cannot precede the source snapshot retrieval time."
            )

    if version.verification_date is not None and (
        not isinstance(version.verification_date, date)
        or isinstance(version.verification_date, datetime)
    ):
        raise SourceRegistryValidationError("verification_date must be a date.")
    if version.publication_date is not None and (
        not isinstance(version.publication_date, date)
        or isinstance(version.publication_date, datetime)
    ):
        raise SourceRegistryValidationError("publication_date must be a date.")
    if version.effective_from is not None and (
        not isinstance(version.effective_from, date)
        or isinstance(version.effective_from, datetime)
    ):
        raise SourceRegistryValidationError("effective date must be a date.")

    # Every provenance pointer must identify the same source being snapshotted.
    if not any(reference.source_id == version.source for reference in version.provenance):
        raise SourceRegistryValidationError("Registry provenance must reference the snapshotted source.")

    if version.status is KnowledgeStatus.VERIFIED:
        missing = []
        if version.source_type is None:
            missing.append("source_type")
        if not version.canonical_reference:
            missing.append("canonical_reference")
        if not (version.source_url or version.resource_identifier):
            missing.append("source_url or resource_identifier")
        if not version.jurisdiction:
            missing.append("jurisdiction")
        if not version.authority_tier:
            missing.append("authority_tier")
        if version.retrieved_at is None:
            missing.append("retrieved_at")
        if not version.provenance:
            missing.append("provenance")
        if not version.verification_evidence:
            missing.append("verification_evidence")
        elif version.retrieved_at is not None and not any(
            reference.source_id == version.source
            and reference.retrieval_time == version.retrieved_at
            for reference in version.provenance
        ):
            raise SourceRegistryValidationError(
                "Verified provenance must preserve the snapshot retrieval timestamp."
            )
        if missing:
            raise SourceRegistryValidationError(
                "A verified source snapshot requires explicit " + ", ".join(missing) + "."
            )


def validate_registry_catalog(
    source: LegalSource,
    version: RegistrySourceVersion,
    *,
    authority: Authority,
    jurisdiction: Jurisdiction | None,
) -> None:
    """Check a source snapshot against its shared catalog records."""

    validate_source_identity(source)
    validate_registry_version(version)
    if version.source != source.id:
        raise SourceRegistryValidationError("Registry version source must match its LegalSource ID.")
    if version.authority != source.authority or authority.id != source.authority:
        raise SourceRegistryValidationError("Source and version must resolve to the same Authority.")
    if source.authority_tier != version.authority_tier:
        raise SourceRegistryValidationError("Source and version authority tiers must agree.")
    if version.jurisdiction:
        if jurisdiction is None or jurisdiction.id != version.jurisdiction:
            raise SourceRegistryValidationError("Version jurisdiction must resolve to its Jurisdiction record.")
    if version.status is KnowledgeStatus.VERIFIED:
        if not isinstance(authority, Authority):
            raise SourceRegistryValidationError("Verified snapshots require a registered Authority.")
        if not isinstance(jurisdiction, Jurisdiction):
            raise SourceRegistryValidationError("Verified snapshots require a registered Jurisdiction.")


__all__ = [
    "SourceRegistryValidationError",
    "validate_registry_catalog",
    "validate_registry_version",
    "validate_source_identity",
]
