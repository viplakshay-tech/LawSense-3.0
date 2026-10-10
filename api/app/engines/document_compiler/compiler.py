"""Deterministic compilation from CaseState into source-linked drafts."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from uuid import uuid4
from typing import Any

from app.engines.document_compiler.models import (
    CaseFactFieldMapping,
    DocumentConflict,
    DocumentDraft,
    DocumentField,
    DocumentFieldStatus,
    DocumentPackage,
    DocumentProvenance,
    DocumentReviewState,
    DocumentTemplate,
    ExportReadyDocument,
    ExportReadyPackage,
    FieldConflictValue,
)
from app.engines.document_compiler.templates import DOCUMENT_TEMPLATES, TEMPLATE_BY_ID
from app.schemas.case_state import CaseFact, CaseState, EvidenceItem


_KEY_TO_FIELD = {
    "sender": "sender_name",
    "sender_name": "sender_name",
    "applicant": "sender_name",
    "applicant_name": "sender_name",
    "complainant": "sender_name",
    "complainant_name": "sender_name",
    "claimant_name": "sender_name",
    "person_name": "sender_name",
    "contact": "sender_contact",
    "sender_contact": "sender_contact",
    "recipient": "recipient_name",
    "recipient_name": "recipient_name",
    "respondent": "recipient_name",
    "respondent_name": "recipient_name",
    "opposite_party": "recipient_name",
    "recipient_address": "recipient_address",
    "address_of_recipient": "recipient_address",
    "subject": "subject",
    "case_title": "subject",
    "statement": "case_narrative",
    "case_narrative": "case_narrative",
    "incident_description": "case_narrative",
    "facts_of_case": "case_narrative",
    "notice_reference": "notice_reference",
    "notice_number": "notice_reference",
    "legal_notice_reference": "notice_reference",
    "notice_date": "notice_date",
    "notice_details": "notice_details",
    "notice_content": "notice_details",
    "response_position": "response_position",
    "date_of_incident": "relevant_date",
    "incident_date": "relevant_date",
    "relevant_date": "relevant_date",
    "claim_amount": "claimed_amount",
    "amount_claimed": "claimed_amount",
    "refund_amount": "claimed_amount",
    "amount_inr": "claimed_amount",
    "amount": "claimed_amount",
    "deposit_amount": "deposit_amount",
    "security_deposit": "deposit_amount",
    "security_deposit_amount": "deposit_amount",
    "salary_amount": "claimed_amount",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normal_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.casefold()).strip("_")


def _printable(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    except (TypeError, ValueError):
        return str(value)


def case_fingerprint(case_state: CaseState) -> str:
    """Cryptographic snapshot of all case data used to detect stale drafts."""
    serialized = json.dumps(
        case_state.model_dump(mode="json", by_alias=True),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def get_document_template(template_id: str) -> DocumentTemplate | None:
    return TEMPLATE_BY_ID.get(template_id)


def list_document_templates() -> list[DocumentTemplate]:
    return list(DOCUMENT_TEMPLATES)


def _provenance_for_evidence(
    evidence: EvidenceItem,
    case_state: CaseState,
) -> DocumentProvenance:
    document = next((item for item in case_state.documents if item.id == evidence.documentId), None)
    return DocumentProvenance(
        sourceType="evidence",
        sourceId=evidence.id,
        label=evidence.title,
        status=evidence.status,
        documentId=evidence.documentId,
        reference=document.filename if document else None,
    )


def _provenance_for_fact(fact: CaseFact, case_state: CaseState) -> tuple[list[DocumentProvenance], list[str]]:
    evidence_by_id = {item.id: item for item in case_state.evidence}
    sources: list[DocumentProvenance] = []
    evidence_ids: list[str] = []

    for source_id in dict.fromkeys(fact.sourceIds):
        evidence = evidence_by_id.get(source_id)
        if evidence is None:
            sources.append(DocumentProvenance(
                sourceType="unresolved_evidence",
                sourceId=source_id,
                label=f"Unresolved evidence reference: {source_id}",
                status="unknown",
            ))
            continue
        evidence_ids.append(evidence.id)
        sources.append(_provenance_for_evidence(evidence, case_state))

    for reference in fact.provenance:
        document = next((item for item in case_state.documents if item.id == reference.documentId), None)
        sources.append(DocumentProvenance(
            sourceType="document",
            sourceId=reference.documentId,
            label=document.filename if document else f"Source document {reference.documentId}",
            status=reference.status,
            documentId=reference.documentId,
            pageNumber=reference.pageNumber,
            confidence=reference.confidence,
            confirmedByUser=reference.confirmedByUser,
        ))

    return _dedupe_provenance(sources), evidence_ids


def _dedupe_provenance(sources: list[DocumentProvenance]) -> list[DocumentProvenance]:
    seen: set[tuple[str, str, int | None]] = set()
    result: list[DocumentProvenance] = []
    for source in sources:
        key = (source.sourceType, source.sourceId, source.pageNumber)
        if key in seen:
            continue
        seen.add(key)
        result.append(source)
    return result


def _status_for_fact(fact: CaseFact, provenance: list[DocumentProvenance]) -> DocumentFieldStatus:
    if fact.status == "conflicting" or any(source.status == "conflicting" for source in provenance):
        return DocumentFieldStatus.CONFLICTING
    if (
        not any(source.sourceType in {"evidence", "document"} for source in provenance)
        or any(source.sourceType == "unresolved_evidence" for source in provenance)
        or fact.status in {"system_inferred", "assumption", "unknown"}
        or any(source.status in {"system_inferred", "assumption", "unknown"} for source in provenance)
    ):
        return DocumentFieldStatus.UNSUPPORTED
    if fact.status == "evidence_supported":
        return DocumentFieldStatus.EVIDENCE_SUPPORTED
    return DocumentFieldStatus.USER_REPORTED


def _case_statement_sources(case_state: CaseState) -> list[DocumentProvenance]:
    sources = [DocumentProvenance(
        sourceType="case_statement",
        sourceId="initialStatement",
        label="Initial user statement in the case record",
        status="user_reported",
    )]
    evidence = [
        item for item in case_state.evidence
        if item.source == "user" and (item.type == "narrative" or "statement" in item.title.casefold())
    ]
    sources.extend(_provenance_for_evidence(item, case_state) for item in evidence)
    return _dedupe_provenance(sources)


def _initial_fields(template: DocumentTemplate) -> dict[str, DocumentField]:
    return {
        spec.id: DocumentField(
            id=spec.id,
            label=spec.label,
            status=DocumentFieldStatus.MISSING,
            required=spec.required,
            material=spec.material,
            missingMarker=f"[MISSING INFORMATION: {spec.label}]" if spec.required else None,
        )
        for spec in template.fields
    }


def _candidate_conflicts(
    values: list[tuple[str, list[str], list[DocumentProvenance], DocumentFieldStatus]],
) -> list[FieldConflictValue]:
    return [
        FieldConflictValue(value=value, sourceFactIds=fact_ids, provenance=provenance)
        for value, fact_ids, provenance, _status in values
    ]


def _set_mapped_field(
    field: DocumentField,
    candidate: tuple[str, str, list[DocumentProvenance], list[str], DocumentFieldStatus],
    *,
    source_fact_ids: list[str],
) -> None:
    value, _fact_id, provenance, evidence_ids, status = candidate
    if not value:
        return

    if field.value is None:
        field.value = None if status == DocumentFieldStatus.CONFLICTING else value
        field.status = status
        field.sourceFactIds = list(dict.fromkeys(source_fact_ids))
        field.sourceEvidenceIds = list(dict.fromkeys(evidence_ids))
        field.provenance = _dedupe_provenance(provenance)
        if status == DocumentFieldStatus.CONFLICTING:
            field.conflicts = [FieldConflictValue(value=value, sourceFactIds=source_fact_ids, provenance=provenance)]
            field.missingMarker = f"[CONFLICT: {field.label} has competing recorded values]"
        else:
            field.missingMarker = None
        return

    if field.value == value:
        field.sourceFactIds = list(dict.fromkeys([*field.sourceFactIds, *source_fact_ids]))
        field.sourceEvidenceIds = list(dict.fromkeys([*field.sourceEvidenceIds, *evidence_ids]))
        field.provenance = _dedupe_provenance([*field.provenance, *provenance])
        if status == DocumentFieldStatus.CONFLICTING:
            field.status = DocumentFieldStatus.CONFLICTING
        elif status == DocumentFieldStatus.UNSUPPORTED and field.status != DocumentFieldStatus.CONFLICTING:
            field.status = DocumentFieldStatus.UNSUPPORTED
        elif status == DocumentFieldStatus.EVIDENCE_SUPPORTED and field.status == DocumentFieldStatus.USER_REPORTED:
            field.status = DocumentFieldStatus.EVIDENCE_SUPPORTED
        return

    existing = FieldConflictValue(
        value=field.value,
        sourceFactIds=field.sourceFactIds,
        provenance=field.provenance,
    )
    incoming = FieldConflictValue(
        value=value,
        sourceFactIds=source_fact_ids,
        provenance=provenance,
    )
    field.status = DocumentFieldStatus.CONFLICTING
    field.value = None
    field.conflicts = [*field.conflicts, existing, incoming]
    field.sourceFactIds = list(dict.fromkeys([*field.sourceFactIds, *source_fact_ids]))
    field.sourceEvidenceIds = list(dict.fromkeys([*field.sourceEvidenceIds, *evidence_ids]))
    field.provenance = _dedupe_provenance([*field.provenance, *provenance])
    field.missingMarker = f"[CONFLICT: {field.label} has competing recorded values]"


def _legal_source(case_state: CaseState, source_id: str) -> DocumentProvenance:
    knowledge = case_state.analysis.legal_knowledge if case_state.analysis else None
    record = next((item for item in knowledge.records if item.id == source_id), None) if knowledge else None
    if record is None:
        raise ValueError(f"Legal source {source_id!r} is not recorded in this case.")

    source_verification_status = getattr(record, "source_verification_status", None)
    if record.status != "verified" or (
        source_verification_status is not None and source_verification_status != "verified"
    ):
        raise ValueError("Legal wording requires a verified legal source recorded in this case.")

    source_url = record.source_url or next(
        (item.source_url for item in record.provenance if item.source_url),
        None,
    )
    reference = record.reference or record.title
    if not source_url and not reference:
        raise ValueError("The legal source does not include a traceable reference.")

    return DocumentProvenance(
        sourceType="legal_source",
        sourceId=record.id,
        label=record.title,
        status=record.status,
        sourceUrl=source_url,
        reference=reference,
    )


def _map_case_state(
    case_state: CaseState,
    template: DocumentTemplate,
    included_fact_ids: set[str] | None,
    fact_edits: dict[str, str] | None = None,
) -> tuple[
    dict[str, DocumentField], list[CaseFactFieldMapping]
]:
    fields = _initial_fields(template)
    mappings: list[CaseFactFieldMapping] = []
    candidates: dict[str, list[tuple[str, str, list[DocumentProvenance], list[str], DocumentFieldStatus]]] = {}

    selected_facts: list[CaseFact] = []
    for fact in case_state.facts:
        if included_fact_ids is not None and fact.id not in included_fact_ids:
            continue
        selected_facts.append(fact)
        target = _KEY_TO_FIELD.get(_normal_key(fact.key))
        if not target or target not in fields:
            continue
        value = (fact_edits or {}).get(fact.id, _printable(fact.value)).strip()
        provenance, evidence_ids = _provenance_for_fact(fact, case_state)
        status = _status_for_fact(fact, provenance)
        if fact.id in (fact_edits or {}):
            provenance = _dedupe_provenance([*provenance, DocumentProvenance(
                sourceType="user_edit",
                sourceId=f"case-fact-edit:{fact.id}",
                label="Selected case fact wording edited by the user",
                status="user_authored",
            )])
        mappings.append(CaseFactFieldMapping(
            factId=fact.id,
            factKey=fact.key,
            fieldId=target,
            fieldStatus=status,
            provenance=provenance,
        ))
        candidates.setdefault(target, []).append((value, fact.id, provenance, evidence_ids, status))

    statement_selected = included_fact_ids is None or "initial-statement" in included_fact_ids
    if case_state.initialStatement and case_state.initialStatement.strip() and "case_narrative" in fields and statement_selected:
        statement_sources = _case_statement_sources(case_state)
        statement_value = (fact_edits or {}).get("initial-statement", case_state.initialStatement.strip()).strip()
        if "initial-statement" in (fact_edits or {}):
            statement_sources = _dedupe_provenance([*statement_sources, DocumentProvenance(
                sourceType="user_edit",
                sourceId="case-fact-edit:initial-statement",
                label="Selected initial statement wording edited by the user",
                status="user_authored",
            )])
        mappings.append(CaseFactFieldMapping(
            factId="initialStatement",
            factKey="initialStatement",
            fieldId="case_narrative",
            fieldStatus=DocumentFieldStatus.USER_REPORTED,
            provenance=statement_sources,
        ))
        candidates.setdefault("case_narrative", []).append((
            statement_value,
            "initialStatement",
            statement_sources,
            [item.sourceId for item in statement_sources if item.sourceType == "evidence"],
            DocumentFieldStatus.USER_REPORTED,
        ))

    for target, entries in candidates.items():
        field = fields[target]
        # Keep repeated identical source records; only distinct values conflict.
        distinct: dict[str, list[tuple[str, str, list[DocumentProvenance], list[str], DocumentFieldStatus]]] = {}
        for entry in entries:
            if entry[0]:
                distinct.setdefault(entry[0], []).append(entry)
        competing_entries = list(entries)
        if included_fact_ids is not None:
            # Selecting one side of an unresolved duplicate does not silently
            # resolve the case conflict; retain both alternatives for review.
            for fact in case_state.facts:
                if _KEY_TO_FIELD.get(_normal_key(fact.key)) != target:
                    continue
                value = (fact_edits or {}).get(fact.id, _printable(fact.value)).strip()
                if not value or any(item[1] == fact.id for item in competing_entries):
                    continue
                provenance, evidence_ids = _provenance_for_fact(fact, case_state)
                status = _status_for_fact(fact, provenance)
                competing_entries.append((value, fact.id, provenance, evidence_ids, status))
            if target == "case_narrative" and case_state.initialStatement and case_state.initialStatement.strip() \
                    and not any(item[1] == "initialStatement" for item in competing_entries):
                competing_entries.append((
                    case_state.initialStatement.strip(),
                    "initialStatement",
                    _case_statement_sources(case_state),
                    [],
                    DocumentFieldStatus.USER_REPORTED,
                ))
        conflict_distinct: dict[str, list[tuple[str, str, list[DocumentProvenance], list[str], DocumentFieldStatus]]] = {}
        for entry in competing_entries:
            if entry[0]:
                conflict_distinct.setdefault(entry[0], []).append(entry)
        if len(conflict_distinct) > 1:
            alternatives: list[FieldConflictValue] = []
            all_fact_ids: list[str] = []
            all_evidence_ids: list[str] = []
            all_sources: list[DocumentProvenance] = []
            for entries_for_value in conflict_distinct.values():
                value = entries_for_value[0][0]
                ids = [item[1] for item in entries_for_value]
                sources = [source for item in entries_for_value for source in item[2]]
                alternatives.append(FieldConflictValue(
                    value=value,
                    sourceFactIds=ids,
                    provenance=_dedupe_provenance(sources),
                ))
                all_fact_ids.extend(ids)
                all_evidence_ids.extend(source_id for item in entries_for_value for source_id in item[3])
                all_sources.extend(sources)
            field.status = DocumentFieldStatus.CONFLICTING
            field.value = None
            field.conflicts = alternatives
            field.sourceFactIds = list(dict.fromkeys(all_fact_ids))
            field.sourceEvidenceIds = list(dict.fromkeys(all_evidence_ids))
            field.provenance = _dedupe_provenance(all_sources)
            field.missingMarker = f"[CONFLICT: {field.label} has competing recorded values]"
            continue

        for entries_for_value in distinct.values():
            for value, fact_id, provenance, evidence_ids, status in entries_for_value:
                _set_mapped_field(field, (value, fact_id, provenance, evidence_ids, status), source_fact_ids=[fact_id])

    _map_case_profile(case_state, fields)
    _map_jurisdiction(case_state, fields)
    chronology_mapped = _map_chronology(case_state, fields, included_fact_ids, (fact_edits or {}))
    _map_selected_fact_fallback(case_state, fields, mappings, selected_facts, included_fact_ids, (fact_edits or {}))
    if not chronology_mapped:
        _map_selected_event_fallback(case_state, fields, mappings, included_fact_ids, (fact_edits or {}))
    _map_evidence_index(case_state, fields)
    _map_filing_checklist(fields, template)
    return fields, mappings


def _map_selected_fact_fallback(
    case_state: CaseState,
    fields: dict[str, DocumentField],
    mappings: list[CaseFactFieldMapping],
    selected_facts: list[CaseFact],
    included_fact_ids: set[str] | None,
    fact_edits: dict[str, str],
) -> None:
    field = fields.get("selected_case_facts")
    if field is None:
        return
    mapped_ids = {mapping.factId for mapping in mappings}
    lines: list[str] = []
    provenance: list[DocumentProvenance] = []
    evidence_ids: list[str] = []
    conflict_values: dict[str, list[FieldConflictValue]] = {}
    fallback_values: dict[str, dict[str, list[tuple[str, list[DocumentProvenance], list[str]]]]] = {}
    fallback_fact_ids: set[str] = set()
    unsupported = False
    conflicting = False
    for fact in selected_facts:
        if fact.id in mapped_ids:
            continue
        value = fact_edits.get(fact.id, _printable(fact.value)).strip()
        source_provenance, source_evidence_ids = _provenance_for_fact(fact, case_state)
        status = _status_for_fact(fact, source_provenance)
        if fact.id in fact_edits:
            source_provenance = _dedupe_provenance([*source_provenance, DocumentProvenance(
                sourceType="user_edit", sourceId=f"case-fact-edit:{fact.id}",
                label="Selected case fact wording edited by the user", status="user_authored",
            )])
        key = _KEY_TO_FIELD.get(_normal_key(fact.key), _normal_key(fact.key))
        pretty_key = re.sub(r"[_-]+", " ", fact.key).strip().capitalize()
        lines.append(f"{pretty_key}: {value or '[MISSING INFORMATION: value not recorded]'}")
        provenance.extend(source_provenance)
        evidence_ids.extend(source_evidence_ids)
        mappings.append(CaseFactFieldMapping(
            factId=fact.id,
            factKey=fact.key,
            fieldId=field.id,
            mappingRule="selected_fact_fallback",
            fieldStatus=status,
            provenance=source_provenance,
        ))
        fallback_fact_ids.add(fact.id)
        fallback_values.setdefault(key, {}).setdefault(value, []).append((fact.id, source_provenance, source_evidence_ids))
        if status == DocumentFieldStatus.CONFLICTING:
            conflicting = True
            conflict_values.setdefault(key, []).append(FieldConflictValue(
                value=value,
                sourceFactIds=[fact.id],
                provenance=source_provenance,
            ))
        elif status == DocumentFieldStatus.UNSUPPORTED:
            unsupported = True

    if included_fact_ids is not None:
        for fact in case_state.facts:
            key = _KEY_TO_FIELD.get(_normal_key(fact.key), _normal_key(fact.key))
            if key not in fallback_values or fact.id in fallback_fact_ids:
                continue
            target = _KEY_TO_FIELD.get(_normal_key(fact.key))
            if target and target in fields:
                continue
            value = _printable(fact.value).strip()
            if not value:
                continue
            source_provenance, source_evidence_ids = _provenance_for_fact(fact, case_state)
            fallback_values[key].setdefault(value, []).append((fact.id, source_provenance, source_evidence_ids))
            if _status_for_fact(fact, source_provenance) == DocumentFieldStatus.CONFLICTING:
                conflicting = True
                conflict_values.setdefault(key, []).append(FieldConflictValue(
                    value=value, sourceFactIds=[fact.id], provenance=source_provenance,
                ))

    if "case_narrative" not in fields and case_state.initialStatement and case_state.initialStatement.strip() \
            and (included_fact_ids is None or "initial-statement" in included_fact_ids):
        statement_value = fact_edits.get("initial-statement", case_state.initialStatement.strip()).strip()
        statement_sources = _case_statement_sources(case_state)
        if "initial-statement" in fact_edits:
            statement_sources = _dedupe_provenance([*statement_sources, DocumentProvenance(
                sourceType="user_edit", sourceId="case-fact-edit:initial-statement",
                label="Selected initial statement wording edited by the user", status="user_authored",
            )])
        lines.append(f"Initial statement: {statement_value}")
        provenance.extend(statement_sources)
        statement_evidence_ids = [item.sourceId for item in statement_sources if item.sourceType == "evidence"]
        evidence_ids.extend(statement_evidence_ids)
        mappings.append(CaseFactFieldMapping(
            factId="initialStatement", factKey="initialStatement", fieldId=field.id,
            mappingRule="selected_fact_fallback", fieldStatus=DocumentFieldStatus.USER_REPORTED,
            provenance=statement_sources,
        ))
        fallback_values.setdefault("initial_statement", {}).setdefault(statement_value, []).append(
            ("initialStatement", statement_sources, statement_evidence_ids)
        )
    field.value = "\n".join(lines) or None
    field.sourceFactIds = [mapping.factId for mapping in mappings if mapping.fieldId == field.id]
    field.sourceEvidenceIds = list(dict.fromkeys(evidence_ids))
    field.provenance = _dedupe_provenance(provenance)
    for key, alternatives in fallback_values.items():
        if len(alternatives) > 1:
            conflicting = True
            conflict_values.setdefault(key, []).extend(
                FieldConflictValue(
                    value=value,
                    sourceFactIds=[item[0] for item in records],
                    provenance=_dedupe_provenance([source for item in records for source in item[1]]),
                )
                for value, records in alternatives.items()
            )
    if conflicting:
        field.status = DocumentFieldStatus.CONFLICTING
        unique_conflicts: dict[tuple[str, tuple[str, ...]], FieldConflictValue] = {}
        for item in [item for items in conflict_values.values() for item in items]:
            unique_conflicts[(item.value, tuple(item.sourceFactIds))] = item
        field.conflicts = list(unique_conflicts.values())
        field.sourceFactIds = list(dict.fromkeys([
            *field.sourceFactIds,
            *(fact_id for item in field.conflicts for fact_id in item.sourceFactIds),
        ]))
        field.provenance = _dedupe_provenance([
            *field.provenance,
            *(source for item in field.conflicts for source in item.provenance),
        ])
        field.value = None
        field.missingMarker = f"[CONFLICT: {field.label} has competing recorded values]"
    elif unsupported:
        field.status = DocumentFieldStatus.UNSUPPORTED
        field.missingMarker = None
    elif lines:
        field.status = DocumentFieldStatus.USER_REPORTED
        field.missingMarker = None


def _map_selected_event_fallback(
    case_state: CaseState,
    fields: dict[str, DocumentField],
    mappings: list[CaseFactFieldMapping],
    included_fact_ids: set[str] | None,
    event_edits: dict[str, str],
) -> None:
    field = fields.get("selected_case_facts")
    if field is None:
        return
    lines: list[str] = []
    provenance: list[DocumentProvenance] = []
    evidence_ids: list[str] = []
    unsupported = False
    conflicting = False
    for event in case_state.events:
        event_id = f"event:{event.id}"
        if included_fact_ids is not None and event_id not in included_fact_ids:
            continue
        sources, source_evidence_ids = _event_sources(event, case_state)
        status = (
            DocumentFieldStatus.CONFLICTING if any(item.status == "conflicting" for item in sources)
            else DocumentFieldStatus.UNSUPPORTED if not sources or any(item.sourceType == "unresolved_evidence" for item in sources)
            else DocumentFieldStatus.EVIDENCE_SUPPORTED
        )
        raw = event_edits.get(event_id, event.description.strip())
        date = event.date.strip() if event.date else "[DATE NOT RECORDED]"
        if date and event.datePrecision == "approximate" and date != "[DATE NOT RECORDED]":
            date = f"Around {date}"
        lines.append(f"{event.type.replace('_', ' ').title()} · {date} · {raw}")
        if event_id in event_edits:
            sources = _dedupe_provenance([*sources, DocumentProvenance(
                sourceType="user_edit", sourceId=f"case-event-edit:{event.id}",
                label="Selected case event wording edited by the user", status="user_authored",
            )])
        provenance.extend(sources)
        evidence_ids.extend(source_evidence_ids)
        mappings.append(CaseFactFieldMapping(
            factId=event_id, factKey=event.type, fieldId=field.id,
            mappingRule="selected_event", fieldStatus=status, provenance=sources,
        ))
        unsupported = unsupported or status == DocumentFieldStatus.UNSUPPORTED
        conflicting = conflicting or status == DocumentFieldStatus.CONFLICTING
    if lines:
        field.value = "\n".join([*(filter(None, [field.value])), *lines]) or None
        field.sourceFactIds.extend(mapping.factId for mapping in mappings if mapping.mappingRule == "selected_event")
        field.sourceEvidenceIds = list(dict.fromkeys([*field.sourceEvidenceIds, *evidence_ids]))
        field.provenance = _dedupe_provenance([*field.provenance, *provenance])
        if conflicting:
            field.status = DocumentFieldStatus.CONFLICTING
            field.conflicts.extend(FieldConflictValue(
                value=line, sourceFactIds=[mapping.factId], provenance=mapping.provenance,
            ) for line, mapping in zip(lines, [item for item in mappings if item.mappingRule == "selected_event"]))
            field.missingMarker = f"[CONFLICT: {field.label} has competing recorded values]"
        elif unsupported:
            field.status = DocumentFieldStatus.UNSUPPORTED


def _map_case_profile(case_state: CaseState, fields: dict[str, DocumentField]) -> None:
    if case_state.person.name:
        source = DocumentProvenance(
            sourceType="case_state", sourceId="person.name", label="Name recorded in the case profile", status="user_reported",
        )
        for field_id in ("sender_name", "declarant_name", "signature_name"):
            field = fields.get(field_id)
            if field and field.value is None:
                field.value = case_state.person.name.strip()
                field.status = DocumentFieldStatus.USER_REPORTED
                field.provenance = [source]
                field.missingMarker = None
    if case_state.person.contact and "sender_contact" in fields:
        field = fields["sender_contact"]
        if field.value is None:
            field.value = case_state.person.contact.strip()
            field.status = DocumentFieldStatus.USER_REPORTED
            field.provenance = [DocumentProvenance(
                sourceType="case_state", sourceId="person.contact", label="Contact recorded in the case profile", status="user_reported",
            )]


def _map_jurisdiction(case_state: CaseState, fields: dict[str, DocumentField]) -> None:
    field = fields.get("jurisdiction")
    if field is None:
        return
    jurisdiction = case_state.jurisdiction
    parts = [jurisdiction.city, jurisdiction.district, jurisdiction.state, jurisdiction.country]
    value = ", ".join(dict.fromkeys(item.strip() for item in parts if item and item.strip()))
    if not value:
        return
    status = DocumentFieldStatus.USER_REPORTED if jurisdiction.basis == "user_reported" else DocumentFieldStatus.UNSUPPORTED
    field.value = value
    field.status = status
    field.provenance = [DocumentProvenance(
        sourceType="case_state",
        sourceId="jurisdiction",
        label="Jurisdiction recorded in the case state",
        status=jurisdiction.basis,
    )]


def _event_sources(event, case_state: CaseState) -> tuple[list[DocumentProvenance], list[str]]:
    evidence_by_id = {item.id: item for item in case_state.evidence}
    sources: list[DocumentProvenance] = []
    evidence_ids: list[str] = []
    for source_id in event.evidenceIds:
        evidence = evidence_by_id.get(source_id)
        if evidence is None:
            sources.append(DocumentProvenance(
                sourceType="unresolved_evidence", sourceId=source_id,
                label=f"Unresolved evidence reference: {source_id}", status="unknown",
            ))
        else:
            sources.append(_provenance_for_evidence(evidence, case_state))
            evidence_ids.append(evidence.id)
    return _dedupe_provenance(sources), evidence_ids


def _map_chronology(
    case_state: CaseState,
    fields: dict[str, DocumentField],
    included_fact_ids: set[str] | None,
    event_edits: dict[str, str] | None = None,
) -> bool:
    field = fields.get("chronology")
    events = [
        event for event in case_state.events
        if included_fact_ids is None or f"event:{event.id}" in included_fact_ids
    ]
    if field is None or not events:
        return False
    lines: list[str] = []
    provenance: list[DocumentProvenance] = []
    evidence_ids: list[str] = []
    unsupported = False
    conflicting = False
    for index, event in enumerate(events, start=1):
        date = event.date.strip() if event.date else ""
        if date and event.datePrecision == "approximate":
            date = f"Around {date}"
        elif not date:
            date = "[DATE NOT RECORDED]"
        event_id = f"event:{event.id}"
        description = (event_edits or {}).get(event_id, event.description.strip())
        lines.append(f"{index}. {date} · {description}")
        event_provenance, event_evidence_ids = _event_sources(event, case_state)
        provenance.extend(event_provenance)
        if event_id in (event_edits or {}):
            provenance.append(DocumentProvenance(
                sourceType="user_edit", sourceId=f"case-event-edit:{event.id}",
                label="Selected case event wording edited by the user", status="user_authored",
            ))
        evidence_ids.extend(event_evidence_ids)
        if not event_provenance or any(item.sourceType == "unresolved_evidence" for item in event_provenance):
            unsupported = True
        if any(item.status == "conflicting" for item in event_provenance):
            conflicting = True
    field.value = "\n".join(lines)
    field.status = (
        DocumentFieldStatus.CONFLICTING if conflicting
        else DocumentFieldStatus.UNSUPPORTED if unsupported
        else DocumentFieldStatus.EVIDENCE_SUPPORTED
    )
    field.provenance = _dedupe_provenance(provenance)
    field.sourceEvidenceIds = list(dict.fromkeys(evidence_ids))
    field.missingMarker = None
    return True


def _map_evidence_index(case_state: CaseState, fields: dict[str, DocumentField]) -> None:
    field = fields.get("evidence_items")
    if field is None or not case_state.evidence:
        return
    lines: list[str] = []
    sources: list[DocumentProvenance] = []
    for index, evidence in enumerate(case_state.evidence, start=1):
        document = next((item for item in case_state.documents if item.id == evidence.documentId), None)
        detail = f"{evidence.title} · {evidence.source.replace('_', ' ')} · {evidence.status.replace('_', ' ')}"
        if document:
            detail += f" · {document.filename}"
        lines.append(f"{index}. {detail}")
        sources.append(_provenance_for_evidence(evidence, case_state))
    field.value = "\n".join(lines)
    field.status = DocumentFieldStatus.USER_REPORTED
    field.provenance = _dedupe_provenance(sources)
    field.sourceEvidenceIds = [item.id for item in case_state.evidence]
    field.missingMarker = None


_FILING_CHECKLIST = (
    "Confirm the correct recipient or filing destination from an official source.",
    "Check current official instructions for format, filing method, fees, and any deadline.",
    "Review each factual statement against its listed source; resolve any flagged conflict.",
    "Complete or remove every missing-information marker before filing.",
    "Attach only the evidence copies you intend to submit and retain the originals.",
)


def _map_filing_checklist(fields: dict[str, DocumentField], template: DocumentTemplate) -> None:
    field = fields.get("checklist_items")
    if field is None:
        return
    field.value = "\n".join(f"☐ {item}" for item in _FILING_CHECKLIST)
    field.status = DocumentFieldStatus.USER_REPORTED
    field.provenance = [DocumentProvenance(
        sourceType="template", sourceId=template.id, label="Neutral checklist wording in the document template", status="template_text",
    )]
    field.missingMarker = None
    missing = fields.get("missing_information")
    if missing:
        missing.value = "Information not recorded in this case is listed as a required-field marker above."
        missing.status = DocumentFieldStatus.USER_REPORTED
        missing.provenance = [DocumentProvenance(
            sourceType="template", sourceId=template.id, label="Neutral missing-information note in the template", status="template_text",
        )]
        missing.missingMarker = None


def _collect_conflicts(case_state: CaseState, fields: dict[str, DocumentField]) -> list[DocumentConflict]:
    conflicts: list[DocumentConflict] = []
    for field in fields.values():
        if field.status == DocumentFieldStatus.CONFLICTING:
            conflicts.append(DocumentConflict(
                id=f"field:{field.id}",
                summary=f"Conflicting values for {field.label} were left unresolved.",
                fieldId=field.id,
                sourceIds=field.sourceFactIds,
            ))
    for index, description in enumerate(case_state.conflicts):
        conflicts.append(DocumentConflict(
            id=f"case-conflict:{index + 1}",
            summary=description,
        ))
    for claim in case_state.claims:
        if claim.status == "conflicting":
            conflicts.append(DocumentConflict(
                id=f"claim:{claim.id}",
                summary=f"A case claim is marked conflicting: {claim.text}",
                sourceIds=[claim.id, *claim.evidenceIds],
            ))
    return conflicts


def _missing_information(fields: dict[str, DocumentField], case_state: CaseState) -> list[str]:
    missing = [field.missingMarker for field in fields.values() if field.missingMarker and field.status == DocumentFieldStatus.MISSING]
    missing.extend(f"Unresolved case information: {item.strip()}" for item in case_state.unknowns if item.strip())
    return list(dict.fromkeys(missing))


def _render_value(field: DocumentField) -> str | None:
    if field.status == DocumentFieldStatus.CONFLICTING:
        values = "; ".join(f"{item.value} (source facts: {', '.join(item.sourceFactIds) or 'not linked'})" for item in field.conflicts)
        return f"{field.missingMarker or '[CONFLICT: values left unresolved]'}\nRecorded alternatives: {values}"
    if field.status == DocumentFieldStatus.MISSING or field.value is None or not field.value.strip():
        return field.missingMarker
    if field.status == DocumentFieldStatus.UNSUPPORTED:
        marker = "UNSUPPORTED MATERIAL FACT" if field.material else "UNSUPPORTED SOURCE"
        return f"[{marker}: source evidence is missing or unresolved]\n{field.value}"
    return field.value


def _render_content(template: DocumentTemplate, fields: dict[str, DocumentField]) -> str:
    lines = [
        template.title.upper(),
        "DRAFT · Review every statement and source before use.",
        template.disclaimer,
        "",
    ]
    for section in template.sections:
        section_lines: list[str] = []
        for field_id in section.fieldIds:
            field = fields[field_id]
            value = _render_value(field)
            if value is None:
                continue
            section_lines.append(f"{field.label}: {value} [F:{field.id}]")
        if section_lines:
            lines.extend([section.heading, *section_lines, ""])

    lines.append("SOURCE NOTES · Each [F:field_id] points to the field record in this document.")
    for field in fields.values():
        if not field.provenance:
            if field.status == DocumentFieldStatus.MISSING:
                lines.append(f"[F:{field.id}] No case source supplied; marker retained.")
            continue
        sources = "; ".join(
            f"{source.sourceType}:{source.sourceId} · {source.label} · {source.status}"
            + (f" · page {source.pageNumber}" if source.pageNumber else "")
            + (f" · {source.sourceUrl}" if source.sourceUrl else "")
            for source in field.provenance
        )
        lines.append(f"[F:{field.id}] {sources}")
    if not fields.get("legal_text") or not fields["legal_text"].value:
        lines.append("No legal wording or legal provision was added by the compiler.")
    return "\n".join(lines).rstrip() + "\n"


def _refresh_derived(draft: DocumentDraft, case_state: CaseState) -> DocumentDraft:
    template = TEMPLATE_BY_ID[draft.templateId]
    draft.conflicts = _collect_conflicts(case_state, draft.fields)
    draft.unsupportedMaterialFactIds = [
        field.id for field in draft.fields.values()
        if field.material and field.status == DocumentFieldStatus.UNSUPPORTED and field.value
    ]
    draft.missingInformation = _missing_information(draft.fields, case_state)
    draft.content = _render_content(template, draft.fields)
    draft.updatedAt = _now()
    return draft


def _apply_user_values(
    draft: DocumentDraft,
    template: DocumentTemplate,
    case_state: CaseState,
    field_values: dict[str, str],
    legal_source_ids: dict[str, str],
) -> None:
    specs = {spec.id: spec for spec in template.fields}
    unknown = set(field_values) - set(specs)
    if unknown:
        raise ValueError(f"Unknown document field(s): {', '.join(sorted(unknown))}.")
    unknown_legal_fields = set(legal_source_ids) - {"legal_text"}
    if unknown_legal_fields:
        raise ValueError("Legal source references are supported only for the legal_text field.")

    for field_id, value in field_values.items():
        field = draft.fields[field_id]
        if field.status == DocumentFieldStatus.CONFLICTING:
            raise ValueError(f"Resolve the conflicting case values for {field.label} in the case record before editing this field.")
        if field_id == "legal_text" and value.strip():
            source_id = legal_source_ids.get(field_id) or field.legalSourceId
            if not source_id:
                raise ValueError("Legal wording requires a verified legal source recorded in this case.")
            source = _legal_source(case_state, source_id)
            field.legalSourceId = source_id
            field.provenance = _dedupe_provenance([*field.provenance, source])
        if field_id == "legal_text" and not value.strip():
            field.legalSourceId = None
            field.provenance = [item for item in field.provenance if item.sourceType != "legal_source"]

        field.value = value.strip() or None
        field.status = DocumentFieldStatus.USER_AUTHORED if field.value else DocumentFieldStatus.MISSING
        field.missingMarker = f"[MISSING INFORMATION: {field.label}]" if field.required and not field.value else None
        field.provenance = _dedupe_provenance([
            *field.provenance,
            DocumentProvenance(
                sourceType="user_edit",
                sourceId=f"document:{draft.id}:{field_id}",
                label="Wording entered or edited by the user",
                status="user_authored",
            ),
        ]) if field.value else field.provenance

    if "legal_text" in legal_source_ids and "legal_text" not in field_values:
        field = draft.fields.get("legal_text")
        if field and field.value:
            source = _legal_source(case_state, legal_source_ids["legal_text"])
            field.legalSourceId = legal_source_ids["legal_text"]
            field.provenance = _dedupe_provenance([
                item for item in field.provenance if item.sourceType != "legal_source"
            ] + [source])


def create_document_draft(
    case_state: CaseState,
    template_id: str,
    *,
    field_values: dict[str, str] | None = None,
    legal_source_ids: dict[str, str] | None = None,
    included_fact_ids: list[str] | None = None,
    fact_edits: dict[str, str] | None = None,
) -> DocumentDraft:
    template = get_document_template(template_id)
    if template is None:
        raise ValueError(f"Unknown document template: {template_id}.")
    selected_ids = set(included_fact_ids) if included_fact_ids is not None else None
    if selected_ids is not None:
        known_ids = {fact.id for fact in case_state.facts} | {f"event:{event.id}" for event in case_state.events} | {"initial-statement"}
        unknown_ids = selected_ids - known_ids
        if unknown_ids:
            raise ValueError(f"Unknown selected case fact id(s): {', '.join(sorted(unknown_ids))}.")
    selected_edits = fact_edits or {}
    known_edit_ids = {fact.id for fact in case_state.facts} | {f"event:{event.id}" for event in case_state.events} | {"initial-statement"}
    unknown_edits = set(selected_edits) - known_edit_ids
    if unknown_edits:
        raise ValueError(f"Unknown case fact edit id(s): {', '.join(sorted(unknown_edits))}.")
    if selected_ids is not None and set(selected_edits) - selected_ids:
        raise ValueError("Only selected case facts can be edited in a document draft.")
    fields, mappings = _map_case_state(
        case_state,
        template,
        selected_ids,
        selected_edits,
    )
    now = _now()
    draft = DocumentDraft(
        id=str(uuid4()),
        caseId=case_state.id,
        templateId=template.id,
        documentType=template.documentType,
        title=template.title,
        fields=fields,
        factMappings=mappings,
        conflicts=[],
        unsupportedMaterialFactIds=[],
        missingInformation=[],
        content="",
        sourceCaseFingerprint=case_fingerprint(case_state),
        sourceCaseUpdatedAt=case_state.metadata.updatedAt,
        createdAt=now,
        updatedAt=now,
    )
    _apply_user_values(draft, template, case_state, field_values or {}, legal_source_ids or {})
    return _refresh_derived(draft, case_state)


def edit_document_draft(
    draft: DocumentDraft,
    case_state: CaseState,
    *,
    field_values: dict[str, str],
    legal_source_ids: dict[str, str],
) -> DocumentDraft:
    if case_fingerprint(case_state) != draft.sourceCaseFingerprint:
        return mark_stale(draft, case_state)
    if draft.reviewState == DocumentReviewState.REVIEWED:
        draft.reviewState = DocumentReviewState.DRAFT
        draft.confirmedAt = None
        draft.missingInformationAcknowledged = False
    template = TEMPLATE_BY_ID[draft.templateId]
    _apply_user_values(draft, template, case_state, field_values, legal_source_ids)
    return _refresh_derived(draft, case_state)


def mark_stale(draft: DocumentDraft, case_state: CaseState) -> DocumentDraft:
    if case_fingerprint(case_state) == draft.sourceCaseFingerprint:
        return draft
    draft.reviewState = DocumentReviewState.STALE
    draft.confirmedAt = None
    draft.missingInformationAcknowledged = False
    return draft


def confirm_document_draft(
    draft: DocumentDraft,
    case_state: CaseState,
    *,
    acknowledge_missing_information: bool,
) -> DocumentDraft:
    draft = mark_stale(draft, case_state)
    if draft.reviewState == DocumentReviewState.STALE:
        raise ValueError("The case changed after this draft was prepared. Generate a fresh draft before confirming it.")
    if draft.missingInformation and not acknowledge_missing_information:
        raise ValueError("Review and explicitly acknowledge the missing-information markers before confirming this draft.")
    draft.reviewState = DocumentReviewState.REVIEWED
    draft.confirmedAt = _now()
    draft.missingInformationAcknowledged = acknowledge_missing_information
    draft.updatedAt = _now()
    return draft


def prepare_export(draft: DocumentDraft, case_state: CaseState) -> ExportReadyDocument:
    draft = mark_stale(draft, case_state)
    blockers: list[str] = []
    if draft.reviewState == DocumentReviewState.STALE:
        blockers.append("The case changed after this draft was prepared; generate a fresh draft.")
    if draft.reviewState != DocumentReviewState.REVIEWED:
        blockers.append("The user has not confirmed review of this document.")
    if draft.conflicts:
        blockers.append("Resolve all recorded conflicts in the case record before export.")
    if draft.unsupportedMaterialFactIds:
        blockers.append("Material facts without supporting evidence must be sourced or removed before export.")
    if draft.missingInformation and not draft.missingInformationAcknowledged:
        blockers.append("Required information is missing and has not been explicitly acknowledged.")
    content = draft.content
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    provenance = _dedupe_provenance([
        source for field in draft.fields.values() for source in field.provenance
    ])
    filename = re.sub(r"[^a-z0-9]+", "-", draft.title.casefold()).strip("-") or "document"
    return ExportReadyDocument(
        status="ready" if not blockers else "blocked",
        documentId=draft.id,
        caseId=draft.caseId,
        filename=f"{filename}.txt",
        content=content,
        contentSha256=digest,
        sourceCaseFingerprint=draft.sourceCaseFingerprint,
        provenance=provenance,
        blockers=blockers,
    )


def create_document_package(
    case_state: CaseState,
    *,
    template_ids: list[str] | None = None,
    field_values_by_template: dict[str, dict[str, str]] | None = None,
    legal_source_ids_by_template: dict[str, dict[str, str]] | None = None,
    included_fact_ids_by_template: dict[str, list[str]] | None = None,
    fact_edits_by_template: dict[str, dict[str, str]] | None = None,
) -> DocumentPackage:
    selected = template_ids or [template.id for template in DOCUMENT_TEMPLATES]
    if len(selected) != len(set(selected)):
        raise ValueError("A document package cannot contain a template more than once.")
    if not selected:
        raise ValueError("Choose at least one document template for the package.")
    unknown = [template_id for template_id in selected if template_id not in TEMPLATE_BY_ID]
    if unknown:
        raise ValueError(f"Unknown document template(s): {', '.join(unknown)}.")

    values_by_template = field_values_by_template or {}
    sources_by_template = legal_source_ids_by_template or {}
    included_by_template = included_fact_ids_by_template or {}
    edits_by_template = fact_edits_by_template or {}
    documents = [
        create_document_draft(
            case_state,
            template_id,
            field_values=values_by_template.get(template_id, {}),
            legal_source_ids=sources_by_template.get(template_id, {}),
            included_fact_ids=included_by_template.get(template_id),
            fact_edits=edits_by_template.get(template_id),
        )
        for template_id in selected
    ]
    now = _now()
    return DocumentPackage(
        id=str(uuid4()),
        caseId=case_state.id,
        title=f"{len(documents)} document package",
        documents=documents,
        sourceCaseFingerprint=case_fingerprint(case_state),
        sourceCaseUpdatedAt=case_state.metadata.updatedAt,
        createdAt=now,
        updatedAt=now,
    )


def mark_package_stale(package: DocumentPackage, case_state: CaseState) -> DocumentPackage:
    for document in package.documents:
        mark_stale(document, case_state)
    if case_fingerprint(case_state) != package.sourceCaseFingerprint:
        package.updatedAt = _now()
    return package


def prepare_package_export(package: DocumentPackage, case_state: CaseState) -> ExportReadyPackage:
    package = mark_package_stale(package, case_state)
    exports = [prepare_export(document, case_state) for document in package.documents]
    blockers = [
        f"{document.filename}: {reason}"
        for document in exports if document.status == "blocked"
        for reason in document.blockers
    ]
    filename = re.sub(r"[^a-z0-9]+", "-", package.title.casefold()).strip("-") or "document-package"
    return ExportReadyPackage(
        status="ready" if not blockers else "blocked",
        packageId=package.id,
        caseId=package.caseId,
        filename=f"{filename}.json",
        documents=exports,
        blockers=blockers,
        createdAt=_now(),
    )

