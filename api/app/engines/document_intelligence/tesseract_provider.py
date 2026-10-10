"""Free, local Tesseract OCR adapter for images and scanned PDF pages."""

from __future__ import annotations

import csv
import importlib.util
import io
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from statistics import fmean
from typing import Any

from app.engines.document_intelligence.ocr import (
    OCRBackendUnavailable,
    OCRProviderAvailability,
    OCRRecognition,
)
from app.engines.document_intelligence.ocr_settings import OCRSettings


@dataclass(slots=True)
class TesseractOCRProvider:
    """Run the installed Tesseract executable and preserve its TSV word scores.

    PDF rendering is performed page by page with pypdfium2. Tesseract emits TSV
    containing the recognized words and per-word confidence; the adapter joins
    those literal words into lines and reports the mean of their scores.
    """

    settings: OCRSettings
    name: str = "tesseract"
    _availability_cache: OCRProviderAvailability | None = field(init=False, default=None, repr=False)
    _resolved_command: str | None = field(init=False, default=None, repr=False)

    @property
    def availability(self) -> OCRProviderAvailability:
        if self._availability_cache is None:
            self._availability_cache = self._inspect_availability()
        return self._availability_cache

    def recognize_page(
        self,
        document_bytes: bytes,
        *,
        mime_type: str,
        page_number: int,
    ) -> OCRRecognition:
        availability = self.availability
        if not availability.available:
            raise OCRBackendUnavailable(availability.reason or "Tesseract OCR is unavailable.")
        if not isinstance(document_bytes, bytes):
            raise TypeError("Document content must be bytes.")
        if page_number < 1:
            raise ValueError("Page numbers are one-based and must be positive.")

        image = self._render_page_image(document_bytes, mime_type=mime_type, page_number=page_number)
        with tempfile.TemporaryDirectory(prefix="lawsense-ocr-") as temporary_directory:
            image_path = Path(temporary_directory) / "page.png"
            image.save(image_path, format="PNG")
            completed = subprocess.run(
                [
                    self._resolved_command or "tesseract",
                    str(image_path),
                    "stdout",
                    "-l",
                    self.settings.language,
                    "--psm",
                    str(self.settings.page_segmentation_mode),
                    "tsv",
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.settings.timeout_seconds,
                check=False,
            )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or f"Tesseract exited with code {completed.returncode}."
            raise RuntimeError(f"Tesseract OCR failed for page {page_number}: {detail}")
        return _recognition_from_tsv(completed.stdout)

    def _inspect_availability(self) -> OCRProviderAvailability:
        configured_command = self.settings.tesseract_command
        resolved = _resolve_executable(configured_command) if configured_command else shutil.which("tesseract")
        if not resolved:
            return OCRProviderAvailability(
                self.name,
                False,
                "Tesseract executable was not found. Install Tesseract OCR or set "
                "LAW_SENSE_TESSERACT_CMD to its executable path.",
            )
        missing_modules = [
            module for module in ("PIL", "pypdfium2")
            if importlib.util.find_spec(module) is None
        ]
        if missing_modules:
            packages = ", ".join("Pillow" if module == "PIL" else "pypdfium2" for module in missing_modules)
            return OCRProviderAvailability(
                self.name,
                False,
                f"Python package(s) {packages} are missing; install the API requirements.",
            )
        self._resolved_command = resolved
        try:
            version = subprocess.run(
                [resolved, "--version"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return OCRProviderAvailability(
                self.name,
                False,
                f"Tesseract executable could not be started: {exc}",
            )
        if version.returncode != 0:
            detail = version.stderr.strip() or f"Tesseract exited with code {version.returncode}."
            return OCRProviderAvailability(self.name, False, f"Tesseract is not ready: {detail}")
        try:
            languages = subprocess.run(
                [resolved, "--list-langs"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return OCRProviderAvailability(
                self.name,
                False,
                f"Tesseract language data could not be checked: {exc}",
            )
        if languages.returncode != 0:
            detail = languages.stderr.strip() or f"Tesseract exited with code {languages.returncode}."
            return OCRProviderAvailability(self.name, False, f"Tesseract language data is unavailable: {detail}")
        installed_languages = set((languages.stdout + "\n" + languages.stderr).split())
        missing_languages = [
            language for language in self.settings.language.split("+")
            if language not in installed_languages
        ]
        if missing_languages:
            return OCRProviderAvailability(
                self.name,
                False,
                "Tesseract language data is missing for " + ", ".join(missing_languages) + ". "
                "Install the trained data or configure LAW_SENSE_OCR_LANGUAGE.",
            )
        return OCRProviderAvailability(self.name, True)

    def _render_page_image(self, document_bytes: bytes, *, mime_type: str, page_number: int) -> Any:
        from PIL import Image

        if mime_type == "application/pdf":
            import pypdfium2 as pdfium

            document = pdfium.PdfDocument(document_bytes)
            try:
                page_count = len(document)
                if page_number > page_count:
                    raise ValueError(
                        f"Requested PDF page {page_number}, but the document has {page_count} pages."
                    )
                page = document[page_number - 1]
                scale = self.settings.render_dpi / 72
                bitmap = page.render(scale=scale)
                try:
                    return bitmap.to_pil().convert("RGB").copy()
                finally:
                    bitmap.close()
            finally:
                document.close()

        if mime_type in {"image/png", "image/jpeg"}:
            with Image.open(io.BytesIO(document_bytes)) as source:
                source.load()
                return source.convert("RGB")

        raise ValueError(f"Tesseract OCR does not support MIME type '{mime_type}'.")


class UnavailableOCRProvider:
    """Retain a broken or unsupported provider setting as visible page state."""

    def __init__(self, name: str, reason: str) -> None:
        self._name = name or "unconfigured"
        self._reason = reason

    @property
    def name(self) -> str:
        return self._name

    @property
    def availability(self) -> OCRProviderAvailability:
        return OCRProviderAvailability(self._name, False, self._reason)

    def recognize_page(
        self,
        document_bytes: bytes,
        *,
        mime_type: str,
        page_number: int,
    ) -> OCRRecognition:
        del document_bytes, mime_type, page_number
        raise OCRBackendUnavailable(self._reason)


def _resolve_executable(command: str) -> str | None:
    path = Path(command).expanduser()
    if path.is_file():
        return str(path.resolve())
    return shutil.which(command)


def _recognition_from_tsv(tsv: str) -> OCRRecognition:
    rows = csv.DictReader(io.StringIO(tsv), delimiter="\t")
    output_lines: list[str] = []
    previous_line: tuple[str, str, str] | None = None
    scores: list[float] = []

    for row in rows:
        word = (row.get("text") or "").strip()
        if row.get("level") != "5" or not word:
            continue
        line = (row.get("block_num", ""), row.get("par_num", ""), row.get("line_num", ""))
        if previous_line is None:
            output_lines.append(word)
        elif line == previous_line:
            output_lines[-1] += f" {word}"
        else:
            output_lines.append(word)
        previous_line = line

        try:
            score = float(row.get("conf", ""))
        except (TypeError, ValueError):
            continue
        if 0.0 <= score <= 100.0:
            scores.append(score)

    confidence = fmean(scores) / 100 if scores else None
    return OCRRecognition(text="\n".join(output_lines), confidence=confidence)
