"""Provider-neutral metadata contracts for governing legal sources.

These records describe source identity and review state only. Retrieval does
not establish authenticity, freshness, relevance, or legal applicability.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum


class SourceVerificationStatus(StrEnum):
    """Whether a source's identity and origin have been explicitly reviewed."""

    VERIFIED = "verified"
    UNVERIFIED = "unverified"


class SourceFreshnessStatus(StrEnum):
    """Freshness is an explicit assessment, never inferred from retrieval."""

    CURRENT = "current"
    STALE = "stale"
    UNKNOWN = "unknown"


class SourceApplicabilityStatus(StrEnum):
    """Governance statuses stop short of deciding legal applicability."""

    POTENTIALLY_RELEVANT = "potentially_relevant"
    APPLICABILITY_NOT_ESTABLISHED = "applicability_not_established"


@dataclass(frozen=True, slots=True, kw_only=True)
class GovernedLegalSource:
    """A provider-independent source record with separately tracked assessments.

    Descriptive metadata may be absent while a source is being catalogued.
    ``source_id`` is the only field required to identify that incomplete
    record. ``verification_status`` defaults to ``unverified``; verified
    records need explicit evidence, a retrieval timestamp, and identifying
    metadata. No URL or legal conclusion is synthesized by this model.
    """

    source_id: str
    authority: str | None = None
    title: str | None = None
    jurisdiction: str | None = None
    source_type: str | None = None
    official_reference: str | None = None
    source_url: str | None = None
    reference: str | None = None
    version: str | None = None
    publication_date: date | None = None
    effective_date: date | None = None
    retrieved_at: datetime | None = None
    verification_status: SourceVerificationStatus = SourceVerificationStatus.UNVERIFIED
    verification_evidence: str | None = None
    freshness_status: SourceFreshnessStatus = SourceFreshnessStatus.UNKNOWN
    applicability_status: SourceApplicabilityStatus = (
        SourceApplicabilityStatus.APPLICABILITY_NOT_ESTABLISHED
    )

    @property
    def missing_verification_metadata(self) -> tuple[str, ...]:
        """Fields needed for review, useful while preserving incomplete records."""

        missing = []
        for field_name in ("authority", "title", "jurisdiction", "source_type"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                missing.append(field_name)
        if not any(
            isinstance(value, str) and value.strip()
            for value in (self.official_reference, self.source_url, self.reference)
        ):
            missing.append("official_reference or source_url or reference")
        if self.retrieved_at is None:
            missing.append("retrieved_at")
        return tuple(missing)


@dataclass(frozen=True, slots=True, kw_only=True)
class RetrievedSourceMaterial:
    """Opaque adapter output; it carries retrieval facts, not legal conclusions."""

    source_id: str
    retrieved_at: datetime
    payload: bytes
    source_url: str | None = None
    reference: str | None = None

