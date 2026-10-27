"""Connect existing document processing and review engines to CaseState.

Uploads are retained as pending evidence. Only finding IDs explicitly
confirmed by the user are promoted into CaseState facts.
"""

from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.core.config import DATA_DIR
from app.core.storage_security import ensure_private_directory
from app.services.case_operation_lock import case_operation_serialized
from app.db.database import get_case, save_case
from app.engines.document_intelligence.models import (
    Classification,
    DocumentProcessingStatus,
    DocumentResult,
    Evidence,
)
from app.engines.document_intelligence.ocr import OCRBackend, OCRProvider
from app.engines.document_intelligence.page_extraction import PageExtractionCoordinator
from app.engines.document_intelligence.pipeline import (
    DocumentProcessingError,
    process_document as run_document_pipeline,
)
from app.engines.document_intelligence.structured_extraction import StructuredExtractor
from app.engines.document_intelligence.validation import build_metadata
from app.engines.document_review import DocumentReview, review_document
from app.schemas.case_state import (
    CaseDocument,
    CaseDocumentConfirmation,
    CaseDocumentPage,
    CaseFact,
    CaseState,
    EvidenceItem,
    EvidenceProvenance,
)
from app.services.analysis_service import build_case_analysis


class DocumentNotFoundError(ValueError):
    """The requested uploaded document does not belong to the case."""


class DocumentConfirmationError(ValueError):
    """The submitted finding IDs cannot be confirmed for this document."""


def process_document(
    document_bytes: bytes,
    filename: str,
    *,
    document_id: str | None = None,
    ocr_backend: OCRBackend | None = None,
    ocr_provider: OCRProvider | None = None,
    extraction_coordinator: PageExtractionCoordinator | None = None,
    structured_extractor: StructuredExtractor | None = None,
) -> DocumentResult:
    """Run the existing document-intelligence engine without changing output."""
    return run_document_pipeline(
        document_bytes,
        filename,
        document_id=document_id,
        ocr_backend=ocr_backend,
        ocr_provider=ocr_provider,
        extraction_coordinator=extraction_coordinator,
        structured_extractor=structured_extractor,
    )


@case_operation_serialized
def upload_document_for_case(
    case_id: str,
    document_bytes: bytes,
    filename: str,
    *,
    data_dir: Path | None = None,
) -> tuple[CaseState, DocumentResult, CaseDocument] | None:
    """Validate, store, process, and attach one pending document source."""
    case_state = get_case(case_id)
    if case_state is None:
        return None
    case_state = normalize_unconfirmed_document_evidence(case_state)

    metadata = build_metadata(document_bytes, filename, page_count=0)
    document_id = uuid4().hex
    stored_path = _document_storage_path(case_id, document_id, metadata.extension, data_dir=data_dir)
    _store_document_bytes(stored_path, document_bytes)

    try:
        try:
            result = process_document(
                document_bytes,
                metadata.filename,
                document_id=document_id,
            )
        except DocumentProcessingError as exc:
            result = DocumentResult(
                document_id=document_id,
                metadata=metadata,
                classification=Classification(category="unknown", confidence=0.0),
                pages=(),
                evidence=(),
                status=DocumentProcessingStatus.FAILED,
                errors=(str(exc),),
            )
        except Exception:
            result = DocumentResult(
                document_id=document_id,
                metadata=metadata,
                classification=Classification(category="unknown", confidence=0.0),
                pages=(),
                evidence=(),
                status=DocumentProcessingStatus.FAILED,
                errors=("Local document processing failed unexpectedly.",),
            )

        updated = integrate_document_evidence(case_state, result)
        document = next(item for item in updated.documents if item.id == document_id)
        save_case(updated)
    except Exception:
        stored_path.unlink(missing_ok=True)
        raise

    return updated, result, document


def review_stored_document_for_case(
    case_id: str,
    document_id: str,
    *,
    data_dir: Path | None = None,
) -> DocumentReview | None:
    """Re-run the existing engines against the bytes stored for this case."""
    case_state = get_case(case_id)
    if case_state is None:
        return None
    case_state = normalize_unconfirmed_document_evidence(case_state)
    document = _case_document_by_id(case_state, document_id)
    path = _stored_document_path(case_id, document, data_dir=data_dir)
    if not path.is_file():
        raise DocumentNotFoundError("Stored document bytes are unavailable.")
    result = process_document(path.read_bytes(), document.filename, document_id=document.id)
    return review_document(result, case_state)


