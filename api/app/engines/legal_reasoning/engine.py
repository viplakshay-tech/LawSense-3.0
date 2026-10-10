"""Deterministic legal reasoning over canonical case and knowledge records.

This module has no model-provider, network, database, or clock dependency. It
surfaces recorded facts and explicit source links, while fail-closed checks
prevent unsupported legal or jurisdiction-specific conclusions.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Sequence

from app.engines.legal_knowledge.models import (
    Authority,
    Jurisdiction as KnowledgeJurisdiction,
    KnowledgeItem,
    KnowledgeRelationship,
    KnowledgeStatus,
    LegalProcedure,
    LegalProvision,
    LegalRule,
    RelationshipType,
    SourceReference,
)
from app.schemas.case_state import CaseState, EvidenceItem, LegalIssue

from app.engines.legal_reasoning.models import (
    BlockedConclusion,
    Conflict,
    EvidenceGap,
    Finding,
    GroundedLegalStatement,
    PossibleProceduralPath,
    ReasoningProvenance,
    ReasoningResult,
    ReasoningRisk,
    ReasoningStep,
    UncertaintyAssessment,
    UnresolvedQuestion,
)


REASON_CODE_MESSAGES: dict[str, str] = {
    "LEGAL_KNOWLEDGE_UNAVAILABLE": "No usable legal provision or rule records were supplied for legal grounding.",
    "JURISDICTION_UNKNOWN": "The relevant jurisdiction is not established in the CaseState.",
    "JURISDICTION_RECORD_UNMAPPED": "The recorded location could not be matched to a supplied legal jurisdiction record.",
    "JURISDICTION_RECORD_AMBIGUOUS": "The recorded location matches more than one supplied legal jurisdiction record.",
    "JURISDICTION_RECORD_NOT_VERIFIED": "The matching legal jurisdiction record is not marked verified.",
    "JURISDICTION_RECORD_SOURCE_MISSING": "The matching legal jurisdiction record has no source provenance.",
    "JURISDICTION_MISMATCH": "The supplied record is for a different jurisdiction.",
    "SOURCE_PROVENANCE_MISSING": "The record has no source provenance.",
    "RELATIONSHIP_SOURCE_UNAVAILABLE": "The supplied relationship has no source citation.",
    "KNOWLEDGE_RECORD_NOT_VERIFIED": "The knowledge record is not marked verified.",
    "KNOWLEDGE_RECORD_LINK_MISMATCH": "A supplied legal record does not agree with the record it explicitly references.",
    "PROCEDURE_RECORD_NOT_VERIFIED": "The procedure record is not marked verified.",
    "AUTHORITY_RECORD_UNAVAILABLE": "No matching authority record was supplied.",
    "AUTHORITY_RECORD_NOT_VERIFIED": "The authority record is not marked verified.",
    "PROCEDURE_ISSUE_LINK_MISSING": "No explicit relationship connects a supplied procedure record to a recorded issue.",
    "PROCEDURAL_AVAILABILITY_NOT_ESTABLISHED": "The engine lists the supplied procedure as a candidate and does not establish current availability.",
    "RULE_APPLICATION_NOT_PERFORMED": "The engine does not determine whether a legal rule applies to the recorded facts.",
    "COURT_OUTCOME_NOT_PREDICTED": "The engine does not predict a court or decision-maker outcome.",
    "EVIDENCE_NOT_LINKED": "No document-backed evidence record is linked to this recorded item.",
    "EVIDENCE_SOURCE_MISSING": "A referenced evidence record is absent from the CaseState.",
    "USER_REPORT_ONLY": "This remains a user-reported statement and has not been elevated to an established fact.",
    "CONFLICT_UNRESOLVED": "The supplied records identify a conflict that this engine cannot resolve.",
    "ASSUMPTION_UNVERIFIED": "The supplied assumption remains unverified.",
    "UNKNOWN_REMAINS_OPEN": "The supplied unknown remains unresolved.",
    "EFFECTIVE_DATE_NOT_ASSESSED": "The record's effective dates have not been evaluated against an event date.",
    "CASE_STATE_REVIEWED": "The canonical CaseState records were reviewed.",
    "USER_OBJECTIVE_RECORDED": "The user's stated objective is retained as user-reported context.",
    "LEGAL_STATEMENT_LINK_MISSING": "No supplied provision-to-issue relationship supports an issue-specific legal statement.",
}


def _stable_id(kind: str, case_id: str, *parts: str) -> str:
    raw = "\x1f".join((kind, case_id, *parts)).encode("utf-8")
    return f"{kind}_{hashlib.sha256(raw).hexdigest()[:16]}"


def _status(value: object) -> str:
    return str(getattr(value, "value", value))


def _unique_codes(values: Iterable[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(value for value in values if value))


def _unique_refs(values: Iterable[ReasoningProvenance]) -> tuple[ReasoningProvenance, ...]:
    refs: dict[tuple[object, ...], ReasoningProvenance] = {}
    for ref in values:
        key = (
            ref.source_type, ref.source_id, ref.source_path, ref.status,
            ref.page_number, ref.locator, ref.details, ref.confidence,
        )
        refs[key] = ref
    return tuple(refs[key] for key in sorted(refs, key=lambda item: tuple(str(part) for part in item)))


def _case_ref(case_state: CaseState, path: str, status: str, details: str | None = None) -> ReasoningProvenance:
    return ReasoningProvenance(
        source_type="case_state",
        source_id=case_state.id,
        source_path=path,
        status=status,
        details=details,
    )


def _input_ref(case_state: CaseState, path: str, status: str, details: str | None = None) -> ReasoningProvenance:
    return ReasoningProvenance(
        source_type="reasoning_input",
        source_id=case_state.id,
        source_path=path,
        status=status,
        details=details,
    )


def _evidence_ref(item: EvidenceItem) -> ReasoningProvenance:
    return ReasoningProvenance(
        source_type=item.source,
        source_id=item.id,
        source_path=f"evidence/{item.id}",
        status=item.status,
        locator=f"document:{item.documentId}" if item.documentId else None,
        details=item.title,
    )


def _source_reference_ref(reference: SourceReference, status: str, confidence: float | None = None) -> ReasoningProvenance:
    locator_parts = [
        f"document:{reference.document_id}" if reference.document_id else None,
        f"provision:{reference.provision_id}" if reference.provision_id else None,
        reference.page_section_reference,
        reference.source_url,
    ]
    locator = " | ".join(part for part in locator_parts if part)
    path = reference.page_section_reference or reference.provision_id or reference.document_id or reference.source_url or "source"
    return ReasoningProvenance(
        source_type="legal_source",
        source_id=reference.source_id,
        source_path=path,
        status=status,
        confidence=confidence,
        locator=locator or None,
        details=f"Retrieved at {reference.retrieval_time.isoformat()}",
    )


def _knowledge_refs(item: KnowledgeItem) -> tuple[ReasoningProvenance, ...]:
    status = _status(item.status)
    refs = [ReasoningProvenance(
        source_type="knowledge_record",
        source_id=item.id,
        source_path=f"legal_knowledge/{item.id}",
        status=status,
        confidence=item.confidence,
        locator=item.source_url,
        details=item.title,
    )]
    refs.extend(_source_reference_ref(reference, status, item.confidence) for reference in item.provenance)
    return _unique_refs(refs)


def _relationship_refs(relationship: KnowledgeRelationship) -> tuple[ReasoningProvenance, ...]:
    relation = _status(relationship.relationship)
    if relationship.provenance:
        return _unique_refs(
            _source_reference_ref(reference, "relationship_source")
            for reference in relationship.provenance
        )
    return (ReasoningProvenance(
        source_type="knowledge_relationship",
        source_id=f"{relationship.subject_id}:{relation}:{relationship.object_id}",
        source_path=f"relationships/{relationship.subject_id}/{relation}/{relationship.object_id}",
        status="unknown",
        details="Caller-supplied relationship; no source citation was attached.",
    ),)


def _catalog_jurisdiction_match(
    case_state: CaseState,
    jurisdiction_records: Sequence[KnowledgeJurisdiction],
) -> tuple[str, KnowledgeJurisdiction | None, tuple[ReasoningProvenance, ...]]:
    jurisdiction = case_state.jurisdiction
    location = {
        "country": jurisdiction.country,
        "state": jurisdiction.state,
        "district": jurisdiction.district,
        "city": jurisdiction.city,
    }
    recorded = {key: value.strip().casefold() for key, value in location.items() if value and value.strip()}
    refs = [_case_ref(
        case_state,
        "jurisdiction",
        jurisdiction.basis,
        "Recorded geographic scope and its CaseState basis.",
    )]
    if not recorded or jurisdiction.basis == "unknown":
        if jurisdiction.locationText and jurisdiction.basis != "unknown":
            return "unmapped", None, tuple(refs)
        return "unknown", None, tuple(refs)

    comparable = {key: value for key, value in recorded.items() if key in {"country", "state", "district"}}
    matches: list[KnowledgeJurisdiction] = []
    for item in jurisdiction_records:
        catalog = {
            "country": item.country,
            "state": item.state,
            "district": item.district,
        }
        # Every recorded country/state/district must be present and match. A
        # city alone cannot be mapped because the catalog has no city field.
        if not comparable or any(
            not catalog.get(key)
            or catalog[key].strip().casefold() != value
            for key, value in comparable.items()
        ):
            continue
        matches.append(item)

    if len(matches) == 1:
        match = matches[0]
        refs.extend(_knowledge_refs(match))
        if match.status != KnowledgeStatus.VERIFIED:
            return "catalog_unverified", match, _unique_refs(refs)
        if not match.provenance:
            return "catalog_source_missing", match, _unique_refs(refs)
        return "mapped", match, _unique_refs(refs)
    if len(matches) > 1:
        refs.extend(ref for match in matches for ref in _knowledge_refs(match))
        return "ambiguous", None, _unique_refs(refs)
    return "unmapped", None, _unique_refs(refs)


def _issue_matches(value: str, issues: Sequence[LegalIssue]) -> tuple[LegalIssue, ...]:
    key = value.strip().casefold()
    if not key:
        return ()
    return tuple(
        issue for issue in issues
        if key in {part.casefold() for part in (issue.id, issue.category, issue.subcategory) if part}
    )


def _merge_records(
    legal_knowledge_records: Sequence[KnowledgeItem],
    procedure_records: Sequence[LegalProcedure],
    authority_records: Sequence[Authority],
    jurisdiction_records: Sequence[KnowledgeJurisdiction],
) -> dict[str, KnowledgeItem]:
    all_records: list[KnowledgeItem] = [
        *legal_knowledge_records,
        *procedure_records,
        *authority_records,
        *jurisdiction_records,
    ]
    records: dict[str, KnowledgeItem] = {}
    for item in all_records:
        if not isinstance(item, KnowledgeItem):
            raise TypeError("Knowledge, procedure, authority, and jurisdiction records must be KnowledgeItem values.")
        previous = records.get(item.id)
        if previous is not None and previous != item:
            raise ValueError(f"Conflicting knowledge records share the ID {item.id!r}.")
        records[item.id] = item
    return records


def _validate_inputs(
    case_state: CaseState,
    legal_knowledge_records: Sequence[KnowledgeItem],
    procedure_records: Sequence[LegalProcedure],
    authority_records: Sequence[Authority],
    jurisdiction_records: Sequence[KnowledgeJurisdiction],
    relationships: Sequence[KnowledgeRelationship],
) -> None:
    if not isinstance(case_state, CaseState):
        raise TypeError("case_state must be an app.schemas.case_state.CaseState")
    for item in legal_knowledge_records:
        if not isinstance(item, KnowledgeItem):
            raise TypeError("legal_knowledge_records must contain KnowledgeItem values")
    for item in procedure_records:
        if not isinstance(item, LegalProcedure):
            raise TypeError("procedure_records must contain LegalProcedure values")
    for item in authority_records:
        if not isinstance(item, Authority):
            raise TypeError("authority_records must contain Authority values")
    for item in jurisdiction_records:
        if not isinstance(item, KnowledgeJurisdiction):
            raise TypeError("jurisdiction_records must contain legal-knowledge Jurisdiction values")
    if any(not isinstance(item, KnowledgeRelationship) for item in relationships):
        raise TypeError("relationships must contain KnowledgeRelationship values")


def _knowledge_blockers(
    item: KnowledgeItem,
    jurisdiction_status: str,
    mapped_jurisdiction: KnowledgeJurisdiction | None,
) -> tuple[str, ...]:
    blockers: list[str] = []
    if not item.provenance:
        blockers.append("SOURCE_PROVENANCE_MISSING")
    if item.status != KnowledgeStatus.VERIFIED:
        blockers.append("KNOWLEDGE_RECORD_NOT_VERIFIED")
    if jurisdiction_status == "unknown":
        blockers.append("JURISDICTION_UNKNOWN")
    elif jurisdiction_status == "unmapped":
        blockers.append("JURISDICTION_RECORD_UNMAPPED")
    elif jurisdiction_status == "ambiguous":
        blockers.append("JURISDICTION_RECORD_AMBIGUOUS")
    elif jurisdiction_status == "catalog_unverified":
        blockers.append("JURISDICTION_RECORD_NOT_VERIFIED")
    elif jurisdiction_status == "catalog_source_missing":
        blockers.append("JURISDICTION_RECORD_SOURCE_MISSING")
    elif mapped_jurisdiction is not None and item.jurisdiction != mapped_jurisdiction.id:
        blockers.append("JURISDICTION_MISMATCH")
    if (item.effective_from is not None or item.effective_to is not None):
        blockers.append("EFFECTIVE_DATE_NOT_ASSESSED")
    return _unique_codes(blockers)


def _relationship_issue_ids(
    value: str,
    issues: Sequence[LegalIssue],
) -> tuple[str, ...]:
    return tuple(issue.id for issue in _issue_matches(value, issues))


def _issue_refs(case_state: CaseState, issue_ids: Sequence[str]) -> tuple[ReasoningProvenance, ...]:
    issues = {issue.id: issue for issue in case_state.legalIssues}
    return tuple(
        _case_ref(
            case_state,
            f"legalIssues/{issue_id}",
            "system_inferred",
            f"Recorded issue category: {issues[issue_id].category}",
        )
        for issue_id in issue_ids
        if issue_id in issues
    )


def _build_legal_statements(
    case_state: CaseState,
    records: dict[str, KnowledgeItem],
    relationships: Sequence[KnowledgeRelationship],
    jurisdiction_status: str,
    mapped_jurisdiction: KnowledgeJurisdiction | None,
) -> tuple[GroundedLegalStatement, ...]:
    statements: list[GroundedLegalStatement] = []
    for relation in relationships:
        if _status(relation.relationship) != RelationshipType.PROVISION_ADDRESSES_ISSUE.value:
            continue
        provision = records.get(relation.subject_id)
        if not isinstance(provision, LegalProvision):
            continue
        issue_ids = _relationship_issue_ids(relation.object_id, case_state.legalIssues)
        if not issue_ids:
            continue
        link_refs = _relationship_refs(relation)
        if not relation.provenance:
            link_codes = ("RELATIONSHIP_SOURCE_UNAVAILABLE",)
        else:
            link_codes = ()
        related_records: list[tuple[KnowledgeItem, str]] = []
        if provision.text:
            related_records.append((provision, provision.text))
        related_records.extend(
            (item, item.rule_text)
            for item in records.values()
            if isinstance(item, LegalRule)
            and item.provision_id == provision.id
            and item.rule_text
        )
        for item, text in related_records:
            record_codes = list(_knowledge_blockers(item, jurisdiction_status, mapped_jurisdiction))
            if isinstance(item, LegalRule) and (
                item.source != provision.source
                or item.jurisdiction != provision.jurisdiction
                or item.authority != provision.authority
            ):
                record_codes.append("KNOWLEDGE_RECORD_LINK_MISMATCH")
            codes = _unique_codes((*record_codes, *link_codes))
            refs = _unique_refs((
                *_knowledge_refs(item),
                *_knowledge_refs(provision),
                *link_refs,
                *_issue_refs(case_state, issue_ids),
            ))
            statements.append(GroundedLegalStatement(
                id=_stable_id("grounding", case_state.id, item.id, *issue_ids),
                record_id=item.id,
                record_title=item.title,
                text=text,
                record_status=_status(item.status),
                related_issue_ids=issue_ids,
                source_references=refs,
                reason_codes=_unique_codes((*codes, "RULE_APPLICATION_NOT_PERFORMED")),
            ))
    merged: dict[str, GroundedLegalStatement] = {}
    for item in statements:
        previous = merged.get(item.id)
        if previous is None:
            merged[item.id] = item
        else:
            merged[item.id] = GroundedLegalStatement(
                id=item.id,
                record_id=item.record_id,
                record_title=item.record_title,
                text=item.text,
                record_status=item.record_status,
                related_issue_ids=item.related_issue_ids,
                source_references=_unique_refs((*previous.source_references, *item.source_references)),
                reason_codes=_unique_codes((*previous.reason_codes, *item.reason_codes)),
            )
    return tuple(sorted(merged.values(), key=lambda item: (item.record_id, item.related_issue_ids, item.id)))


def _build_paths(
    case_state: CaseState,
    records: dict[str, KnowledgeItem],
    relationships: Sequence[KnowledgeRelationship],
    jurisdiction_status: str,
    mapped_jurisdiction: KnowledgeJurisdiction | None,
    jurisdiction_refs: tuple[ReasoningProvenance, ...],
) -> tuple[PossibleProceduralPath, ...]:
    candidates: dict[tuple[str, tuple[str, ...]], tuple[LegalProcedure, list[ReasoningProvenance], list[str]]] = {}

    def add_candidate(
        procedure: LegalProcedure,
        issue_ids: tuple[str, ...],
        refs: Iterable[ReasoningProvenance],
        codes: Iterable[str] = (),
    ) -> None:
        key = (procedure.id, issue_ids)
        if key not in candidates:
            candidates[key] = (procedure, [], [])
        candidates[key][1].extend(refs)
        candidates[key][2].extend(codes)

    ordered_relationships = sorted(
        relationships,
        key=lambda item: (item.subject_id, _status(item.relationship), item.object_id),
    )
    for relation in ordered_relationships:
        if _status(relation.relationship) == RelationshipType.ISSUE_SUGGESTS_PROCEDURE.value:
            procedure = records.get(relation.object_id)
            if isinstance(procedure, LegalProcedure):
                issue_ids = _relationship_issue_ids(relation.subject_id, case_state.legalIssues)
                if issue_ids:
                    add_candidate(
                        procedure,
                        issue_ids,
                        _relationship_refs(relation),
                        () if relation.provenance else ("RELATIONSHIP_SOURCE_UNAVAILABLE",),
                    )

    # A procedure's explicit related_provision_ids and a source-linked
    # provision-to-issue relationship form another fully recorded link path.
    for procedure in sorted(
        (item for item in records.values() if isinstance(item, LegalProcedure)),
        key=lambda item: item.id,
    ):
        for provision_id in procedure.related_provision_ids:
            provision = records.get(provision_id)
            if not isinstance(provision, LegalProvision):
                continue
            for relation in ordered_relationships:
                if (
                    _status(relation.relationship) != RelationshipType.PROVISION_ADDRESSES_ISSUE.value
                    or relation.subject_id != provision.id
                ):
                    continue
                issue_ids = _relationship_issue_ids(relation.object_id, case_state.legalIssues)
                if issue_ids:
                    link_codes = () if relation.provenance else ("RELATIONSHIP_SOURCE_UNAVAILABLE",)
                    add_candidate(
                        procedure,
                        issue_ids,
                        (*_knowledge_refs(provision), *_relationship_refs(relation)),
                        link_codes,
                    )

    paths: list[PossibleProceduralPath] = []
    for (procedure_id, issue_ids), (procedure, link_refs, link_codes) in sorted(candidates.items()):
        codes = [*_knowledge_blockers(procedure, jurisdiction_status, mapped_jurisdiction), *link_codes]
        authority = records.get(procedure.authority or "")
        if not isinstance(authority, Authority):
            authority = None
            codes.append("AUTHORITY_RECORD_UNAVAILABLE")
        else:
            if authority.status != KnowledgeStatus.VERIFIED:
                codes.append("AUTHORITY_RECORD_NOT_VERIFIED")
            if not authority.provenance:
                codes.append("SOURCE_PROVENANCE_MISSING")
            if (
                mapped_jurisdiction is not None
                and authority.jurisdiction
                and authority.jurisdiction != mapped_jurisdiction.id
            ):
                codes.append("JURISDICTION_MISMATCH")

        codes.append("PROCEDURAL_AVAILABILITY_NOT_ESTABLISHED")
        refs: list[ReasoningProvenance] = [
            *_knowledge_refs(procedure), *link_refs, *_issue_refs(case_state, issue_ids), *jurisdiction_refs,
        ]
        if authority is not None:
            refs.extend(_knowledge_refs(authority))
        paths.append(PossibleProceduralPath(
            id=_stable_id("procedure_path", case_state.id, procedure_id, *issue_ids),
            procedure_record_id=procedure_id,
            title=procedure.title,
            steps=tuple(procedure.steps),
            authority_record_id=authority.id if authority else None,
            authority_title=authority.title if authority else None,
            status="verification_required",
            blocked_reason_codes=_unique_codes(codes),
            source_references=_unique_refs(refs),
            related_issue_ids=issue_ids,
        ))
    return tuple(sorted(paths, key=lambda item: (item.procedure_record_id, item.related_issue_ids, item.id)))


def _record_source_refs(
    case_state: CaseState,
    path: str,
    status: str,
    evidence_by_id: dict[str, EvidenceItem],
    source_ids: Iterable[str],
) -> tuple[ReasoningProvenance, ...]:
    refs: list[ReasoningProvenance] = [_case_ref(case_state, path, status)]
    for source_id in source_ids:
        evidence = evidence_by_id.get(source_id)
        if evidence is None:
            refs.append(ReasoningProvenance(
                source_type="unknown_source",
                source_id=source_id,
                source_path=f"evidence/{source_id}",
                status="unknown",
                details="A source ID is recorded, but the matching evidence item is absent.",
            ))
        else:
            refs.append(_evidence_ref(evidence))
    return _unique_refs(refs)


def _make_finding(kind: str, case_state: CaseState, text: str, record_id: str, refs: Iterable[ReasoningProvenance], issue_ids: tuple[str, ...] = (), codes: Iterable[str] = ()) -> Finding:
    return Finding(
        id=_stable_id(kind, case_state.id, record_id, text),
        text=text,
        source_references=_unique_refs(refs),
        related_issue_ids=issue_ids,
        reason_codes=_unique_codes(codes),
    )


def _dedupe_questions(items: Sequence[UnresolvedQuestion]) -> tuple[UnresolvedQuestion, ...]:
    seen: dict[str, UnresolvedQuestion] = {}
    for item in items:
        key = item.text.casefold()
        previous = seen.get(key)
        if previous:
            seen[key] = UnresolvedQuestion(
                id=min(previous.id, item.id),
                text=previous.text,
                source_references=_unique_refs((*previous.source_references, *item.source_references)),
                reason_codes=_unique_codes((*previous.reason_codes, *item.reason_codes)),
            )
        else:
            seen[key] = item
    return tuple(sorted(seen.values(), key=lambda item: (item.text.casefold(), item.id)))


def reason_about_case(
    case_state: CaseState,
    *,
    legal_knowledge_records: Sequence[KnowledgeItem] = (),
    procedure_records: Sequence[LegalProcedure] = (),
    authority_records: Sequence[Authority] = (),
    jurisdiction_records: Sequence[KnowledgeJurisdiction] = (),
    relationships: Sequence[KnowledgeRelationship] = (),
    unknowns: Sequence[str] = (),
    assumptions: Sequence[str] = (),
    conflicts: Sequence[str] = (),
) -> ReasoningResult:
    """Analyze recorded information without inventing legal rules or outcomes.

    Procedures are surfaced only when a supplied ``ISSUE_SUGGESTS_PROCEDURE``
    relationship explicitly connects them to a CaseState issue. Jurisdictional
    matching uses exact recorded country/state/district values. Every returned
    candidate stays ``verification_required``; applicability is not inferred.
    """

    if isinstance(unknowns, str) or isinstance(assumptions, str) or isinstance(conflicts, str):
        raise TypeError("unknowns, assumptions, and conflicts must be sequences of strings, not a string")
    legal_knowledge_records = tuple(legal_knowledge_records)
    procedure_records = tuple(procedure_records)
    authority_records = tuple(authority_records)
    jurisdiction_records = tuple(jurisdiction_records)
    relationships = tuple(relationships)
    unknowns = tuple(unknowns)
    assumptions = tuple(assumptions)
    conflicts = tuple(conflicts)
    _validate_inputs(
        case_state,
        legal_knowledge_records,
        procedure_records,
        authority_records,
        jurisdiction_records,
        relationships,
    )
    if any(not isinstance(value, str) for value in (*unknowns, *assumptions, *conflicts)):
        raise TypeError("unknowns, assumptions, and conflicts must contain strings")

    records = _merge_records(legal_knowledge_records, procedure_records, authority_records, jurisdiction_records)
    evidence_by_id = {item.id: item for item in case_state.evidence}
    jurisdiction_status, mapped_jurisdiction, jurisdiction_refs = _catalog_jurisdiction_match(case_state, jurisdiction_records)
    issue_ids = tuple(issue.id for issue in case_state.legalIssues)
    all_reason_codes: list[str] = []
    steps: list[ReasoningStep] = []
    supported: list[Finding] = []
    user_reported: list[Finding] = []
    gaps: list[EvidenceGap] = []
    conflict_items: list[Conflict] = []

    def add_gap(description: str, related_id: str | None, refs: Iterable[ReasoningProvenance], code: str = "EVIDENCE_NOT_LINKED") -> None:
        gap = EvidenceGap(
            id=_stable_id("evidence_gap", case_state.id, related_id or "", description),
            description=description,
            related_record_id=related_id,
            source_references=_unique_refs(refs),
            reason_codes=(code,),
        )
        gaps.append(gap)
        all_reason_codes.append(code)

    def add_conflict(description: str, record_ids: Iterable[str], refs: Iterable[ReasoningProvenance]) -> None:
        ids = tuple(sorted(set(record_ids)))
        item = Conflict(
            id=_stable_id("conflict", case_state.id, description, *ids),
            description=description,
            record_ids=ids,
            source_references=_unique_refs(refs),
            reason_codes=("CONFLICT_UNRESOLVED",),
        )
        conflict_items.append(item)
        all_reason_codes.append("CONFLICT_UNRESOLVED")

    # Case facts are elevated to supported findings only when a document/page
    # provenance reference itself is marked evidence-supported.
    for fact in sorted(case_state.facts, key=lambda item: item.id):
        path = f"facts/{fact.id}"
        linked_evidence = [evidence_by_id[source_id] for source_id in fact.sourceIds if source_id in evidence_by_id]
        refs = [
            ReasoningProvenance(
                source_type="document",
                source_id=source.documentId,
                source_path=f"documents/{source.documentId}/pages/{source.pageNumber}",
                status=source.status,
                confidence=source.confidence,
                page_number=source.pageNumber,
                details=source.extractionMethod,
            )
            for source in fact.provenance
        ]
        refs.extend(_record_source_refs(case_state, path, fact.status, evidence_by_id, fact.sourceIds))
        if fact.status == "conflicting":
            add_conflict(f"Fact '{fact.key}' is marked as conflicting.", (fact.id,), refs)
        elif fact.status == "evidence_supported":
            has_document_support = any(
                ref.source_type == "document" and ref.status == "evidence_supported"
                for ref in refs
            )
            has_explicit_conflict = any(
                evidence.status == "conflicting" or fact.id in evidence.conflictsWithClaimIds
                for evidence in linked_evidence
            )
            if has_explicit_conflict:
                add_conflict(
                    f"Evidence linked to fact '{fact.id}' is marked as conflicting.",
                    (fact.id, *(evidence.id for evidence in linked_evidence if evidence.status == "conflicting" or fact.id in evidence.conflictsWithClaimIds)),
                    refs,
                )
            elif has_document_support:
                supported.append(_make_finding(
                    "supported_finding", case_state, f"Recorded fact: {fact.key} = {fact.value}",
                    fact.id, refs,
                ))
            else:
                add_gap(f"Fact '{fact.key}' is marked evidence-supported but has no evidence-supported document/page provenance.", fact.id, refs)
        elif fact.status == "user_reported":
            user_reported.append(_make_finding(
                "user_reported_finding", case_state, f"User-reported fact: {fact.key} = {fact.value}",
                fact.id, refs, codes=("USER_REPORT_ONLY",),
            ))
            all_reason_codes.append("USER_REPORT_ONLY")

    if case_state.intent is not None and case_state.intent.objective.strip():
        objective = case_state.intent.objective.strip()
        objective_ref = _case_ref(
            case_state,
            "intent/objective",
            "user_reported",
            objective,
        )
        user_reported.append(_make_finding(
            "user_reported_objective",
            case_state,
            f"User-stated objective: {objective}",
            "intent/objective",
            (objective_ref,),
            codes=("USER_OBJECTIVE_RECORDED",),
        ))
        steps.append(ReasoningStep(
            id=_stable_id("reasoning_step", case_state.id, "user-objective", objective),
            text=f"The CaseState records the user's objective as: {objective}",
            reason_codes=("USER_OBJECTIVE_RECORDED",),
            source_references=(objective_ref,),
            related_issue_ids=issue_ids,
        ))
        all_reason_codes.append("USER_OBJECTIVE_RECORDED")

    # Claim status is authoritative for presentation. Supporting links do not
    # upgrade a user report into an established fact.
    for claim in sorted(case_state.claims, key=lambda item: item.id):
        refs = _record_source_refs(case_state, f"claims/{claim.id}", claim.status, evidence_by_id, claim.evidenceIds)
        linked = [evidence_by_id[source_id] for source_id in claim.evidenceIds if source_id in evidence_by_id]
        missing_ids = [source_id for source_id in claim.evidenceIds if source_id not in evidence_by_id]
        document_supported = [item for item in linked if item.source == "document" and item.status == "evidence_supported"]
        if claim.status == "user_reported":
            user_reported.append(_make_finding(
                "user_reported_finding", case_state, f"User-reported claim: {claim.text}",
                claim.id, refs, codes=("USER_REPORT_ONLY",),
            ))
            all_reason_codes.append("USER_REPORT_ONLY")
        elif claim.status == "evidence_supported":
            conflicting_links = [
                item for item in linked
                if item.status == "conflicting" or claim.id in item.conflictsWithClaimIds
            ]
            if conflicting_links:
                add_conflict(
                    f"Evidence linked to evidence-supported claim '{claim.id}' is marked as conflicting.",
                    (claim.id, *(item.id for item in conflicting_links)),
                    refs,
                )
            elif document_supported:
                supported.append(_make_finding(
                    "supported_finding", case_state, f"CaseState records as evidence-supported: {claim.text}",
                    claim.id, refs,
                ))
            else:
                add_gap(f"Claim '{claim.id}' is marked evidence-supported but has no linked evidence-supported document record.", claim.id, refs)
        elif claim.status == "conflicting":
            add_conflict(f"Claim '{claim.id}' is marked as conflicting: {claim.text}", (claim.id,), refs)
        elif claim.status in {"unknown", "assumption"}:
            all_reason_codes.append("ASSUMPTION_UNVERIFIED" if claim.status == "assumption" else "UNKNOWN_REMAINS_OPEN")
        if missing_ids:
            missing_refs = [
                ref for ref in refs if ref.source_type == "unknown_source"
            ]
            add_gap(f"Claim '{claim.id}' references evidence IDs missing from the CaseState: {', '.join(sorted(missing_ids))}.", claim.id, missing_refs, "EVIDENCE_SOURCE_MISSING")
        if claim.evidenceIds and not linked:
            add_gap(f"No referenced evidence record is available for claim '{claim.id}'.", claim.id, refs, "EVIDENCE_SOURCE_MISSING")

    for evidence in sorted(case_state.evidence, key=lambda item: item.id):
        refs = (_evidence_ref(evidence),)
        if evidence.status == "conflicting":
            add_conflict(f"Evidence '{evidence.title}' is marked as conflicting.", (evidence.id,), refs)
        for claim_id in sorted(evidence.conflictsWithClaimIds):
            claim = next((item for item in case_state.claims if item.id == claim_id), None)
            claim_refs = (_case_ref(case_state, f"claims/{claim_id}", claim.status, claim.text),) if claim else ()
            add_conflict(
                f"Evidence '{evidence.title}' is recorded as conflicting with claim '{claim_id}'.",
                (evidence.id, claim_id),
                (*refs, *claim_refs),
            )

    for event in sorted(case_state.events, key=lambda item: item.id):
        refs = _record_source_refs(case_state, f"events/{event.id}", "user_reported", evidence_by_id, event.evidenceIds)
        linked = [evidence_by_id[item_id] for item_id in event.evidenceIds if item_id in evidence_by_id]
        if any(item.source == "document" and item.status == "evidence_supported" for item in linked):
            supported.append(_make_finding(
                "supported_finding", case_state, f"Recorded event linked to document-backed evidence: {event.description}",
                event.id, refs,
            ))
        else:
            user_reported.append(_make_finding(
                "user_reported_finding", case_state, f"User-reported event: {event.description}",
                event.id, refs, codes=("USER_REPORT_ONLY",),
            ))
            all_reason_codes.append("USER_REPORT_ONLY")
        if not event.evidenceIds:
            add_gap(f"No evidence item is linked to recorded event '{event.id}'.", event.id, refs)

    explicit_conflicts = (
        *((description, _case_ref(case_state, f"conflicts/{index}", "conflicting", description))
          for index, description in enumerate(case_state.conflicts)),
        *((description, _input_ref(case_state, f"inputs/conflicts/{index}", "conflicting", description))
          for index, description in enumerate(conflicts)),
    )
    for description, provenance in explicit_conflicts:
        cleaned = " ".join(description.split()).strip()
        if cleaned:
            add_conflict(
                cleaned,
                (),
                (provenance,),
            )

    # Unresolved questions and assumptions retain their input classification.
    questions: list[UnresolvedQuestion] = []
    for source_name, entries, code, source_status in (
        ("unknowns", (("case_state", item) for item in case_state.unknowns), "UNKNOWN_REMAINS_OPEN", "unknown"),
        ("unknowns", (("reasoning_input", item) for item in unknowns), "UNKNOWN_REMAINS_OPEN", "unknown"),
        ("assumptions", (("case_state", item) for item in case_state.assumptions), "ASSUMPTION_UNVERIFIED", "assumption"),
        ("assumptions", (("reasoning_input", item) for item in assumptions), "ASSUMPTION_UNVERIFIED", "assumption"),
    ):
        for index, (origin, text) in enumerate(entries):
            cleaned = " ".join(text.split()).strip()
            if not cleaned:
                continue
            ref_factory = _case_ref if origin == "case_state" else _input_ref
            input_path = f"{source_name}/{index}" if origin == "case_state" else f"inputs/{source_name}/{index}"
            ref = ref_factory(case_state, input_path, source_status, cleaned)
            questions.append(UnresolvedQuestion(
                id=_stable_id("unresolved", case_state.id, source_name, cleaned),
                text=cleaned if source_name == "unknowns" else f"Verify assumption: {cleaned}",
                source_references=(ref,),
                reason_codes=(code,),
            ))
            all_reason_codes.append(code)
    questions_tuple = _dedupe_questions(questions)

    for claim in case_state.claims:
        if claim.status in {"user_reported", "assumption", "unknown"} and not claim.evidenceIds:
            add_gap(
                f"No evidence record is linked to {claim.status.replace('_', ' ')} claim '{claim.id}'.",
                claim.id,
                (_case_ref(case_state, f"claims/{claim.id}", claim.status, claim.text),),
            )

    legal_statements = _build_legal_statements(
        case_state, records, relationships, jurisdiction_status, mapped_jurisdiction,
    )
    paths = _build_paths(
        case_state, records, relationships, jurisdiction_status, mapped_jurisdiction, jurisdiction_refs,
    )

    steps.append(ReasoningStep(
        id=_stable_id("reasoning_step", case_state.id, "case-record-review"),
        text=(
            f"Reviewed {len(case_state.facts)} fact record(s), {len(case_state.claims)} claim record(s), "
            f"{len(case_state.evidence)} evidence record(s), and {len(case_state.legalIssues)} legal issue record(s)."
        ),
        reason_codes=("CASE_STATE_REVIEWED",),
        source_references=(_case_ref(case_state, "case_state", "recorded", "Canonical CaseState input."),),
        related_issue_ids=issue_ids,
    ))
    has_legal_knowledge = any(
        isinstance(item, (LegalProvision, LegalRule))
        for item in legal_knowledge_records
    )
    if not has_legal_knowledge:
        all_reason_codes.append("LEGAL_KNOWLEDGE_UNAVAILABLE")
        steps.append(ReasoningStep(
            id=_stable_id("reasoning_step", case_state.id, "no-legal-knowledge"),
            text="No legal provision or rule records were supplied; legal grounding is unavailable.",
            reason_codes=("LEGAL_KNOWLEDGE_UNAVAILABLE",),
            source_references=(_input_ref(case_state, "legal_knowledge_records", "unknown", "No provision or rule records supplied."),),
            related_issue_ids=issue_ids,
        ))
    elif not legal_statements:
        all_reason_codes.append("LEGAL_STATEMENT_LINK_MISSING")
        steps.append(ReasoningStep(
            id=_stable_id("reasoning_step", case_state.id, "knowledge-not-linked"),
            text="Supplied legal records do not include a source-linked provision-to-issue relationship that supports an issue-specific legal statement.",
            reason_codes=("LEGAL_STATEMENT_LINK_MISSING",),
            source_references=_unique_refs(ref for item in records.values() for ref in _knowledge_refs(item)),
            related_issue_ids=issue_ids,
        ))
    else:
        for statement in legal_statements:
            steps.append(ReasoningStep(
                id=_stable_id("reasoning_step", case_state.id, "source-statement", statement.record_id, *statement.related_issue_ids),
                text=f"Supplied source record '{statement.record_title}' states: {statement.text}",
                reason_codes=_unique_codes((*statement.reason_codes, "RULE_APPLICATION_NOT_PERFORMED")),
                source_references=statement.source_references,
                related_issue_ids=statement.related_issue_ids,
            ))

    if jurisdiction_status == "unknown":
        all_reason_codes.append("JURISDICTION_UNKNOWN")
        steps.append(ReasoningStep(
            id=_stable_id("reasoning_step", case_state.id, "jurisdiction-unknown"),
            text="Jurisdiction-specific conclusions are blocked because the CaseState has no established jurisdiction.",
            reason_codes=("JURISDICTION_UNKNOWN",),
            source_references=jurisdiction_refs,
            related_issue_ids=issue_ids,
        ))
    elif jurisdiction_status != "mapped":
        code = {
            "unmapped": "JURISDICTION_RECORD_UNMAPPED",
            "ambiguous": "JURISDICTION_RECORD_AMBIGUOUS",
            "catalog_unverified": "JURISDICTION_RECORD_NOT_VERIFIED",
            "catalog_source_missing": "JURISDICTION_RECORD_SOURCE_MISSING",
        }[jurisdiction_status]
        all_reason_codes.append(code)
        steps.append(ReasoningStep(
            id=_stable_id("reasoning_step", case_state.id, "jurisdiction-unmapped"),
            text="The recorded location could not be uniquely matched to the supplied legal jurisdiction catalog; jurisdiction-specific conclusions are blocked.",
            reason_codes=(code,),
            source_references=jurisdiction_refs,
            related_issue_ids=issue_ids,
        ))

    if case_state.legalIssues and not paths:
        all_reason_codes.append("PROCEDURE_ISSUE_LINK_MISSING")
        steps.append(ReasoningStep(
            id=_stable_id("reasoning_step", case_state.id, "procedure-link-missing"),
            text="No supplied relationship explicitly connects a recorded legal issue to a procedure record; no procedural path was inferred.",
            reason_codes=("PROCEDURE_ISSUE_LINK_MISSING",),
            source_references=(_case_ref(case_state, "legalIssues", "system_inferred", "No explicit linked procedure record was found."),),
            related_issue_ids=issue_ids,
        ))
    for path in paths:
        steps.append(ReasoningStep(
            id=_stable_id("reasoning_step", case_state.id, "procedure-candidate", path.procedure_record_id, *path.related_issue_ids),
            text=f"Procedure record '{path.title}' is explicitly linked to a recorded issue and is listed as a verification-required candidate.",
            reason_codes=path.blocked_reason_codes,
            source_references=path.source_references,
            related_issue_ids=path.related_issue_ids,
        ))

    # These are explicit engine limits rather than legal conclusions.
    blocked: list[BlockedConclusion] = [BlockedConclusion(
        id=_stable_id("blocked", case_state.id, "rule-application"),
        subject="legal_applicability_or_entitlement",
        explanation="Whether a legal rule applies, or whether any person has a legal entitlement or liability, is not determined from these records.",
        reason_codes=("RULE_APPLICATION_NOT_PERFORMED",),
        source_references=(_case_ref(case_state, "legalIssues", "recorded", "Application criteria and findings are not evaluated by this engine."),),
    ), BlockedConclusion(
        id=_stable_id("blocked", case_state.id, "court-outcome"),
        subject="court_or_decision_maker_outcome",
        explanation="No court or decision-maker outcome is predicted.",
        reason_codes=("COURT_OUTCOME_NOT_PREDICTED",),
        source_references=(_case_ref(case_state, "case_state", "recorded", "Outcome prediction is outside this engine's scope."),),
    )]
    if not has_legal_knowledge:
        blocked.append(BlockedConclusion(
            id=_stable_id("blocked", case_state.id, "legal-knowledge"),
            subject="jurisdiction_specific_legal_grounding",
            explanation="Insufficient or unavailable legal grounding: no usable provision or rule records were supplied.",
            reason_codes=("LEGAL_KNOWLEDGE_UNAVAILABLE",),
            source_references=(_input_ref(case_state, "legal_knowledge_records", "unknown", "No provision or rule records supplied."),),
        ))
    if jurisdiction_status != "mapped":
        jurisdiction_code = {
            "unknown": "JURISDICTION_UNKNOWN",
            "unmapped": "JURISDICTION_RECORD_UNMAPPED",
            "ambiguous": "JURISDICTION_RECORD_AMBIGUOUS",
            "catalog_unverified": "JURISDICTION_RECORD_NOT_VERIFIED",
            "catalog_source_missing": "JURISDICTION_RECORD_SOURCE_MISSING",
        }[jurisdiction_status]
        blocked.append(BlockedConclusion(
            id=_stable_id("blocked", case_state.id, "jurisdiction-specific"),
            subject="jurisdiction_specific_conclusion",
            explanation="A jurisdiction-specific legal conclusion is blocked until the recorded location is established and mapped to the supplied legal jurisdiction records.",
            reason_codes=(jurisdiction_code,),
            source_references=jurisdiction_refs,
        ))

    # Conflicts are preserved as separate records. Never collapse or select a
    # winning account based on source type or record order.
    unique_conflicts: dict[str, Conflict] = {}
    for item in conflict_items:
        key = item.description.casefold()
        if key in unique_conflicts:
            previous = unique_conflicts[key]
            unique_conflicts[key] = Conflict(
                id=min(previous.id, item.id),
                description=previous.description,
                record_ids=tuple(sorted(set((*previous.record_ids, *item.record_ids)))),
                source_references=_unique_refs((*previous.source_references, *item.source_references)),
                reason_codes=("CONFLICT_UNRESOLVED",),
            )
        else:
            unique_conflicts[key] = item
    conflict_result = tuple(sorted(unique_conflicts.values(), key=lambda item: (item.description.casefold(), item.id)))

    if conflict_result:
        refs = _unique_refs(ref for item in conflict_result for ref in item.source_references)
        risks = [ReasoningRisk(
            id=_stable_id("risk", case_state.id, "unresolved-conflict"),
            description="Conflicting accounts remain unresolved; affected information may not be safe to rely on until the source records are reviewed.",
            severity="undetermined",
            source_references=refs,
            reason_codes=("CONFLICT_UNRESOLVED",),
        )]
    else:
        risks = []
    if gaps:
        risks.append(ReasoningRisk(
            id=_stable_id("risk", case_state.id, "evidence-gaps"),
            description="One or more recorded items lack linked document-backed evidence or source details.",
            severity="undetermined",
            source_references=_unique_refs(ref for item in gaps for ref in item.source_references),
            reason_codes=("EVIDENCE_NOT_LINKED",),
        ))
    if jurisdiction_status != "mapped":
        risks.append(ReasoningRisk(
            id=_stable_id("risk", case_state.id, "jurisdiction-uncertainty"),
            description="Procedural information may not fit the case until the jurisdiction is established and matched to a legal jurisdiction record.",
            severity="undetermined",
            source_references=jurisdiction_refs,
            reason_codes=({
                "unknown": "JURISDICTION_UNKNOWN",
                "unmapped": "JURISDICTION_RECORD_UNMAPPED",
                "ambiguous": "JURISDICTION_RECORD_AMBIGUOUS",
                "catalog_unverified": "JURISDICTION_RECORD_NOT_VERIFIED",
                "catalog_source_missing": "JURISDICTION_RECORD_SOURCE_MISSING",
            }[jurisdiction_status],),
        ))

    if not has_legal_knowledge:
        risks.append(ReasoningRisk(
            id=_stable_id("risk", case_state.id, "legal-grounding-unavailable"),
            description="Legal knowledge is unavailable for this analysis, so legal grounding cannot be checked.",
            severity="undetermined",
            source_references=(_input_ref(case_state, "legal_knowledge_records", "unknown", "No provision or rule records supplied."),),
            reason_codes=("LEGAL_KNOWLEDGE_UNAVAILABLE",),
        ))

    has_grounded_record = any(
        not (set(item.reason_codes) - {"RULE_APPLICATION_NOT_PERFORMED"})
        for item in legal_statements
    ) or any(
        set(path.blocked_reason_codes) == {"PROCEDURAL_AVAILABILITY_NOT_ESTABLISHED"}
        for path in paths
    )
    if not has_legal_knowledge:
        legal_knowledge_status = "unavailable"
    elif has_grounded_record:
        legal_knowledge_status = "source_grounded_records_present"
    elif legal_statements or paths:
        legal_knowledge_status = "insufficient_or_blocked"
    else:
        legal_knowledge_status = "records_present_but_not_linked"

    if not has_legal_knowledge or jurisdiction_status != "mapped" or conflict_result:
        uncertainty_level = "high"
    elif not has_grounded_record or legal_knowledge_status != "source_grounded_records_present":
        uncertainty_level = "high"
    else:
        uncertainty_level = "moderate"
    uncertainty_code_values = ["RULE_APPLICATION_NOT_PERFORMED", "COURT_OUTCOME_NOT_PREDICTED"]
    if not has_legal_knowledge:
        uncertainty_code_values.append("LEGAL_KNOWLEDGE_UNAVAILABLE")
    if jurisdiction_status != "mapped":
        uncertainty_code_values.append({
            "unknown": "JURISDICTION_UNKNOWN",
            "unmapped": "JURISDICTION_RECORD_UNMAPPED",
            "ambiguous": "JURISDICTION_RECORD_AMBIGUOUS",
            "catalog_unverified": "JURISDICTION_RECORD_NOT_VERIFIED",
            "catalog_source_missing": "JURISDICTION_RECORD_SOURCE_MISSING",
        }[jurisdiction_status])
    if conflict_result:
        uncertainty_code_values.append("CONFLICT_UNRESOLVED")
    uncertainty_codes = _unique_codes(uncertainty_code_values)

    unique_gaps: dict[str, EvidenceGap] = {}
    for item in gaps:
        key = (item.related_record_id or "") + "\x1f" + item.description.casefold()
        unique_gaps[key] = item
    gap_result = tuple(sorted(unique_gaps.values(), key=lambda item: (item.related_record_id or "", item.description.casefold(), item.id)))

    return ReasoningResult(
        case_id=case_state.id,
        jurisdiction_status=jurisdiction_status,
        legal_knowledge_status=legal_knowledge_status,
        reasoning_steps=tuple(sorted(steps, key=lambda item: (item.id, item.text))),
        grounded_legal_statements=legal_statements,
        supported_findings=tuple(sorted(supported, key=lambda item: (item.id, item.text))),
        user_reported_findings=tuple(sorted(user_reported, key=lambda item: (item.id, item.text))),
        unresolved_questions=questions_tuple,
        evidence_gaps=gap_result,
        conflicts=conflict_result,
        risks=tuple(sorted(risks, key=lambda item: (item.id, item.description))),
        possible_procedural_paths=paths,
        blocked_conclusions=tuple(sorted(blocked, key=lambda item: (item.subject, item.id))),
        uncertainty=UncertaintyAssessment(
            level=uncertainty_level,
            confidence=None,
            confidence_status="not_scored",
            reason_codes=uncertainty_codes,
            source_references=_unique_refs((
                *jurisdiction_refs,
                *(_input_ref(case_state, "legal_knowledge_records", "unknown", "No usable provision or rule records supplied."),),
                *(ref for item in legal_statements for ref in item.source_references),
                *(ref for item in paths for ref in item.source_references),
                *(ref for item in conflict_result for ref in item.source_references),
            )),
        ),
        reason_codes=_unique_codes((*all_reason_codes, "RULE_APPLICATION_NOT_PERFORMED", "COURT_OUTCOME_NOT_PREDICTED")),
        user_objective=case_state.intent.objective if case_state.intent is not None else None,
    )
