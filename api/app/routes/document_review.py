"""HTTP boundary for document review of transient uploaded content."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import Field
from starlette.concurrency import run_in_threadpool

from app.engines.document_intelligence.pipeline import DocumentProcessingError
from app.engines.document_intelligence.validation import (
    MAX_DOCUMENT_SIZE_BYTES,
    DocumentValidationError,
)
from app.engines.document_review import review_document as run_document_review
from app.services.case_service import get_case_state
from app.services.document_service import (
    DocumentConfirmationError,
    DocumentNotFoundError,
    confirm_document_findings_for_case,
    process_document,
    review_stored_document_for_case,
)
from app.schemas.case_analysis import AnalysisModel
from app.schemas.case_state import CaseState


router = APIRouter(prefix="/cases", tags=["document-review"])


class TextLocationResponse(AnalysisModel):
    start: int
    end: int


class ReviewProvenanceResponse(AnalysisModel):
    source: str
    document_id: str | None = None
    case_state_id: str | None = None
    page_number: int | None = None
    location: TextLocationResponse | None = None
    extraction_method: str | None = None


class ReviewFindingResponse(AnalysisModel):
    id: str
    category: str
    value: Any
    text: str | None = None
    source: str
    provenance: list[ReviewProvenanceResponse] = Field(default_factory=list)
    confidence: float
    nature: Literal["extraction", "interpretation"]
    status: Literal["extracted", "candidate", "uncertain", "potential_conflict"]
    note: str | None = None
    upstream_status: str | None = None


class DocumentReviewResponse(AnalysisModel):
    case_id: str
    status: Literal["available", "partial", "unavailable"]
    document_id: str
    processing_status: str
    findings: list[ReviewFindingResponse] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class ConfirmDocumentFindingsRequest(AnalysisModel):
    findingIds: list[str] = Field(..., min_length=1)


@router.post("/{case_id}/documents/review", response_model=DocumentReviewResponse)
async def review_case_document(
    case_id: str,
    file: UploadFile = File(...),
    document_id: str | None = Form(default=None),
) -> DocumentReviewResponse:
    """Review one document while preserving its stored document identity."""
    case_state = get_case_state(case_id)
    if case_state is None:
        raise HTTPException(status_code=404, detail="Case not found")
    if document_id is not None and not any(item.id == document_id for item in case_state.documents):
        raise HTTPException(status_code=404, detail="Document not found for this case")

    document_bytes = await file.read(MAX_DOCUMENT_SIZE_BYTES + 1)
    if len(document_bytes) > MAX_DOCUMENT_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Document exceeds the {MAX_DOCUMENT_SIZE_BYTES}-byte size limit.",
        )

    try:
        result = await run_in_threadpool(
            process_document,
            document_bytes,
            file.filename or "",
            document_id=document_id,
        )
    except (DocumentValidationError, DocumentProcessingError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    review = run_document_review(result, case_state)
    return _review_response(case_state.id, review)


@router.get("/{case_id}/documents/{document_id}/review", response_model=DocumentReviewResponse)
async def review_stored_case_document(case_id: str, document_id: str) -> DocumentReviewResponse:
    """Review a previously uploaded document using its stored source bytes."""
    try:
        review = await run_in_threadpool(review_stored_document_for_case, case_id, document_id)
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (DocumentValidationError, DocumentProcessingError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if review is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return _review_response(case_id, review)


@router.post("/{case_id}/documents/{document_id}/confirm", response_model=CaseState)
async def confirm_case_document_findings(
    case_id: str,
    document_id: str,
    payload: ConfirmDocumentFindingsRequest,
) -> CaseState:
    """Promote only the user's selected extraction findings into CaseState."""
    try:
        case_state = await run_in_threadpool(
            confirm_document_findings_for_case,
            case_id,
            document_id,
            payload.findingIds,
        )
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DocumentConfirmationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (DocumentValidationError, DocumentProcessingError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if case_state is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case_state


def _review_response(case_id: str, review: Any) -> DocumentReviewResponse:
    findings = [
        ReviewFindingResponse(
            id=item.id,
            category=item.category,
            value=item.value,
            text=item.text,
            source=item.source,
            provenance=[
                ReviewProvenanceResponse(
                    source=reference.source,
                    document_id=reference.document_id,
                    case_state_id=reference.case_state_id,
                    page_number=reference.page_number,
                    location=(
                        TextLocationResponse(start=reference.location.start, end=reference.location.end)
                        if reference.location is not None
                        else None
                    ),
                    extraction_method=reference.extraction_method,
                    # The source text itself is deliberately omitted. Its page and character
                    # location retain the provenance without echoing a document passage twice.
                )
                for reference in item.provenance
            ],
            confidence=item.confidence,
            nature=item.nature,
            status=item.status,
            note=item.note,
            upstream_status=item.upstream_status,
        )
        for item in review.findings
    ]
    result_status: Literal["available", "partial", "unavailable"]
    if review.processing_status == "failed":
        result_status = "unavailable"
    elif review.processing_status == "ocr_required":
        result_status = "partial"
    else:
        result_status = "available"

    return DocumentReviewResponse(
        case_id=case_id,
        status=result_status,
        document_id=review.document_id,
        processing_status=review.processing_status,
        findings=findings,
        errors=list(review.errors),
    )
