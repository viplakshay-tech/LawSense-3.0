"""Case-bound API for compiling, reviewing, and exporting document packages."""

from fastapi import APIRouter, HTTPException

from app.db.database import (
    get_document_draft,
    get_document_package,
    list_document_drafts,
    list_document_packages,
    save_document_draft,
    save_document_package,
)
from app.engines.document_compiler.compiler import (
    case_fingerprint,
    confirm_document_draft,
    create_document_draft,
    create_document_package,
    edit_document_draft,
    list_document_templates,
    mark_package_stale,
    mark_stale,
    prepare_export,
    prepare_package_export,
)
from app.engines.document_compiler.models import (
    ConfirmDocumentDraftRequest,
    CreateDocumentDraftRequest,
    CreateDocumentPackageRequest,
    DocumentDraft,
    DocumentPackage,
    EditDocumentDraftRequest,
    ExportReadyDocument,
    ExportReadyPackage,
)
from app.services.case_service import get_case_state


router = APIRouter(tags=["document compiler"])


def _case_or_404(case_id: str):
    case_state = get_case_state(case_id)
    if case_state is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case_state


def _draft_or_404(case_id: str, draft_id: str) -> DocumentDraft:
    draft = get_document_draft(case_id, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Document draft not found")
    return draft


def _package_or_404(case_id: str, package_id: str) -> DocumentPackage:
    package = get_document_package(case_id, package_id)
    if package is None:
        raise HTTPException(status_code=404, detail="Document package not found")
    return package


@router.get("/document-templates")
def read_document_templates():
    return list_document_templates()


@router.post("/cases/{case_id}/document-drafts", response_model=DocumentDraft, status_code=201)
def create_case_document_draft(case_id: str, payload: CreateDocumentDraftRequest):
    case_state = _case_or_404(case_id)
    try:
        draft = create_document_draft(
            case_state,
            payload.templateId,
            field_values=payload.fieldValues,
            legal_source_ids=payload.legalSourceIds,
            included_fact_ids=payload.includedFactIds,
            fact_edits=payload.factEdits,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    save_document_draft(draft)
    return draft


@router.get("/cases/{case_id}/document-drafts", response_model=list[DocumentDraft])
def read_case_document_drafts(case_id: str):
    case_state = _case_or_404(case_id)
    drafts = list_document_drafts(case_id)
    for draft in drafts:
        original_state = draft.reviewState
        mark_stale(draft, case_state)
        if draft.reviewState != original_state:
            save_document_draft(draft)
    return drafts


@router.get("/cases/{case_id}/document-drafts/{draft_id}", response_model=DocumentDraft)
def read_case_document_draft(case_id: str, draft_id: str):
    case_state = _case_or_404(case_id)
    draft = _draft_or_404(case_id, draft_id)
    original_state = draft.reviewState
    mark_stale(draft, case_state)
    if draft.reviewState != original_state:
        save_document_draft(draft)
    return draft


@router.patch("/cases/{case_id}/document-drafts/{draft_id}", response_model=DocumentDraft)
def edit_case_document_draft(case_id: str, draft_id: str, payload: EditDocumentDraftRequest):
    case_state = _case_or_404(case_id)
    draft = _draft_or_404(case_id, draft_id)
    if case_fingerprint(case_state) != draft.sourceCaseFingerprint:
        mark_stale(draft, case_state)
        save_document_draft(draft)
        raise HTTPException(status_code=409, detail="The case changed after this draft was prepared. Generate a fresh draft before editing it.")
    try:
        updated = edit_document_draft(
            draft,
            case_state,
            field_values=payload.fieldValues,
            legal_source_ids=payload.legalSourceIds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    save_document_draft(updated)
    return updated


@router.post("/cases/{case_id}/document-drafts/{draft_id}/confirm", response_model=DocumentDraft)
def confirm_case_document_draft(case_id: str, draft_id: str, payload: ConfirmDocumentDraftRequest):
    case_state = _case_or_404(case_id)
    draft = _draft_or_404(case_id, draft_id)
    try:
        confirmed = confirm_document_draft(
            draft,
            case_state,
            acknowledge_missing_information=payload.acknowledgeMissingInformation,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    save_document_draft(confirmed)
    return confirmed


@router.post("/cases/{case_id}/document-drafts/{draft_id}/export", response_model=ExportReadyDocument)
def export_case_document_draft(case_id: str, draft_id: str):
    case_state = _case_or_404(case_id)
    draft = _draft_or_404(case_id, draft_id)
    export_document = prepare_export(draft, case_state)
    if export_document.status != "ready":
        if draft.reviewState.value == "stale":
            save_document_draft(draft)
        raise HTTPException(
            status_code=409,
            detail={"message": "Document export is blocked.", "export": export_document.model_dump(mode="json", by_alias=True)},
        )
    return export_document


@router.post("/cases/{case_id}/document-packages", response_model=DocumentPackage, status_code=201)
def create_case_document_package(case_id: str, payload: CreateDocumentPackageRequest):
    case_state = _case_or_404(case_id)
    try:
        package = create_document_package(
            case_state,
            template_ids=payload.templateIds or None,
            field_values_by_template=payload.fieldValuesByTemplate,
            legal_source_ids_by_template=payload.legalSourceIdsByTemplate,
            included_fact_ids_by_template=payload.includedFactIdsByTemplate,
        fact_edits_by_template=payload.factEditsByTemplate,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    for draft in package.documents:
        save_document_draft(draft)
    save_document_package(package)
    return package


@router.get("/cases/{case_id}/document-packages", response_model=list[DocumentPackage])
def read_case_document_packages(case_id: str):
    case_state = _case_or_404(case_id)
    packages = list_document_packages(case_id)
    for package in packages:
        mark_package_stale(package, case_state)
        for draft in package.documents:
            save_document_draft(draft)
        save_document_package(package)
    return packages


@router.get("/cases/{case_id}/document-packages/{package_id}", response_model=DocumentPackage)
def read_case_document_package(case_id: str, package_id: str):
    case_state = _case_or_404(case_id)
    package = _package_or_404(case_id, package_id)
    mark_package_stale(package, case_state)
    for draft in package.documents:
        save_document_draft(draft)
    save_document_package(package)
    return package


@router.post("/cases/{case_id}/document-packages/{package_id}/confirm", response_model=DocumentPackage)
def confirm_case_document_package(
    case_id: str,
    package_id: str,
    payload: ConfirmDocumentDraftRequest,
):
    case_state = _case_or_404(case_id)
    package = _package_or_404(case_id, package_id)
    try:
        for draft in package.documents:
            confirm_document_draft(
                draft,
                case_state,
                acknowledge_missing_information=payload.acknowledgeMissingInformation,
            )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    for draft in package.documents:
        save_document_draft(draft)
    save_document_package(package)
    return package


@router.post("/cases/{case_id}/document-packages/{package_id}/export", response_model=ExportReadyPackage)
def export_case_document_package(case_id: str, package_id: str):
    case_state = _case_or_404(case_id)
    package = _package_or_404(case_id, package_id)
    export_package = prepare_package_export(package, case_state)
    if export_package.status != "ready":
        for draft in package.documents:
            if draft.reviewState.value == "stale":
                save_document_draft(draft)
        save_document_package(package)
        raise HTTPException(
            status_code=409,
            detail={"message": "Document package export is blocked.", "export": export_package.model_dump(mode="json", by_alias=True)},
        )
    return export_package

