from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.case_analysis import CaseAnalysis


ConfidenceLevel = Literal["high", "medium", "low", "unknown"]

InformationStatus = Literal[
    "user_reported",
    "evidence_supported",
    "system_inferred",
    "assumption",
    "conflicting",
    "unknown",
]


class EvidenceProvenance(BaseModel):
    """Exact source details for a value extracted from an uploaded document."""

    documentId: str
    pageNumber: int = Field(..., ge=1)
    confidence: float = Field(..., ge=0, le=1)
    status: InformationStatus
    extractionMethod: str
    source: Literal["document"] = "document"
    confirmedByUser: bool = False
    confirmedAt: Optional[str] = None


class CaseFact(BaseModel):
    id: str
    key: str
    value: Any
    status: InformationStatus
    confidence: ConfidenceLevel
    sourceIds: list[str] = Field(default_factory=list)
    notes: Optional[str] = None
    provenance: list[EvidenceProvenance] = Field(default_factory=list)


class CaseDocumentPage(BaseModel):
    pageNumber: int = Field(..., ge=1)
    extractionMethod: str
    processingStatus: Literal["extracted", "ocr_required", "failed"]
    textLength: int = Field(..., ge=0)
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    providerName: Optional[str] = None


class CaseDocumentConfirmation(BaseModel):
    """Audit record for findings explicitly accepted by the user."""

    confirmedAt: str
    findingIds: list[str] = Field(default_factory=list)


class CaseDocument(BaseModel):
    """Persisted upload metadata; document bytes remain in local storage."""

    id: str
    filename: str
    mimeType: Literal["application/pdf", "image/png", "image/jpeg"]
    extension: Literal[".pdf", ".png", ".jpg", ".jpeg"]
    fileSize: int = Field(..., ge=1)
    sha256: str
    pageCount: int = Field(..., ge=0)
    processingTimestamp: str
    processingStatus: Literal["extracted", "ocr_required", "failed"]
    classification: str
    classificationConfidence: float = Field(..., ge=0, le=1)
    classificationSignals: list[str] = Field(default_factory=list)
    pages: list[CaseDocumentPage] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    reviewStatus: Literal["awaiting_confirmation", "confirmed"] = "awaiting_confirmation"
    confirmationHistory: list[CaseDocumentConfirmation] = Field(default_factory=list)


class Party(BaseModel):
    id: str
    name: Optional[str] = None
    role: str
    relationship: Optional[str] = None
    attributes: dict[str, Any] = Field(default_factory=dict)


class CaseEvent(BaseModel):
    id: str
    type: str
    description: str
    date: Optional[str] = None
    datePrecision: Literal["exact", "approximate", "unknown"] = "unknown"
    partyIds: list[str] = Field(default_factory=list)
    evidenceIds: list[str] = Field(default_factory=list)


class EvidenceItem(BaseModel):
    id: str
    type: str
    title: str
    source: Literal["user", "document", "system"]
    status: InformationStatus
    documentId: Optional[str] = None
    extractedFacts: list[str] = Field(default_factory=list)
    supportsClaimIds: list[str] = Field(default_factory=list)
    conflictsWithClaimIds: list[str] = Field(default_factory=list)
    processingStatus: Optional[Literal["extracted", "ocr_required", "failed"]] = None


class LegalIssue(BaseModel):
    id: str
    category: str
    subcategory: Optional[str] = None
    confidence: ConfidenceLevel
    rationale: list[str] = Field(default_factory=list)


class Jurisdiction(BaseModel):
    country: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    locationText: Optional[str] = None
    basis: Literal[
        "user_reported",
        "document",
        "inferred",
        "unknown",
    ] = "unknown"


class CaseClaim(BaseModel):
    id: str
    text: str
    status: InformationStatus
    evidenceIds: list[str] = Field(default_factory=list)


class CaseIntent(BaseModel):
    objective: str
    urgency: Literal["low", "medium", "high", "critical"] = "low"


class CasePerson(BaseModel):
    name: Optional[str] = None
    contact: Optional[str] = None


class CaseMetadata(BaseModel):
    createdAt: str
    updatedAt: str
    language: Optional[str] = None


class CaseState(BaseModel):
    id: str
    title: Optional[str] = None
    initialStatement: Optional[str] = None

    person: CasePerson = Field(default_factory=CasePerson)

    parties: list[Party] = Field(default_factory=list)
    facts: list[CaseFact] = Field(default_factory=list)
    events: list[CaseEvent] = Field(default_factory=list)
    evidence: list[EvidenceItem] = Field(default_factory=list)
    documents: list[CaseDocument] = Field(default_factory=list)

    claims: list[CaseClaim] = Field(default_factory=list)

    jurisdiction: Jurisdiction = Field(default_factory=Jurisdiction)

    legalIssues: list[LegalIssue] = Field(default_factory=list)

    intent: Optional[CaseIntent] = None

    unknowns: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    # Skipping a clarification records only that the question was dismissed;
    # it does not resolve the underlying unknown or create a case fact.
    skippedClarificationIds: list[str] = Field(default_factory=list)

    metadata: CaseMetadata

    # Derived analyses live on the canonical case record and never replace its
    # facts, claims, evidence, or provenance. Older stored CaseStates may omit it.
    analysis: Optional[CaseAnalysis] = None
