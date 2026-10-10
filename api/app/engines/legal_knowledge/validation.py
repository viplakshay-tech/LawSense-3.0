"""Fail-closed validation for source-backed legal knowledge records."""

from __future__ import annotations

from datetime import date, datetime
from math import isfinite

from app.engines.legal_knowledge.models import (
    Authority,
    Jurisdiction,
    KnowledgeItem,
    KnowledgeStatus,
    LegalDocument,
    LegalProcedure,
    LegalProvision,
    LegalRule,
    LegalSource,
    SOURCE_BACKED_TYPES,
    SourceAuthorityTier,
    SourceReference,
    SourceVersion,
)


class LegalKnowledgeValidationError(ValueError):
    """Raised when a knowledge record is incomplete or internally inconsistent."""


def _required_text(value: object, field_name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise LegalKnowledgeValidationError(f"{field_name} is required.")


def _aware_datetime(value: object, field_name: str) -> None:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise LegalKnowledgeValidationError(f"{field_name} must be a timezone-aware datetime.")


def validate_source_reference(reference: SourceReference) -> None:
    if not isinstance(reference, SourceReference):
        raise LegalKnowledgeValidationError("Provenance entries must be SourceReference values.")
    _required_text(reference.source_id, "provenance source_id")
    _aware_datetime(reference.retrieval_time, "provenance retrieval_time")

    locator_values = (
        reference.document_id,
        reference.provision_id,
        reference.page_section_reference,
        reference.source_url,
    )
    if not any(isinstance(value, str) and value.strip() for value in locator_values):
        raise LegalKnowledgeValidationError(
            "Provenance must identify a document, provision, page/section/reference, or source URL."
        )
    for field_name in ("document_id", "provision_id", "page_section_reference", "source_url"):
        value = getattr(reference, field_name)
        if value is not None:
            _required_text(value, f"provenance {field_name}")


def validate_knowledge_item(item: KnowledgeItem) -> None:
    """Validate an item before it can enter a repository or adapter pipeline."""
    if not isinstance(item, KnowledgeItem):
        raise LegalKnowledgeValidationError("Knowledge records must use a supported model type.")

    _required_text(item.id, "id")
    _required_text(item.title, "title")
    _required_text(item.type, "type")
    expected_types = {
        LegalSource: "legal_source",
        LegalDocument: "legal_document",
        LegalProvision: "legal_provision",
        LegalRule: "legal_rule",
        LegalProcedure: "legal_procedure",
        Authority: "authority",
        Jurisdiction: "jurisdiction",
        SourceVersion: "source_version",
    }
    expected_type = expected_types.get(type(item))
    if expected_type is not None and item.type != expected_type:
        raise LegalKnowledgeValidationError(
            f"{type(item).__name__} type must be {expected_type!r}."
        )
    if not isinstance(item.search_text, str):
        raise LegalKnowledgeValidationError("search_text must be a string.")
    if not isinstance(item.status, KnowledgeStatus):
        raise LegalKnowledgeValidationError("status must be a KnowledgeStatus value.")
    if item.confidence is not None and (
        isinstance(item.confidence, bool)
        or not isinstance(item.confidence, (int, float))
        or not isfinite(item.confidence)
        or not 0 <= item.confidence <= 1
    ):
        raise LegalKnowledgeValidationError("confidence must be a finite number between 0 and 1.")
    if item.effective_from is not None and (
        not isinstance(item.effective_from, date) or isinstance(item.effective_from, datetime)
    ):
        raise LegalKnowledgeValidationError("effective_from must be a date.")
    if item.effective_to is not None and (
        not isinstance(item.effective_to, date) or isinstance(item.effective_to, datetime)
    ):
        raise LegalKnowledgeValidationError("effective_to must be a date.")
    if item.effective_from is not None and item.effective_to is not None and item.effective_to < item.effective_from:
        raise LegalKnowledgeValidationError("effective_to cannot precede effective_from.")
    if item.retrieved_at is not None:
        _aware_datetime(item.retrieved_at, "retrieved_at")
    for optional_text_field in ("jurisdiction", "authority", "source", "source_url", "version", "supersedes", "superseded_by"):
        value = getattr(item, optional_text_field)
        if value is not None:
            _required_text(value, optional_text_field)
    if not isinstance(item.provenance, tuple):
        raise LegalKnowledgeValidationError("provenance must be an immutable tuple of source references.")
    for reference in item.provenance:
        validate_source_reference(reference)
    if item.supersedes == item.id or item.superseded_by == item.id:
        raise LegalKnowledgeValidationError("A record cannot supersede itself.")

    if isinstance(item, Authority):
        if item.authority_type is not None:
            _required_text(item.authority_type, "authority_type")
    elif isinstance(item, Jurisdiction):
        _required_text(item.country, "jurisdiction country")
        _required_text(item.jurisdiction_basis, "jurisdiction_basis")
        for field_name in ("state", "district", "court_or_authority"):
            value = getattr(item, field_name)
            if value is not None:
                _required_text(value, field_name)
    elif isinstance(item, LegalSource):
        _required_text(item.authority, "source authority")
        if not isinstance(item.authority_tier, SourceAuthorityTier):
            raise LegalKnowledgeValidationError("A legal source must declare a valid authority_tier.")
        if item.publisher_name is not None:
            _required_text(item.publisher_name, "publisher_name")

    if isinstance(item, SOURCE_BACKED_TYPES):
        _required_text(item.source, "source")
        _required_text(item.authority, "authority")
        _required_text(item.version, "version")
        if not item.provenance:
            raise LegalKnowledgeValidationError("Source-backed legal knowledge requires provenance.")
        if not any(reference.source_id == item.source for reference in item.provenance):
            raise LegalKnowledgeValidationError("Provenance must reference the item's source.")
        if isinstance(item, (LegalDocument, LegalProvision, LegalRule, LegalProcedure)):
            _required_text(item.jurisdiction, "jurisdiction")
        if isinstance(item, LegalProvision):
            _required_text(item.document_id, "document_id")
            _required_text(item.provision_reference, "provision_reference")
            if not any(reference.document_id == item.document_id for reference in item.provenance):
                raise LegalKnowledgeValidationError("Provision provenance must identify its document_id.")
            if item.text is not None:
                _required_text(item.text, "provision text")
        if isinstance(item, LegalRule):
            _required_text(item.provision_id, "provision_id")
            if item.rule_text is not None:
                _required_text(item.rule_text, "rule_text")
        if isinstance(item, LegalProcedure):
            if not isinstance(item.related_provision_ids, tuple):
                raise LegalKnowledgeValidationError("related_provision_ids must be an immutable tuple.")
            if any(not isinstance(provision_id, str) or not provision_id.strip() for provision_id in item.related_provision_ids):
                raise LegalKnowledgeValidationError("related_provision_ids must contain non-empty IDs.")
            if not isinstance(item.steps, tuple) or not item.steps or any(
                not isinstance(step, str) or not step.strip() for step in item.steps
            ):
                raise LegalKnowledgeValidationError("A legal procedure must have non-empty steps.")
        if isinstance(item, SourceVersion):
            if not isinstance(item.record_ids, tuple):
                raise LegalKnowledgeValidationError("SourceVersion record_ids must be an immutable tuple.")
            for record_id in item.record_ids:
                _required_text(record_id, "SourceVersion record_id")


def utc_now() -> datetime:
    """Return an aware UTC timestamp for ingestion adapters and callers."""
    return datetime.now(timezone.utc)
