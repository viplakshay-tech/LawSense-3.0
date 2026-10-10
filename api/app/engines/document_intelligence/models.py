"""Internal data structures for document processing and evidence provenance."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class DocumentProcessingStatus(StrEnum):
    EXTRACTED = "extracted"
    OCR_REQUIRED = "ocr_required"
    FAILED = "failed"


class EvidenceStatus(StrEnum):
    USER_REPORTED = "user_reported"
    EVIDENCE_SUPPORTED = "evidence_supported"
    SYSTEM_INFERRED = "system_inferred"
    ASSUMPTION = "assumption"
    CONFLICTING = "conflicting"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class DocumentMetadata:
    filename: str
    mime_type: str
    extension: str
    file_size: int
    page_count: int
    sha256: str
    processing_timestamp: str


@dataclass(frozen=True, slots=True)
class PageText:
    page_number: int
    text: str
    extraction_method: str
    status: DocumentProcessingStatus = DocumentProcessingStatus.EXTRACTED
    confidence: float | None = None
    provider_name: str | None = None


@dataclass(frozen=True, slots=True)
class Classification:
    category: str
    confidence: float
    signals: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Evidence:
    document_id: str
    page_number: int
    text: str
    field: str
    value: Any
    confidence: float
    source: str
    status: EvidenceStatus
    extraction_method: str


@dataclass(frozen=True, slots=True)
class DocumentResult:
    document_id: str
    metadata: DocumentMetadata
    classification: Classification
    pages: tuple[PageText, ...]
    evidence: tuple[Evidence, ...]
    status: DocumentProcessingStatus
    errors: tuple[str, ...] = ()
