"""Standalone local-first document processing pipeline; not connected to API."""

from __future__ import annotations

import hashlib
from dataclasses import replace

from app.engines.document_intelligence.classification import classify_document
from app.engines.document_intelligence.models import (
    DocumentProcessingStatus,
    DocumentResult,
    PageText,
)
from app.engines.document_intelligence.ocr import (
    OCRBackend,
    OCRProvider,
    OCRProviderAvailability,
    OCRRecognition,
)
from app.engines.document_intelligence.ocr_settings import build_configured_ocr_provider
from app.engines.document_intelligence.page_extraction import (
    ExtractionMethod,
    PageExtractionCoordinator,
    PageExtractionStatus,
)
from app.engines.document_intelligence.pdf_text import PDFExtractionError, extract_pdf_pages
from app.engines.document_intelligence.structured_extraction import (
    RuleBasedExtractor,
    StructuredExtractor,
)
from app.engines.document_intelligence.validation import build_metadata


class DocumentProcessingError(ValueError):
    """A detected supported document could not be processed safely."""


def process_document(
    document_bytes: bytes,
    filename: str,
    *,
    document_id: str | None = None,
    ocr_backend: OCRBackend | None = None,
    ocr_provider: OCRProvider | None = None,
    extraction_coordinator: PageExtractionCoordinator | None = None,
    structured_extractor: StructuredExtractor | None = None,
) -> DocumentResult:
    """Validate and extract a supported document without network services.

    Images and textless PDF pages remain explicitly marked ``ocr_required`` if
    no local OCR adapter is supplied. OCR adapters receive the original bytes
    plus MIME type and one-based page number; this lets them own local rendering
    for scanned PDF pages without introducing a mandatory renderer dependency.
    """
    if not isinstance(document_bytes, bytes):
        raise DocumentValidationError("Document content must be bytes.")
    if extraction_coordinator is not None and (ocr_backend is not None or ocr_provider is not None):
        raise ValueError("Supply an extraction_coordinator or an OCR provider/backend, not both.")
    if ocr_backend is not None and ocr_provider is not None:
        raise ValueError("Supply either the legacy OCR backend or the provider-neutral OCR provider.")
    selected_provider = ocr_provider or (
        _LegacyOCRProvider(ocr_backend)
        if ocr_backend
        else build_configured_ocr_provider()
    )
    coordinator = extraction_coordinator or PageExtractionCoordinator(ocr_provider=selected_provider)
    # Type is content-detected; a temporary 1-page metadata is finalized below.
    provisional_metadata = build_metadata(document_bytes, filename, page_count=1)
    mime_type = provisional_metadata.mime_type

    if mime_type == "application/pdf":
        try:
            extracted_pages = extract_pdf_pages(document_bytes)
        except PDFExtractionError as exc:
            raise DocumentProcessingError(str(exc)) from exc
        if not extracted_pages:
            raise DocumentProcessingError("PDF contains no pages.")
        page_items: list[PageText] = []
        errors: list[str] = []
        for page_number, text in enumerate(extracted_pages, start=1):
            page_items.append(_extract_page(
                coordinator,
                document_bytes,
                mime_type,
                page_number,
                text,
                digital_method="pypdf" if _pypdf_used() else "simple_pdf",
                errors=errors,
            ))
    else:
        errors = []
        page_items = [_extract_page(
            coordinator,
            document_bytes,
            mime_type,
            1,
            None,
            errors=errors,
        )]

    if any(page.status == DocumentProcessingStatus.FAILED for page in page_items):
        status = DocumentProcessingStatus.FAILED
    elif any(page.status == DocumentProcessingStatus.OCR_REQUIRED for page in page_items):
        status = DocumentProcessingStatus.OCR_REQUIRED
    else:
        status = DocumentProcessingStatus.EXTRACTED
    page_count = len(page_items)
    metadata = replace(provisional_metadata, page_count=page_count)
    stable_document_id = document_id or f"doc_{hashlib.sha256(document_bytes).hexdigest()[:24]}"
    text = "\n".join(page.text for page in page_items)
    classification = classify_document(text)
    extractor = structured_extractor or RuleBasedExtractor()
    evidence = tuple(
        item
        for page in page_items
        for item in extractor.extract(document_id=stable_document_id, page=page)
    )
    return DocumentResult(
        document_id=stable_document_id,
        metadata=metadata,
        classification=classification,
        pages=tuple(page_items),
        evidence=evidence,
        status=status,
        errors=tuple(errors),
    )


def _pypdf_used() -> bool:
    from app.engines.document_intelligence.pdf_text import pypdf_available

    return pypdf_available()


def _extract_page(
    coordinator: PageExtractionCoordinator,
    document_bytes: bytes,
    mime_type: str,
    page_number: int,
    digital_text: str | None,
    *,
    errors: list[str],
    digital_method: str = "digital_text",
) -> PageText:
    extracted = coordinator.extract_page(
        document_bytes,
        mime_type=mime_type,
        page_number=page_number,
        digital_text=digital_text,
    )
    if extracted.error:
        errors.append(f"Page {page_number}: {extracted.error}")
    if extracted.status is PageExtractionStatus.FAILED:
        page_status = DocumentProcessingStatus.FAILED
    elif extracted.status is PageExtractionStatus.UNAVAILABLE:
        page_status = DocumentProcessingStatus.OCR_REQUIRED
    else:
        page_status = DocumentProcessingStatus.EXTRACTED
    if extracted.extraction_method is ExtractionMethod.DIGITAL_TEXT:
        method = digital_method
    elif extracted.status is PageExtractionStatus.UNAVAILABLE:
        # Keep the established "none" method value while status and the
        # coordinator error retain the explicit unavailable reason.
        method = "none"
    else:
        method = extracted.extraction_method.value
    return PageText(
        page_number=page_number,
        text=extracted.text.strip() if method != digital_method else extracted.text,
        extraction_method=method,
        status=page_status,
        confidence=extracted.confidence,
        provider_name=extracted.provider_name,
    )


class _LegacyOCRProvider:
    """Adapt the old local string-only contract without inventing confidence."""

    name = "legacy_local_ocr_backend"

    def __init__(self, backend: OCRBackend) -> None:
        self._backend = backend

    @property
    def availability(self) -> OCRProviderAvailability:
        return OCRProviderAvailability(self.name, True)

    def recognize_page(self, document_bytes: bytes, *, mime_type: str, page_number: int) -> OCRRecognition:
        text = self._backend.extract_text(
            document_bytes,
            mime_type=mime_type,
            page_number=page_number,
        )
        if not isinstance(text, str):
            raise TypeError("Local OCR backend returned a non-text value.")
        return OCRRecognition(text=text, confidence=None)
