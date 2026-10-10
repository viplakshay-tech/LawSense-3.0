"""Provider-neutral legal source governance and future adapter contracts."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import replace
from datetime import date, datetime
from typing import Protocol
from urllib.parse import urlsplit

from app.engines.legal_sources.governance_models import (
    GovernedLegalSource,
    RetrievedSourceMaterial,
    SourceApplicabilityStatus,
    SourceFreshnessStatus,
    SourceVerificationStatus,
)


class SourceGovernanceError(ValueError):
    """Base exception for invalid source-governance operations."""


class SourceGovernanceValidationError(SourceGovernanceError):
    """Raised when source metadata or review state is inconsistent."""


class DuplicateSourceIdError(SourceGovernanceError):
    """Raised when a source ID would replace an existing governance record."""


class LegalSourceIngestionAdapter(Protocol):
    """Contract for future source-specific discovery and retrieval adapters.

    Implementations may later target India Code, Gazette publications, courts,
    eCourts, NALSA, or other government portals. The governance package does
    not select a provider or perform network access. Returned material remains
    unverified until a separate review explicitly records verification
    evidence.
    """

    @property
    def adapter_id(self) -> str: ...

    def discover(self) -> Iterable[GovernedLegalSource]: ...

    def retrieve(self, source: GovernedLegalSource) -> RetrievedSourceMaterial: ...


def _optional_text(value: object, field_name: str) -> None:
    if value is not None and (not isinstance(value, str) or not value.strip()):
        raise SourceGovernanceValidationError(
            f"{field_name} must be non-empty text when supplied."
        )


def _validate_url(value: object) -> None:
    _optional_text(value, "source_url")
    if value is None:
        return
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise SourceGovernanceValidationError(
            "source_url must be an explicit absolute HTTP(S) URL."
        )


def _validate_aware_datetime(value: object, field_name: str) -> None:
    if value is not None and (
        not isinstance(value, datetime)
        or value.tzinfo is None
        or value.utcoffset() is None
    ):
        raise SourceGovernanceValidationError(
            f"{field_name} must be a timezone-aware datetime when supplied."
        )


def validate_governed_source(source: GovernedLegalSource) -> None:
    """Validate supplied fields without filling unknown metadata."""

    if not isinstance(source, GovernedLegalSource):
        raise SourceGovernanceValidationError(
            "Source governance records must use GovernedLegalSource."
        )
    if not isinstance(source.source_id, str) or not source.source_id.strip():
        raise SourceGovernanceValidationError("source_id is required.")

    for field_name in (
        "authority",
        "title",
        "jurisdiction",
        "source_type",
        "official_reference",
        "reference",
        "version",
        "verification_evidence",
    ):
        _optional_text(getattr(source, field_name), field_name)
    _validate_url(source.source_url)

    for field_name in ("publication_date", "effective_date"):
        value = getattr(source, field_name)
        if value is not None and (
            not isinstance(value, date) or isinstance(value, datetime)
        ):
            raise SourceGovernanceValidationError(f"{field_name} must be a date.")
    _validate_aware_datetime(source.retrieved_at, "retrieved_at")

    if not isinstance(source.verification_status, SourceVerificationStatus):
        raise SourceGovernanceValidationError(
            "verification_status must be a SourceVerificationStatus value."
        )
    if not isinstance(source.freshness_status, SourceFreshnessStatus):
        raise SourceGovernanceValidationError(
            "freshness_status must be a SourceFreshnessStatus value."
        )
    if not isinstance(source.applicability_status, SourceApplicabilityStatus):
        raise SourceGovernanceValidationError(
            "applicability_status must be a SourceApplicabilityStatus value."
        )

    if source.verification_status is SourceVerificationStatus.VERIFIED:
        missing = source.missing_verification_metadata
        if missing:
            raise SourceGovernanceValidationError(
                "A verified source requires explicit " + ", ".join(missing) + "."
            )
        if not source.verification_evidence:
            raise SourceGovernanceValidationError(
                "A verified source requires explicit verification_evidence."
            )


def validate_source_jurisdiction(
    source: GovernedLegalSource,
    expected_jurisdiction: str,
) -> None:
    """Require exact jurisdiction identity; this check does not infer applicability."""

    validate_governed_source(source)
    _optional_text(expected_jurisdiction, "expected_jurisdiction")
    if source.jurisdiction != expected_jurisdiction:
        raise SourceGovernanceValidationError(
            f"Source jurisdiction {source.jurisdiction!r} does not match "
            f"requested jurisdiction {expected_jurisdiction!r}."
        )


def record_retrieval(
    source: GovernedLegalSource,
    material: RetrievedSourceMaterial,
) -> GovernedLegalSource:
    """Return source metadata with explicit retrieval facts applied.

    Retrieval may update the retrieval timestamp and an adapter-supplied
    locator. Verification, freshness, and applicability assessments are kept
    exactly as they were; retrieval alone cannot change any of them.
    """

    validate_governed_source(source)
    if not isinstance(material, RetrievedSourceMaterial):
        raise SourceGovernanceValidationError(
            "Retrieved material must use RetrievedSourceMaterial."
        )
    _optional_text(material.source_id, "retrieved source_id")
    if material.source_id != source.source_id:
        raise SourceGovernanceValidationError(
            "Retrieved material must identify the source it was retrieved for."
        )
    _validate_aware_datetime(material.retrieved_at, "retrieved_at")
    if material.retrieved_at is None:
        raise SourceGovernanceValidationError("retrieved_at is required for retrieved material.")
    if not isinstance(material.payload, bytes):
        raise SourceGovernanceValidationError("Retrieved material payload must be bytes.")
    _validate_url(material.source_url)
    _optional_text(material.reference, "reference")
    return replace(
        source,
        retrieved_at=material.retrieved_at,
        source_url=material.source_url or source.source_url,
        reference=material.reference or source.reference,
    )


class SourceGovernanceRegistry:
    """Small append-only in-memory catalog for governed source metadata."""

    def __init__(self, sources: Sequence[GovernedLegalSource] = ()) -> None:
        self._sources: dict[str, GovernedLegalSource] = {}
        self.add_many(sources)

    def add(self, source: GovernedLegalSource) -> None:
        validate_governed_source(source)
        if source.source_id in self._sources:
            raise DuplicateSourceIdError(f"Source ID already exists: {source.source_id}")
        self._sources[source.source_id] = source

    def add_many(self, sources: Sequence[GovernedLegalSource]) -> None:
        """Validate a batch first, then add it atomically with unique IDs."""

        batch = tuple(sources)
        seen: set[str] = set()
        for source in batch:
            validate_governed_source(source)
            if source.source_id in seen or source.source_id in self._sources:
                raise DuplicateSourceIdError(f"Source ID already exists: {source.source_id}")
            seen.add(source.source_id)
        self._sources.update((source.source_id, source) for source in batch)

    def get(self, source_id: str) -> GovernedLegalSource | None:
        return self._sources.get(source_id)

    def entries(self) -> tuple[GovernedLegalSource, ...]:
        return tuple(self._sources.values())


__all__ = [
    "DuplicateSourceIdError",
    "LegalSourceIngestionAdapter",
    "SourceGovernanceError",
    "SourceGovernanceRegistry",
    "SourceGovernanceValidationError",
    "record_retrieval",
    "validate_governed_source",
    "validate_source_jurisdiction",
]
