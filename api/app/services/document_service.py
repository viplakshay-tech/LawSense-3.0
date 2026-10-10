"""Compatibility exports for document processing integrations.

Older callers and test harnesses configure ``DATA_DIR`` through this module.
Keep that configuration effective for every stored-document operation while
the implementation lives in :mod:`document_case.service`.
"""

from pathlib import Path

from app.core.config import DATA_DIR
from app.engines.document_intelligence.models import DocumentResult
from app.engines.document_intelligence.ocr import OCRBackend
from app.engines.document_intelligence.structured_extraction import StructuredExtractor
from app.engines.document_review import DocumentReview
from app.schemas.case_state import CaseState
from app.services.document_case import service as _service

DocumentConfirmationError = _service.DocumentConfirmationError
DocumentNotFoundError = _service.DocumentNotFoundError
document_fact_key = _service.document_fact_key
normalize_unconfirmed_document_evidence = _service.normalize_unconfirmed_document_evidence


def process_document(
    document_bytes: bytes,
    filename: str,
    *,
    document_id: str | None = None,
    ocr_backend: OCRBackend | None = None,
    structured_extractor: StructuredExtractor | None = None,
) -> DocumentResult:
    return _service.process_document(
        document_bytes,
        filename,
        document_id=document_id,
        ocr_backend=ocr_backend,
        structured_extractor=structured_extractor,
    )


def upload_document_for_case(
    case_id: str,
    document_bytes: bytes,
    filename: str,
) -> tuple[CaseState, DocumentResult, _service.CaseDocument] | None:
    return _service.upload_document_for_case(
        case_id,
        document_bytes,
        filename,
        data_dir=DATA_DIR,
    )


def review_stored_document_for_case(case_id: str, document_id: str) -> DocumentReview | None:
    return _service.review_stored_document_for_case(case_id, document_id, data_dir=DATA_DIR)


def confirm_document_findings_for_case(
    case_id: str,
    document_id: str,
    finding_ids: list[str],
) -> CaseState | None:
    return _service.confirm_document_findings_for_case(
        case_id,
        document_id,
        finding_ids,
        data_dir=DATA_DIR,
    )


def integrate_document_evidence(case_state: CaseState, result: DocumentResult) -> CaseState:
    return _service.integrate_document_evidence(case_state, result)


__all__ = [
    "DATA_DIR",
    "DocumentConfirmationError",
    "DocumentNotFoundError",
    "confirm_document_findings_for_case",
    "document_fact_key",
    "integrate_document_evidence",
    "normalize_unconfirmed_document_evidence",
    "process_document",
    "review_stored_document_for_case",
    "upload_document_for_case",
]
