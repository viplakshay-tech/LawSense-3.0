"""Opt-in page extraction coordinator with provider-neutral OCR provenance.

This module is intentionally separate from ``pipeline.py``. It can be wired in
after existing digital extraction when the document service is ready to adopt
the richer result model.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from math import isfinite
from typing import Protocol

from app.engines.document_intelligence.ocr import (
    OCRProvider,
    OCRProviderAvailability,
    OCRRecognition,
)


class ExtractionMethod(StrEnum):
    DIGITAL_TEXT = "digital_text"
    OCR = "ocr"
    UNAVAILABLE = "unavailable"


class PageExtractionStatus(StrEnum):
    EXTRACTED = "extracted"
    UNAVAILABLE = "unavailable"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class PageExtractionResult:
    """Page-level text, extraction decision, confidence, and provenance."""

    page_number: int
    text: str
    extraction_method: ExtractionMethod
    confidence: float | None
    status: PageExtractionStatus
    ocr_required: bool
    provider_name: str | None = None
    error: str | None = None

    def __post_init__(self) -> None:
        if self.page_number < 1:
            raise ValueError("Page numbers are one-based and must be positive.")
        if self.confidence is not None and (
            not isinstance(self.confidence, (int, float))
            or not isfinite(self.confidence)
            or not 0.0 <= self.confidence <= 1.0
        ):
            raise ValueError("Confidence must be between 0 and 1, or None.")
        if self.extraction_method == ExtractionMethod.DIGITAL_TEXT and self.ocr_required:
            raise ValueError("Digital text results cannot require OCR.")


class TextSufficiencyEvaluator(Protocol):
    """Policy for deciding whether already-extracted page text is usable."""

    def is_sufficient(self, text: str) -> bool:
        """Return whether ``text`` is sufficient to skip OCR for this page."""


@dataclass(frozen=True, slots=True)
class MinimumTextSufficiency:
    """Default policy: non-whitespace character count meets a small threshold.

    The default threshold is one character to preserve all non-empty digital
    PDF text. Deployments can inject a stricter policy without changing OCR
    providers or document processing.
    """

    minimum_characters: int = 1

    def __post_init__(self) -> None:
        if self.minimum_characters < 1:
            raise ValueError("minimum_characters must be at least one.")

    def is_sufficient(self, text: str) -> bool:
        return sum(not character.isspace() for character in text) >= self.minimum_characters


class PageExtractionCoordinator:
    """Choose digital text or OCR for one page and return explicit page state."""

    def __init__(
        self,
        *,
        ocr_provider: OCRProvider | None = None,
        sufficiency_evaluator: TextSufficiencyEvaluator | None = None,
    ) -> None:
        self._ocr_provider = ocr_provider
        self._sufficiency_evaluator = sufficiency_evaluator or MinimumTextSufficiency()

    def extract_page(
        self,
        document_bytes: bytes,
        *,
        mime_type: str,
        page_number: int,
        digital_text: str | None,
    ) -> PageExtractionResult:
        """Use sufficient digital text, otherwise invoke OCR or report state.

        No OCR text or confidence is synthesized. An absent provider returns an
        ``unavailable`` result; a provider exception or invalid output returns
        ``failed`` while the extraction method remains ``unavailable``.
        """
        if not isinstance(document_bytes, bytes):
            raise TypeError("Document content must be bytes.")
        if page_number < 1:
            raise ValueError("Page numbers are one-based and must be positive.")
        if digital_text is not None and not isinstance(digital_text, str):
            raise TypeError("Digital page text must be a string or None.")

        existing_text = digital_text or ""
        if self._sufficiency_evaluator.is_sufficient(existing_text):
            return PageExtractionResult(
                page_number=page_number,
                text=existing_text,
                extraction_method=ExtractionMethod.DIGITAL_TEXT,
                confidence=None,
                status=PageExtractionStatus.EXTRACTED,
                ocr_required=False,
            )

        if self._ocr_provider is None:
            return PageExtractionResult(
                page_number=page_number,
                text="",
                extraction_method=ExtractionMethod.UNAVAILABLE,
                confidence=None,
                status=PageExtractionStatus.UNAVAILABLE,
                ocr_required=True,
                error=(
                    "OCR is required for this page, but no OCR provider is configured "
                    "(no local OCR backend is available)."
                ),
            )

        provider_name: str | None = None
        try:
            provider_name = self._ocr_provider.name
            if not isinstance(provider_name, str) or not provider_name.strip():
                raise ValueError("OCR provider name must be a non-empty string.")
            availability = self._ocr_provider.availability
            if not isinstance(availability, OCRProviderAvailability):
                raise TypeError("OCR provider must report an OCRProviderAvailability result.")
            if availability.provider_name != provider_name:
                raise ValueError("OCR provider availability must use the provider's stable name.")
            if not availability.available:
                return PageExtractionResult(
                    page_number=page_number,
                    text="",
                    extraction_method=ExtractionMethod.UNAVAILABLE,
                    confidence=None,
                    status=PageExtractionStatus.UNAVAILABLE,
                    ocr_required=True,
                    provider_name=provider_name,
                    error=f"OCR provider '{provider_name}' is unavailable: {availability.reason}",
                )
            recognition = self._ocr_provider.recognize_page(
                document_bytes,
                mime_type=mime_type,
                page_number=page_number,
            )
            if not isinstance(recognition, OCRRecognition):
                raise TypeError("OCR provider must return an OCRRecognition result.")
            if not recognition.text.strip():
                raise ValueError("OCR provider returned no text for the page.")
        except Exception as exc:
            return PageExtractionResult(
                page_number=page_number,
                text="",
                extraction_method=ExtractionMethod.UNAVAILABLE,
                confidence=None,
                status=PageExtractionStatus.FAILED,
                ocr_required=True,
                provider_name=provider_name,
                error=f"OCR provider failed for page {page_number}: {exc}",
            )

        return PageExtractionResult(
            page_number=page_number,
            text=recognition.text,
            extraction_method=ExtractionMethod.OCR,
            confidence=recognition.confidence,
            status=PageExtractionStatus.EXTRACTED,
            ocr_required=True,
            provider_name=provider_name,
        )