def confirm_document_findings_for_case(
    case_id: str,
    document_id: str,
    finding_ids: list[str],
    *,
    data_dir: Path | None = None,
) -> CaseState | None:
    """Promote explicitly selected review findings and refresh case projections."""
    case_state = get_case(case_id)
    if case_state is None:
        return None
    case_state = normalize_unconfirmed_document_evidence(case_state)
    document = _case_document_by_id(case_state, document_id)
    if not finding_ids:
        raise DocumentConfirmationError("Select at least one finding to confirm.")

    path = _stored_document_path(case_id, document, data_dir=data_dir)
    if not path.is_file():
        raise DocumentNotFoundError("Stored document bytes are unavailable.")

    result = process_document(path.read_bytes(), document.filename, document_id=document.id)
    review = review_document(result, case_state)
    findings_by_id = {finding.id: finding for finding in review.findings}
    requested_ids = list(dict.fromkeys(finding_ids))
    selected_findings = [findings_by_id.get(finding_id) for finding_id in requested_ids]

    if any(finding is None for finding in selected_findings):
        raise DocumentConfirmationError(
            "One or more findings are no longer available for this document. Review it again before confirming."
        )
    eligible = [
        finding
        for finding in selected_findings
        if finding is not None
        and finding.nature == "extraction"
        and finding.status in {"extracted", "candidate"}
        and finding.upstream_status is not None
    ]
    if len(eligible) != len(selected_findings):
        raise DocumentConfirmationError(
            "Only direct document extraction findings can be confirmed into CaseState facts."
        )

    selected_ids = {finding.id for finding in eligible}
    confirmed_evidence = _evidence_for_confirmed_findings(result, review, selected_ids)
    if not confirmed_evidence:
        raise DocumentConfirmationError("The selected findings do not map to source evidence.")

    updated = case_state.model_copy(deep=True)
    updated_document = _case_document_by_id(updated, document_id)
    evidence_id = _document_evidence_id(document_id)
    evidence_item = next(
        (item for item in updated.evidence if item.documentId == document_id),
        None,
    )
    if evidence_item is None:
        evidence_item = EvidenceItem(
            id=evidence_id,
            type=result.classification.category,
            title=result.metadata.filename,
            source="document",
            status="unknown",
            documentId=document_id,
            processingStatus=result.status.value,
        )
        updated.evidence.append(evidence_item)

    confirmed_at = datetime.now(timezone.utc).isoformat()
    fact_ids: list[str] = []
    conflicts: list[str] = []
    for item in confirmed_evidence:
        key = document_fact_key(item, result)
        fact_id = _document_fact_id(result.document_id, item)
        fact_ids.append(fact_id)
        existing_fact = next((fact for fact in updated.facts if fact.id == fact_id), None)
        has_conflict = any(
            fact.id != fact_id
            and fact.key == key
            and _normalized_fact_value(fact.value) != _normalized_fact_value(item.value)
            for fact in updated.facts
        )
        fact_status = "conflicting" if has_conflict else "evidence_supported"
        provenance = EvidenceProvenance(
            documentId=document_id,
            pageNumber=item.page_number,
            confidence=item.confidence,
            status=fact_status,
            extractionMethod=item.extraction_method,
            confirmedByUser=True,
            confirmedAt=confirmed_at,
        )
        if existing_fact is not None:
            existing_fact.status = fact_status
            existing_fact.confidence = _confidence_label(item.confidence)
            existing_fact.sourceIds = list(dict.fromkeys([*existing_fact.sourceIds, evidence_id]))
            existing_fact.notes = (
                "Confirmed by the user on "
                f"{confirmed_at}; page {item.page_number}; extracted by "
                f"{item.extraction_method}; extractor confidence {item.confidence:.2f}."
            )
            existing_fact.provenance = [
                source for source in existing_fact.provenance if source.documentId != document_id
            ] + [provenance]
            if has_conflict:
                conflicts.append(f"User-confirmed document evidence for {key} conflicts with an existing CaseState fact.")
            continue

        updated.facts.append(
            CaseFact(
                id=fact_id,
                key=key,
                value=item.value,
                status=fact_status,
                confidence=_confidence_label(item.confidence),
                sourceIds=[evidence_id],
                notes=(
                    "Confirmed by the user on "
                    f"{confirmed_at}; page {item.page_number}; extracted by "
                    f"{item.extraction_method}; extractor confidence {item.confidence:.2f}."
                ),
                provenance=[provenance],
            )
        )
        if has_conflict:
            conflicts.append(f"User-confirmed document evidence for {key} conflicts with an existing CaseState fact.")

    evidence_item.extractedFacts = list(dict.fromkeys([*evidence_item.extractedFacts, *fact_ids]))
    evidence_item.status = "conflicting" if conflicts else "evidence_supported"
    updated_document.confirmationHistory.append(
        CaseDocumentConfirmation(confirmedAt=confirmed_at, findingIds=[item.id for item in eligible])
    )
    updated_document.reviewStatus = "confirmed"
    for conflict in conflicts:
        if conflict not in updated.conflicts:
            updated.conflicts.append(conflict)

    updated.metadata.updatedAt = confirmed_at
    if updated.initialStatement and updated.initialStatement.strip():
        updated.analysis = build_case_analysis(updated)
    save_case(updated)
    return updated


