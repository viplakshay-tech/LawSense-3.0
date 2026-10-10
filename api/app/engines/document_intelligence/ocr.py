"""OCR provider contract. Implementations may use local engines only."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Protocol


class OCRBackend(Protocol):
    """Legacy string-only adapter kept for the existing document pipeline."""

    def extract_text(self, document_bytes: bytes, *, mime_type: str, page_number: int) -> str:
        """Recognize one one-based page from an image or PDF document."""


class OCRBackendUnavailable(RuntimeError):
    """Raised by explicit OCR requests when no local provider is configured."""


@dataclass(frozen=True, slots=True)
class OCRRecognition:
    """Text and provider-reported confidence for one recognized page.

    Confidence is normalized to the inclusive range 0..1. ``None`` means the
    provider does not expose a confidence score; callers must not infer one.
    """

    text: str
    confidence: float | None

    def __post_init__(self) -> None:
        if not isinstance(self.text, str):
            raise TypeError("OCR recognition text must be a string.")
        if self.confidence is not None and (
            not isinstance(self.confidence, (int, float))
            or not isfinite(self.confidence)
            or not 0.0 <= self.confidence <= 1.0
        ):
            raise ValueError("OCR confidence must be between 0 and 1, or None.")


@dataclass(frozen=True, slots=True)
class OCRProviderAvailability:
    """An explicit, inspectable statement of whether a provider can run."""

    provider_name: str
    available: bool
    reason: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.provider_name, str) or not self.provider_name.strip():
            raise ValueError("OCR provider name must be a non-empty string.")
        if self.available and self.reason:
            raise ValueError("An available OCR provider cannot have an unavailability reason.")
        if not self.available and (not isinstance(self.reason, str) or not self.reason.strip()):
            raise ValueError("An unavailable OCR provider must explain why it cannot run.")


class OCRProvider(Protocol):
    """Provider-neutral OCR contract; local/open-source adapters are preferred.

    Implementations own any page rendering they need and return only actual
    provider output. The boundary itself has no OCR engine or paid API dependency.
    """

    @property
    def name(self) -> str:
        """Stable provider identifier recorded in page provenance."""

    @property
    def availability(self) -> OCRProviderAvailability:
        """Whether the configured local engine and its required tools are ready."""

    def recognize_page(
        self,
        document_bytes: bytes,
        *,
        mime_type: str,
        page_number: int,
    ) -> OCRRecognition:
        """Recognize one one-based page and report provider confidence."""


def ocr_unavailable_message() -> str:
    return "OCR is required for this page, but no local OCR backend is configured."
