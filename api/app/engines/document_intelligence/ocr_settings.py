"""Configuration and default-provider selection for local document OCR."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from math import isfinite

from app.engines.document_intelligence.ocr import OCRProvider


@dataclass(frozen=True, slots=True)
class OCRSettings:
    """Local OCR configuration, also readable from ``LAW_SENSE_OCR_*`` env vars."""

    provider: str = "tesseract"
    tesseract_command: str | None = None
    language: str = "eng"
    render_dpi: int = 240
    page_segmentation_mode: int = 3
    timeout_seconds: float = 60.0

    def __post_init__(self) -> None:
        if not isinstance(self.provider, str) or not self.provider.strip():
            raise ValueError("OCR provider setting must not be empty.")
        if not re.fullmatch(r"[A-Za-z0-9_+.-]+", self.language):
            raise ValueError("OCR language must be a Tesseract language code or combination.")
        if not 72 <= self.render_dpi <= 600:
            raise ValueError("OCR render DPI must be between 72 and 600.")
        if not 0 <= self.page_segmentation_mode <= 13:
            raise ValueError("Tesseract page segmentation mode must be between 0 and 13.")
        if not isfinite(self.timeout_seconds) or self.timeout_seconds <= 0:
            raise ValueError("OCR timeout must be greater than zero.")

    @classmethod
    def from_environment(cls) -> OCRSettings:
        """Read the process environment without loading any OCR engine."""
        return cls(
            provider=os.getenv("LAW_SENSE_OCR_PROVIDER", "tesseract").strip().casefold(),
            tesseract_command=_optional_environment_value("LAW_SENSE_TESSERACT_CMD"),
            language=os.getenv("LAW_SENSE_OCR_LANGUAGE", "eng").strip(),
            render_dpi=int(os.getenv("LAW_SENSE_OCR_RENDER_DPI", "240")),
            page_segmentation_mode=int(os.getenv("LAW_SENSE_OCR_PSM", "3")),
            timeout_seconds=float(os.getenv("LAW_SENSE_OCR_TIMEOUT_SECONDS", "60")),
        )


def build_configured_ocr_provider(settings: OCRSettings | None = None) -> OCRProvider | None:
    """Create the configured provider lazily; ``none`` explicitly disables OCR."""
    from app.engines.document_intelligence.tesseract_provider import (
        TesseractOCRProvider,
        UnavailableOCRProvider,
    )

    try:
        resolved = settings or OCRSettings.from_environment()
    except (TypeError, ValueError) as exc:
        return UnavailableOCRProvider("configuration", f"Invalid local OCR configuration: {exc}")

    if resolved.provider == "none":
        return None
    if resolved.provider == "tesseract":
        return TesseractOCRProvider(resolved)
    return UnavailableOCRProvider(
        resolved.provider,
        f"Unsupported local OCR provider '{resolved.provider}'. Supported values are 'tesseract' and 'none'.",
    )


def _optional_environment_value(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None
