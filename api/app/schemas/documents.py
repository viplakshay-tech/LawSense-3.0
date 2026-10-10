"""API response contracts for locally processed document uploads."""

from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.case_state import CaseDocument, EvidenceProvenance


class ExtractedDocumentValue(BaseModel):
    field: str
    value: Any
    provenance: EvidenceProvenance


class DocumentUploadResponse(BaseModel):
    caseId: str
    documentId: str
    processingStatus: Literal["extracted", "ocr_required", "failed"]
    document: CaseDocument
    extractedValues: list[ExtractedDocumentValue]