def integrate_document_evidence(case_state: CaseState, result: DocumentResult) -> CaseState:
    """Attach document metadata as pending evidence without creating facts."""
    updated = case_state.model_copy(deep=True)
    if not any(item.id == result.document_id for item in updated.documents):
        updated.documents.append(_case_document(result))

    if not any(item.documentId == result.document_id for item in updated.evidence):
        updated.evidence.append(
            EvidenceItem(
                id=_document_evidence_id(result.document_id),
                type=result.classification.category,
                title=result.metadata.filename,
                source="document",
                status="unknown",
                documentId=result.document_id,
                extractedFacts=[],
                processingStatus=result.status.value,
            )
        )

    updated.metadata.updatedAt = datetime.now(timezone.utc).isoformat()
    if updated.initialStatement and updated.initialStatement.strip():
        updated.analysis = build_case_analysis(updated)
    return updated


def normalize_unconfirmed_document_evidence(case_state: CaseState) -> CaseState:
    """Downgrade legacy upload-time extractions that have no confirmation audit."""
    updated = case_state.model_copy(deep=True)
    pending_evidence_ids: set[str] = set()
    downgraded_keys: set[str] = set()
    for document in updated.documents:
        evidence_id = _document_evidence_id(document.id)
        pending_evidence_ids.add(evidence_id)
        for fact in updated.facts:
            provenance_for_document = [
                item for item in fact.provenance if item.documentId == document.id
            ]
            if not provenance_for_document or any(item.confirmedByUser for item in provenance_for_document):
                continue
            if fact.status in {"evidence_supported", "conflicting"}:
                fact.status = "unknown"
                downgraded_keys.add(fact.key)
            for provenance in provenance_for_document:
                provenance.status = "unknown"

    confirmed_fact_ids = {
        fact.id
        for fact in updated.facts
        if any(item.confirmedByUser for item in fact.provenance)
    }
    for evidence in updated.evidence:
        if evidence.id not in pending_evidence_ids:
            continue
        evidence.extractedFacts = [
            fact_id for fact_id in evidence.extractedFacts if fact_id in confirmed_fact_ids
        ]
        if not evidence.extractedFacts:
            evidence.status = "unknown"
        elif any(
            fact.status == "conflicting" and fact.id in evidence.extractedFacts
            for fact in updated.facts
        ):
            evidence.status = "conflicting"
        else:
            evidence.status = "evidence_supported"
    updated.conflicts = [
        conflict
        for conflict in updated.conflicts
        if not any(conflict.startswith(f"Document evidence for {key} conflicts") for key in downgraded_keys)
    ]
    if not downgraded_keys and updated == case_state:
        return case_state
    updated.metadata.updatedAt = datetime.now(timezone.utc).isoformat()
    if updated.initialStatement and updated.initialStatement.strip():
        updated.analysis = build_case_analysis(updated)
    save_case(updated)
    return updated


def _case_document_by_id(case_state: CaseState, document_id: str) -> CaseDocument:
    document = next((item for item in case_state.documents if item.id == document_id), None)
    if document is None:
        raise DocumentNotFoundError("Document not found for this case.")
    return document


def _document_storage_root(data_dir: Path | None = None) -> Path:
    candidate = (data_dir or DATA_DIR) / "documents"
    if candidate.is_symlink():
        raise ValueError("The local document store must not be a symbolic link.")
    root = candidate.resolve()
    ensure_private_directory(root)
    return root


def _document_storage_path(
    case_id: str,
    document_id: str,
    extension: str,
    *,
    data_dir: Path | None = None,
) -> Path:
    root = _document_storage_root(data_dir)
    case_key = hashlib.sha256(case_id.encode("utf-8")).hexdigest()[:32]
    directory = ensure_private_directory(root / case_key)
    path = directory / f"{document_id}{extension}"
    if not path.resolve().is_relative_to(root):
        raise ValueError("Resolved document path escaped the local document store.")
    return path


