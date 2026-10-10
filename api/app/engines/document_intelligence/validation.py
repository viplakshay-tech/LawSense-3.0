"""Document signatures, safe type detection, and metadata construction."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import PurePath

from app.engines.document_intelligence.models import DocumentMetadata


class DocumentValidationError(ValueError):
    """Raised when an upload is empty, unsupported, or inconsistent."""


_TYPES: tuple[tuple[bytes, str, str], ...] = (
    (b"%PDF-", "application/pdf", ".pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
)
MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024


def detect_document_type(data: bytes) -> tuple[str, str]:
    """Return MIME type and canonical extension from content, not user claims."""
    for signature, mime_type, extension in _TYPES:
        if data.startswith(signature):
            return mime_type, extension
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    raise DocumentValidationError("File content is not a supported PDF, PNG, or JPEG document.")


def build_metadata(data: bytes, filename: str, page_count: int) -> DocumentMetadata:
    if not isinstance(data, bytes):
        raise DocumentValidationError("Document content must be bytes.")
    if not data:
        raise DocumentValidationError("Document is empty.")
    if len(data) > MAX_DOCUMENT_SIZE_BYTES:
        raise DocumentValidationError(
            f"Document exceeds the {MAX_DOCUMENT_SIZE_BYTES}-byte size limit."
        )
    if not isinstance(filename, str) or not filename.strip():
        raise DocumentValidationError("A filename is required.")

    mime_type, extension = detect_document_type(data)
    supplied_extension = PurePath(filename).suffix.lower()
    expected_extensions = {extension}
    if mime_type == "image/jpeg":
        expected_extensions.update({".jpeg", ".jpg"})
    if supplied_extension not in expected_extensions:
        raise DocumentValidationError("Filename extension does not match the detected document type.")

    return DocumentMetadata(
        filename=PurePath(filename).name,
        mime_type=mime_type,
        extension=supplied_extension,
        file_size=len(data),
        page_count=page_count,
        sha256=hashlib.sha256(data).hexdigest(),
        processing_timestamp=datetime.now(timezone.utc).isoformat(),
    )
