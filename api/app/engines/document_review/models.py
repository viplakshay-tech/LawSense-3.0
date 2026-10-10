"""Review result types, keeping source extraction separate from interpretation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


FindingNature = Literal["extraction", "interpretation"]
FindingStatus = Literal["extracted", "candidate", "uncertain", "potential_conflict"]
ProvenanceSource = Literal["document", "case_state"]


@dataclass(frozen=True, slots=True)
class TextLocation:
    """Zero-based, half-open character offsets within one extracted page."""

    start: int
    end: int


@dataclass(frozen=True, slots=True)
class ReviewProvenance:
    """A source reference for a finding; page and offsets are optional."""

    source: ProvenanceSource
    document_id: str | None = None
    case_state_id: str | None = None
    page_number: int | None = None
    location: TextLocation | None = None
    extraction_method: str | None = None
    text: str | None = None


@dataclass(frozen=True, slots=True)
class ReviewFinding:
    """One extracted value or review interpretation with its supporting source."""

    id: str
    category: str
    value: Any
    text: str | None
    source: str
    provenance: tuple[ReviewProvenance, ...]
    confidence: float
    nature: FindingNature
    status: FindingStatus
    note: str | None = None
    upstream_status: str | None = None


@dataclass(frozen=True, slots=True)
class DocumentReview:
    """A review of one existing document-intelligence result."""

    document_id: str
    findings: tuple[ReviewFinding, ...]
    processing_status: str
    errors: tuple[str, ...] = ()

    @property
    def document_type(self) -> ReviewFinding:
        for finding in self.findings:
            if finding.category == "document_type":
                return finding
        raise LookupError("A document review must include a document_type finding.")

    @property
    def missing_or_uncertain(self) -> tuple[ReviewFinding, ...]:
        return tuple(item for item in self.findings if item.status == "uncertain")

    @property
    def conflicts(self) -> tuple[ReviewFinding, ...]:
        return tuple(item for item in self.findings if item.status == "potential_conflict")
