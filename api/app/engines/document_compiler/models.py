"""Contracts for traceable, user-reviewed legal document compilation."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class DocumentType(StrEnum):
    FORMAL_DEMAND_REPRESENTATION = "formal_demand_representation"
    COMPLAINT_DRAFT = "complaint_draft"
    GRIEVANCE_APPLICATION = "grievance_application"
    NOTICE_RESPONSE = "notice_response"
    SUPPORTING_STATEMENT_CHRONOLOGY = "supporting_statement_chronology"
    EVIDENCE_INDEX = "evidence_index"
    FILING_CHECKLIST = "filing_checklist"


class DocumentReviewState(StrEnum):
    DRAFT = "draft"
    REVIEWED = "reviewed"
    STALE = "stale"


class DocumentFieldStatus(StrEnum):
    USER_REPORTED = "user_reported"
    EVIDENCE_SUPPORTED = "evidence_supported"
    USER_AUTHORED = "user_authored"
    SYSTEM_INFERRED = "system_inferred"
    UNSUPPORTED = "unsupported"
    MISSING = "missing"
    CONFLICTING = "conflicting"


class DocumentProvenance(BaseModel):
    """A source pointer for one value or phrase in a compiled document."""

    sourceType: Literal[
        "evidence", "document", "case_fact", "case_statement", "case_event",
        "case_state", "legal_source", "template", "user_edit", "unresolved_evidence",
    ]
    sourceId: str
    label: str
    status: str
    documentId: str | None = None
    pageNumber: int | None = None
    confidence: float | None = None
    sourceUrl: str | None = None
    reference: str | None = None
    confirmedByUser: bool | None = None


class DocumentFieldTemplate(BaseModel):
    id: str
    label: str
    required: bool = False
    material: bool = False
    multiline: bool = False


class DocumentTemplateSection(BaseModel):
    heading: str
    fieldIds: list[str] = Field(default_factory=list)


class DocumentTemplate(BaseModel):
    id: str
    documentType: DocumentType
    title: str
    description: str
    fields: list[DocumentFieldTemplate]
    sections: list[DocumentTemplateSection]
    disclaimer: str = "Draft only. Review every statement and source before use."


class CaseFactFieldMapping(BaseModel):
    factId: str
    factKey: str
    fieldId: str
    mappingRule: Literal["exact_key_alias", "selected_fact_fallback", "selected_event"] = "exact_key_alias"
    fieldStatus: DocumentFieldStatus
    provenance: list[DocumentProvenance] = Field(default_factory=list)


class FieldConflictValue(BaseModel):
    value: str
    sourceFactIds: list[str] = Field(default_factory=list)
    provenance: list[DocumentProvenance] = Field(default_factory=list)


class DocumentField(BaseModel):
    id: str
    label: str
    value: str | None = None
    status: DocumentFieldStatus
    required: bool = False
    material: bool = False
    sourceFactIds: list[str] = Field(default_factory=list)
    sourceEvidenceIds: list[str] = Field(default_factory=list)
    provenance: list[DocumentProvenance] = Field(default_factory=list)
    conflicts: list[FieldConflictValue] = Field(default_factory=list)
    missingMarker: str | None = None
    legalSourceId: str | None = None


class DocumentConflict(BaseModel):
    id: str
    summary: str
    fieldId: str | None = None
    sourceIds: list[str] = Field(default_factory=list)


class DocumentDraft(BaseModel):
    id: str
    caseId: str
    templateId: str
    documentType: DocumentType
    title: str
    fields: dict[str, DocumentField]
    factMappings: list[CaseFactFieldMapping] = Field(default_factory=list)
    conflicts: list[DocumentConflict] = Field(default_factory=list)
    unsupportedMaterialFactIds: list[str] = Field(default_factory=list)
    missingInformation: list[str] = Field(default_factory=list)
    content: str
    sourceCaseFingerprint: str
    sourceCaseUpdatedAt: str
    reviewState: DocumentReviewState = DocumentReviewState.DRAFT
    confirmedAt: str | None = None
    missingInformationAcknowledged: bool = False
    createdAt: str
    updatedAt: str


class DocumentPackage(BaseModel):
    id: str
    caseId: str
    title: str
    documents: list[DocumentDraft]
    sourceCaseFingerprint: str
    sourceCaseUpdatedAt: str
    createdAt: str
    updatedAt: str


class ExportReadyDocument(BaseModel):
    status: Literal["ready", "blocked"]
    documentId: str
    caseId: str
    filename: str
    content: str
    contentSha256: str
    sourceCaseFingerprint: str
    provenance: list[DocumentProvenance] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)


class ExportReadyPackage(BaseModel):
    status: Literal["ready", "blocked"]
    packageId: str
    caseId: str
    filename: str
    documents: list[ExportReadyDocument]
    blockers: list[str] = Field(default_factory=list)
    createdAt: str


class CreateDocumentDraftRequest(BaseModel):
    templateId: str
    fieldValues: dict[str, str] = Field(default_factory=dict)
    legalSourceIds: dict[str, str] = Field(default_factory=dict)
    includedFactIds: list[str] | None = None
    factEdits: dict[str, str] = Field(default_factory=dict)


class EditDocumentDraftRequest(BaseModel):
    fieldValues: dict[str, str] = Field(default_factory=dict)
    legalSourceIds: dict[str, str] = Field(default_factory=dict)


class ConfirmDocumentDraftRequest(BaseModel):
    acknowledgeMissingInformation: bool = False


class CreateDocumentPackageRequest(BaseModel):
    templateIds: list[str] = Field(default_factory=list)
    fieldValuesByTemplate: dict[str, dict[str, str]] = Field(default_factory=dict)
    legalSourceIdsByTemplate: dict[str, dict[str, str]] = Field(default_factory=dict)
    includedFactIdsByTemplate: dict[str, list[str]] = Field(default_factory=dict)
    factEditsByTemplate: dict[str, dict[str, str]] = Field(default_factory=dict)