def _stored_document_path(
    case_id: str,
    document: CaseDocument,
    *,
    data_dir: Path | None = None,
) -> Path:
    root = _document_storage_root(data_dir)
    path = _document_storage_path(case_id, document.id, document.extension, data_dir=data_dir)
    if not path.resolve().is_relative_to(root):
        raise ValueError("Resolved document path escaped the local document store.")
    return path


def _store_document_bytes(path: Path, document_bytes: bytes) -> None:
    descriptor: int | None = None
    created = False
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    try:
        descriptor = os.open(path, flags, 0o600)
        created = True
        with os.fdopen(descriptor, "wb") as stream:
            descriptor = None
            stream.write(document_bytes)
    except Exception:
        if descriptor is not None:
            os.close(descriptor)
        # Never remove a pre-existing file when exclusive creation fails.
        if created:
            path.unlink(missing_ok=True)
        raise


def _case_document(result: DocumentResult) -> CaseDocument:
    metadata = result.metadata
    return CaseDocument(
        id=result.document_id,
        filename=metadata.filename,
        mimeType=metadata.mime_type,
        extension=metadata.extension,
        fileSize=metadata.file_size,
        sha256=metadata.sha256,
        pageCount=metadata.page_count,
        processingTimestamp=metadata.processing_timestamp,
        processingStatus=result.status.value,
        classification=result.classification.category,
        classificationConfidence=result.classification.confidence,
        classificationSignals=list(result.classification.signals),
        pages=[
            CaseDocumentPage(
                pageNumber=page.page_number,
                extractionMethod=page.extraction_method,
                processingStatus=page.status.value,
                textLength=len(page.text),
                confidence=page.confidence,
                providerName=page.provider_name,
            )
            for page in result.pages
        ],
        errors=list(result.errors),
        reviewStatus="awaiting_confirmation",
    )


def _evidence_for_confirmed_findings(
    result: DocumentResult,
    review: DocumentReview,
    selected_ids: set[str],
) -> list[Evidence]:
    selected_findings = [
        finding for finding in review.findings
        if finding.id in selected_ids and finding.upstream_status is not None
    ]
    confirmed: list[Evidence] = []
    for finding in selected_findings:
        provenance = next((item for item in finding.provenance if item.source == "document"), None)
        matches = [
            item
            for item in result.evidence
            if _evidence_category(item) == finding.category
            and item.value == finding.value
            and item.status.value == finding.upstream_status
            and provenance is not None
            and item.page_number == provenance.page_number
            and item.extraction_method == provenance.extraction_method
        ]
        confirmed.extend(matches)

    unique: dict[tuple[object, ...], Evidence] = {}
    for item in confirmed:
        unique.setdefault(
            (item.page_number, item.field, repr(item.value), item.extraction_method, item.text),
            item,
        )
    return list(unique.values())


def _evidence_category(item: Evidence) -> str:
    if item.field in {"amount", "currency"}:
        return "amount"
    if item.field.casefold() in {"date", "identifier", "party", "clause", "obligation", "notice"}:
        return item.field.casefold()
    return item.field


def document_fact_key(item: Evidence, result: DocumentResult) -> str:
    field = item.field.casefold()
    if field == "currency":
        return "document_currency"
    if field == "amount":
        known_currency_pages = {
            source.page_number
            for source in result.evidence
            if source.field.casefold() == "currency" and str(source.value).upper() == "INR"
        }
        page_text = next(
            (page.text for page in result.pages if page.page_number == item.page_number),
            "",
        )
        if item.page_number in known_currency_pages or re.search(
            r"(?:\bINR\b|₹|\b(?:rupees?|rs\.?)\b)",
            page_text,
            re.IGNORECASE,
        ):
            return "amount_inr"
    if field == "date":
        return "document_date"
    return f"document_{field}"


def _document_evidence_id(document_id: str) -> str:
    return "document_" + hashlib.sha256(document_id.encode("utf-8")).hexdigest()[:16]


def _document_fact_id(document_id: str, item: Evidence) -> str:
    identity = (
        f"{document_id}\x1f{item.page_number}\x1f{item.field.casefold()}\x1f"
        f"{item.value}\x1f{item.extraction_method}"
    )
    return "docfact_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]


def _normalized_fact_value(value: object) -> str:
    if isinstance(value, bool):
        return str(value).casefold()
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).strip().replace(",", "")
    try:
        return str(float(text)).removesuffix(".0")
    except ValueError:
        return " ".join(text.casefold().split())


def _confidence_label(value: float) -> str:
    if value >= 0.8:
        return "high"
    if value >= 0.5:
        return "medium"
    return "low"
