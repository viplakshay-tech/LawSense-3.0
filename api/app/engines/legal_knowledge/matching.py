"""Transparent, deterministic law-candidate matching over recorded case facts.

Qualitative assessments describe the available recorded evidence; they are not
probabilities or findings of legal applicability. Candidate retrieval comes
from existing issue-linked local knowledge records; the matcher never creates
citations or source URLs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable

from app.engines.legal_knowledge.models import (
    Authority,
    Jurisdiction as KnowledgeJurisdiction,
    KnowledgeItem,
    LegalDocument,
    LegalProcedure,
    LegalProvision,
    LegalSource,
    SourceAuthorityTier,
)
from app.engines.legal_sources.governance_models import GovernedLegalSource
from app.schemas.case_state import CaseState


_CATEGORY_FACT_CUES: dict[str, tuple[str, ...]] = {
    "consumer": ("bought", "purchase", "product", "goods", "defect", "defective", "seller", "refund", "replacement", "repair", "warranty", "receipt"),
    "housing": ("landlord", "tenant", "rent", "rented", "lease", "deposit", "premises", "house", "flat", "eviction"),
    # Keep this provision category tied to pay/termination facts. Generic role terms
    # also occur in harassment reports and must not surface wage law on their own.
    "employment": ("salary", "wage", "pay", "unpaid", "overtime", "resigned", "dismissed", "terminated"),
    "workplace_harassment": ("workplace", "sexual", "harassment", "harassed", "touch", "comment", "supervisor", "boss", "committee"),
    "family": ("husband", "wife", "spouse", "domestic", "marriage", "household", "abuse", "maintenance", "violence"),
    "dowry_related_harassment": ("dowry", "demand", "husband", "in-laws", "violence", "harassment"),
}
_MISSING_QUESTIONS: dict[str, tuple[str, ...]] = {
    "consumer": (
        "When and where was the product or service purchased, and what proof of purchase is available?",
        "What repair, replacement, or refund did you request, and how did the seller respond?",
    ),
    "housing": (
        "Which State or Union Territory is the property in, and was there a written rental agreement?",
        "How much deposit was paid, when was possession returned, and what reason was given for withholding it?",
    ),
    "employment": (
        "Where was the work performed, and what was the employment or contractor relationship?",
        "Which wage period and amount are unpaid, and when was payment due?",
    ),
    "workplace_harassment": (
        "What kind of workplace was involved, about how many workers does it have, and is an Internal Committee available?",
        "Has a written complaint been made, and was it against the employer?",
    ),
    "family": (
        "What is the relationship between the people involved, and where did the events occur?",
        "Which conduct and dates should be considered, and is anyone in immediate danger?",
    ),
    "dowry_related_harassment": (
        "What relationship exists between the people involved, and what specific demand or conduct occurred?",
        "When and where did the events occur, and is anyone in immediate danger?",
    ),
}
@dataclass(frozen=True, slots=True)
class MatchFact:
    text: str
    source_id: str
    status: str


def build_law_matches(
    case_state: CaseState,
    records: Iterable[KnowledgeItem],
    governed_sources: Iterable[GovernedLegalSource] = (),
) -> list[dict[str, Any]]:
    """Build all issue-relevant provision candidates with explicit limitations."""

    record_list = tuple(records)
    provisions = [item for item in record_list if isinstance(item, LegalProvision)]
    if not provisions:
        return []
    documents = {
        item.source: item for item in record_list if isinstance(item, LegalDocument)
    }
    sources = {item.id: item for item in record_list if isinstance(item, LegalSource)}
    authorities = {item.id: item for item in record_list if isinstance(item, Authority)}
    jurisdictions = {
        item.id: item for item in record_list if isinstance(item, KnowledgeJurisdiction)
    }
    governance = {item.source_id: item for item in governed_sources}
    issue_categories = {issue.category.casefold() for issue in case_state.legalIssues}
    if not issue_categories:
        return []

    facts = _case_facts(case_state)
    result: list[dict[str, Any]] = []
    for provision in provisions:
        category = _provision_issue_category(provision, issue_categories)
        if not category:
            continue
        cues = _CATEGORY_FACT_CUES.get(category, ())
        nonconflicting_text = " ".join(
            item.text for item in facts if item.status != "conflicting"
        ).casefold()
        matched_cues = tuple(cue for cue in cues if cue in nonconflicting_text)
        if not matched_cues:
            # An issue label alone is too broad to connect a specific provision
            # to reported facts. Keep the source in the catalog, but don't surface
            # it as a case candidate without a matching fact cue.
            continue
        supporting_facts = [
            {"text": item.text, "source_id": item.source_id, "status": item.status}
            for item in facts
            if any(cue in item.text.casefold() for cue in matched_cues)
        ]
        issues = [issue for issue in case_state.legalIssues if issue.category.casefold() == category]
        doc = documents.get(provision.source or "")
        law_source = sources.get(provision.source or "")
        governed = governance.get(provision.source or "")
        jurisdiction = jurisdictions.get(provision.jurisdiction or "")
        linked_procedures = [
            item for item in record_list
            if isinstance(item, LegalProcedure) and provision.id in item.related_provision_ids
        ]

        jurisdiction_class, jurisdiction_match, jurisdiction_limit = _jurisdiction(
            case_state, jurisdiction
        )
        temporal_limit, incident_temporal_status = _temporal_limit(case_state, provision)
        verification_status = (
            governed.verification_status.value if governed is not None else "unverified"
        )
        conflict_present = any(item.status == "conflicting" for item in facts)
        fact_statuses = {item["status"] for item in supporting_facts}
        if (
            "evidence_supported" in fact_statuses
            and verification_status == "verified"
            and jurisdiction_match == "matched"
            and incident_temporal_status == "supported"
            and not conflict_present
        ):
            evidence_assessment = "supported"
        elif matched_cues and verification_status == "verified" and jurisdiction_match != "mismatch":
            evidence_assessment = "plausible"
        else:
            evidence_assessment = "unclear"
        assessment_factors = {
            "issue_fit": "explicit_issue_category_match" if issues else "not_established",
            "fact_support": ",".join(sorted(fact_statuses)) if fact_statuses else "no_matching_recorded_fact",
            "topic_terms_found": ",".join(matched_cues) if matched_cues else "none",
            "conflicting_evidence": "present" if conflict_present else "none_recorded",
            "jurisdiction": jurisdiction_match,
            "temporal_applicability": incident_temporal_status,
            "source_verification": verification_status,
            "source_freshness": governed.freshness_status.value if governed else "unknown",
        }
        assessment_rationale = [
            "This candidate was retrieved for a recorded legal-issue category; issue classification alone does not establish applicability.",
            "Matching details are user-reported or evidence-supported as labelled; the matcher does not treat them as proven legal elements.",
            jurisdiction_limit,
            temporal_limit,
            (
                "Source identity has a verified catalog record."
                if verification_status == "verified"
                else "Source verification is not established in the local catalog."
            ),
        ]
        if conflict_present:
            assessment_rationale.append("Conflicting information is recorded and remains unresolved.")
        if not matched_cues:
            assessment_rationale.append("No issue-specific factual cue was found in the recorded facts.")
        missing_facts = _candidate_questions(
            category,
            facts,
            jurisdiction_match,
            incident_temporal_status,
            conflict_present,
        )

        limitations = [jurisdiction_limit, temporal_limit]
        if governed is not None and governed.freshness_status.value == "unknown":
            limitations.append("Source freshness has not been independently assessed.")
        limitations.append("A candidate match is not a determination that the provision applies.")
        procedure_summary = _procedure_guidance(
            linked_procedures,
            authorities,
            sources,
            governance,
        )
        supporting_sources = _supporting_source_summaries(provision, sources, governance)
        official_source_links = [
            {
                "title": source_item["title"],
                "url": source_item["official_source_url"],
                "kind": "verified_official_publication",
            }
            for source_item in supporting_sources
            if source_item["official_source_url"]
        ]
        result.append({
            "candidate_id": provision.id,
            "related_issue_ids": [issue.id for issue in issues],
            "act_title": doc.title if doc else law_source.title if law_source else provision.title,
            "provision_title": provision.title,
            "provision_reference": provision.provision_reference,
            "act_version": law_source.version if law_source else provision.version,
            "effective_from": provision.effective_from.isoformat() if provision.effective_from else None,
            "effective_to": provision.effective_to.isoformat() if provision.effective_to else None,
            "why_it_may_apply": _why_may_apply(category, matched_cues, issues),
            "evidence_assessment": evidence_assessment,
            "assessment_factors": assessment_factors,
            "assessment_rationale": assessment_rationale,
            "supporting_facts": supporting_facts,
            "missing_facts": _unique(missing_facts),
            "clarifying_questions": _unique(missing_facts),
            "conflicting_evidence": [item.text for item in facts if item.status == "conflicting"],
            "jurisdiction": {
                "classification": jurisdiction_class,
                "match_status": jurisdiction_match,
                "label": ", ".join(filter(None, (
                    jurisdiction.country if jurisdiction else None,
                    jurisdiction.state if jurisdiction else None,
                    jurisdiction.district if jurisdiction else None,
                ))) or (jurisdiction.title if jurisdiction else "Unknown jurisdiction"),
                "limitation": jurisdiction_limit,
            },
            "temporal_limitation": temporal_limit,
            "limitations": _unique(limitations),
            **procedure_summary,
            "official_source_links": official_source_links,
            "source": {
                "title": law_source.title if law_source else None,
                "url": law_source.source_url if law_source else provision.source_url,
                "version": law_source.version if law_source else provision.version,
                "effective_from": provision.effective_from.isoformat() if provision.effective_from else None,
                "effective_to": provision.effective_to.isoformat() if provision.effective_to else None,
                "verification_status": verification_status,
                "freshness_status": governed.freshness_status.value if governed else "unknown",
                "applicability_status": governed.applicability_status.value if governed else "applicability_not_established",
                "retrieved_at": (law_source.retrieved_at.isoformat() if law_source and law_source.retrieved_at else provision.retrieved_at.isoformat() if provision.retrieved_at else None),
                "provision_reference": provision.provision_reference,
                "provenance": [
                    {
                        "source_id": ref.source_id,
                        "provision_id": ref.provision_id,
                        "page_section_reference": ref.page_section_reference,
                        "retrieval_time": ref.retrieval_time.isoformat(),
                        "source_url": ref.source_url,
                    }
                    for ref in provision.provenance
                ],
                "supporting_sources": supporting_sources,
            },
            "notice": "This is a heuristic candidate for discussion, not a definitive legal opinion. Confirm current law and applicability with an advocate or legal-aid service.",
        })
    return sorted(
        result,
        key=lambda item: (
            {"supported": 0, "plausible": 1, "unclear": 2}[item["evidence_assessment"]],
            item["candidate_id"],
        ),
    )


def _case_facts(case_state: CaseState) -> tuple[MatchFact, ...]:
    facts: list[MatchFact] = []
    if case_state.initialStatement and case_state.initialStatement.strip():
        facts.append(MatchFact(case_state.initialStatement.strip(), case_state.id, "user_reported"))
    for fact in case_state.facts:
        if fact.status not in {"user_reported", "evidence_supported", "conflicting"}:
            continue
        text = f"{fact.key}: {_plain_value(fact.value)}"
        if text.strip():
            facts.append(MatchFact(text, fact.id, str(fact.status)))
    for event in case_state.events:
        text = event.description.strip()
        if text:
            facts.append(MatchFact(text, event.id, "user_reported"))
    for claim in case_state.claims:
        if claim.status in {"user_reported", "evidence_supported", "conflicting"} and claim.text.strip():
            facts.append(MatchFact(claim.text.strip(), claim.id, str(claim.status)))
    for index, conflict in enumerate(case_state.conflicts):
        if conflict.strip():
            facts.append(MatchFact(conflict.strip(), f"{case_state.id}:conflicts/{index}", "conflicting"))
    return tuple(facts)


def _candidate_questions(
    category: str,
    facts: tuple[MatchFact, ...],
    jurisdiction_match: str,
    temporal_status: str,
    conflict_present: bool,
) -> list[str]:
    """Return only a few unanswered facts that could change this candidate."""
    text = " ".join(item.text for item in facts if item.status != "conflicting").casefold()
    questions: list[str] = []
    if conflict_present:
        questions.append("Which account is accurate, or what evidence can help resolve the conflicting details?")
    if jurisdiction_match != "matched":
        questions.append("Which country and, if relevant, State or Union Territory did the events occur in?")
    if temporal_status in {"unknown", "uncertain"} and not any(
        term in text for term in ("on 20", "on 19", "in 20", "in 19", "202", "last year", "last month")
    ):
        questions.append("When did the relevant events happen? An exact date or date range may change the version of law to check.")

    for question in _MISSING_QUESTIONS.get(category, ()):
        normalized = question.casefold()
        if category == "consumer" and "proof of purchase" in normalized:
            answered = any(term in text for term in ("receipt", "invoice", "proof of purchase"))
        elif category == "consumer" and "seller respond" in normalized:
            answered = "refund" in text and any(term in text for term in ("seller", "refused", "denied", "rejected"))
        elif category == "housing" and "state or union territory" in normalized:
            answered = any(term in text for term in ("uttarakhand", "state", "union territory"))
        elif category == "housing" and "how much deposit" in normalized:
            answered = any(term in text for term in ("deposit of", "deposit was", "deposit amount", "return reason"))
        elif category == "employment" and "where was the work" in normalized:
            answered = any(term in text for term in ("in delhi", "in mumbai", "in india", "work location", "at the office"))
        elif category == "employment" and "which wage period" in normalized:
            answered = any(term in text for term in ("per month", "monthly", "weekly", "fortnight", "due on"))
        elif category == "workplace_harassment" and "how many workers" in normalized:
            answered = bool(re.search(
                r"\b(?:employs?|headcount(?:\s+is)?|has)\s+(?:at\s+least\s+)?(?:\d+|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:employees|workers)\b",
                text,
            ))
        else:
            answered = False
        if not answered:
            questions.append(question)
    return _unique(questions)[:3]


def _plain_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        return "; ".join(f"{key}: {_plain_value(item)}" for key, item in value.items())
    if isinstance(value, (list, tuple)):
        return "; ".join(_plain_value(item) for item in value)
    return str(value)


def _provision_issue_category(provision: LegalProvision, issue_categories: set[str]) -> str | None:
    searchable = f"{provision.search_text} {provision.title}".casefold()
    # Prefer a specific issue when a provision's search text also contains a
    # broad neighboring term such as "employment".
    ordered_categories = sorted(
        issue_categories,
        key=lambda category: (
            category not in {"workplace_harassment", "dowry_related_harassment"},
            category,
        ),
    )
    for category in ordered_categories:
        if category in searchable or category.replace("_", " ") in searchable:
            return category
        if category in _CATEGORY_FACT_CUES and any(cue in searchable for cue in _CATEGORY_FACT_CUES[category]):
            return category
    return None


def _jurisdiction(
    case_state: CaseState,
    jurisdiction: KnowledgeJurisdiction | None,
) -> tuple[str, str, str]:
    if jurisdiction is None:
        return "unknown", "unknown", "The source jurisdiction could not be resolved from the local catalog."
    scope = "state_or_ut" if jurisdiction.state else "central" if jurisdiction.country else "unknown"
    case_country = (case_state.jurisdiction.country or "").strip().casefold()
    case_state_name = (case_state.jurisdiction.state or "").strip().casefold()
    basis = case_state.jurisdiction.basis
    if basis not in {"user_reported", "document"} or not case_country:
        return scope, "unknown", "Case location is unknown or inferred; territorial applicability needs confirmation."
    source_country = (jurisdiction.country or "").strip().casefold()
    if source_country and case_country not in {source_country, "in"}:
        return scope, "mismatch", "The recorded country differs from the source jurisdiction."
    if jurisdiction.state:
        if not case_state_name:
            return scope, "unknown", "This source is State/UT-specific, but the case State or Union Territory is unknown."
        if case_state_name != jurisdiction.state.strip().casefold():
            return scope, "mismatch", "The recorded State/UT differs from this State-specific source."
    return scope, "matched", "Territorial label matches the recorded location; subject-matter and venue applicability remain to be checked."


def _temporal_limit(case_state: CaseState, provision: LegalProvision) -> tuple[str, str]:
    effective = provision.effective_from
    end = provision.effective_to
    event_dates = [
        parsed
        for event in case_state.events
        if event.date and event.datePrecision == "exact"
        if (parsed := _parse_date(event.date)) is not None
    ]
    code_on_wages_transition = (
        provision.source == "source-india-code-code-on-wages-2019"
        and any(
            reference.source_id == "source-gazette-code-on-wages-commencement-2025"
            for reference in provision.provenance
        )
    )
    transition_note = (
        " The linked Gazette notification S.O. 5322(E) records commencement of the Code on Wages, 2019 from 21 November 2025; section 69 repeals the Payment of Wages Act, 1936 subject to transition and savings. The incident date and any savings issue must be checked before choosing the governing version."
        if code_on_wages_transition else ""
    )
    if effective is None:
        return "The provision record does not state an effective or commencement date; verify the applicable version and Gazette notifications.", "unknown"
    if event_dates and any(item < effective for item in event_dates):
        return f"At least one recorded event date is before the recorded effective date ({effective.isoformat()}); historical version review is needed.{transition_note}", "uncertain"
    if end and event_dates and any(item > end for item in event_dates):
        return f"At least one recorded event date is after the recorded end date ({end.isoformat()}); current validity needs review.{transition_note}", "uncertain"
    if event_dates:
        return f"Recorded event dates are not earlier than the record's effective date ({effective.isoformat()}); amendments and commencement still need official verification.{transition_note}", "supported"
    return f"The record lists effective date {effective.isoformat()}, but exact event dates are unavailable and amendment history is not checked here.{transition_note}", "unknown"


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            return None


def _why_may_apply(category: str, cues: tuple[str, ...], issues: list[Any]) -> str:
    issue_rationale = [str(value) for issue in issues for value in issue.rationale if value]
    parts = [f"The recorded issue category is {category.replace('_', ' ')}."]
    if cues:
        parts.append("The user's record contains these matching topic terms: " + ", ".join(cues) + ".")
    if issue_rationale:
        parts.append("The case classifier recorded: " + "; ".join(issue_rationale[:2]))
    return " ".join(parts)


def _procedure_guidance(
    procedures: list[LegalProcedure],
    authorities: dict[str, Authority],
    sources: dict[str, LegalSource],
    governance: dict[str, GovernedLegalSource],
) -> dict[str, Any]:
    """Expose only explicit linked steps, authorities, forms, docs, or dates."""
    procedure_items: list[dict[str, Any]] = []
    authority_items: list[dict[str, Any]] = []
    required_documents: list[str] = []
    deadlines: list[dict[str, str]] = []
    filing_links: list[dict[str, str]] = []
    for procedure in procedures:
        source = sources.get(procedure.source or "")
        governed = governance.get(procedure.source or "")
        verified = bool(
            procedure.status.value == "verified"
            and governed is not None
            and governed.verification_status.value == "verified"
        )
        procedure_items.append({
            "id": procedure.id,
            "title": procedure.title,
            "steps": list(procedure.steps),
            "jurisdiction": procedure.jurisdiction,
            "verification_status": "verified" if verified else "unverified",
            "source_url": procedure.source_url,
        })
        authority = authorities.get(procedure.authority or "")
        if authority is not None:
            authority_items.append({
                "name": authority.title,
                "authority_type": authority.authority_type,
                "verification_status": "verified" if verified and authority.status.value == "verified" else "unverified",
                "source_url": authority.source_url,
            })
        for field in ("required_documents", "requiredDocuments", "required_document_names", "requiredDocumentNames"):
            value = getattr(procedure, field, None)
            if verified and isinstance(value, (list, tuple)):
                required_documents.extend(str(item) for item in value if str(item).strip())
        for field in ("deadline", "filing_deadline", "filingDeadline", "time_limit", "timeLimit"):
            value = getattr(procedure, field, None)
            if isinstance(value, str) and value.strip() and verified:
                deadlines.append({"text": value, "source_url": procedure.source_url or ""})
        # A verified Act publication is not a filing form. Filing links must
        # be explicit URLs recorded on the linked procedure itself.
        source_url = _verified_procedure_url(procedure, verified)
        if source_url:
            filing_links.append({
                "title": procedure.title,
                "url": source_url,
                "kind": "verified_official_procedure_source",
            })

    # The Act's official publication is useful for checking the rule itself,
    # but it is never described as a filing or complaint form.
    return {
        "competent_authority": {
            "status": "recorded" if authority_items else "not_found_in_linked_procedure_records",
            "items": authority_items,
        },
        "procedures": {
            "status": (
                "recorded_verified" if any(item["verification_status"] == "verified" for item in procedure_items)
                else "recorded_unverified" if procedure_items
                else "not_found_in_linked_procedure_records"
            ),
            "items": procedure_items,
        },
        "required_documents": {
            "status": "recorded" if required_documents else "not_recorded_in_linked_procedure_records",
            "items": _unique(required_documents),
        },
        "verified_deadlines": {
            "status": "recorded" if deadlines else "not_found_in_verified_procedure_records",
            "items": deadlines,
        },
        "official_filing_links": {
            "status": "recorded_verified" if filing_links else "not_found_in_verified_procedure_records",
            "items": filing_links,
        },
    }


def _supporting_source_summaries(
    provision: LegalProvision,
    sources: dict[str, LegalSource],
    governance: dict[str, GovernedLegalSource],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for reference in provision.provenance:
        if reference.source_id in seen:
            continue
        seen.add(reference.source_id)
        source = sources.get(reference.source_id)
        governed = governance.get(reference.source_id)
        verified = bool(
            source is not None
            and governed is not None
            and source.status.value == "verified"
            and governed.verification_status.value == "verified"
        )
        official_url = _verified_official_url(source, governed) if verified else None
        items.append({
            "source_id": reference.source_id,
            "title": source.title if source else None,
            "source_type": governed.source_type if governed else None,
            "url": reference.source_url or (source.source_url if source else None),
            "official_source_url": official_url,
            "verification_status": "verified" if verified else "unverified",
            "freshness_status": governed.freshness_status.value if governed else "unknown",
            "retrieved_at": reference.retrieval_time.isoformat(),
            "reference": reference.page_section_reference,
        })
    return items


def _verified_official_url(
    source: LegalSource | None,
    governed: GovernedLegalSource | None,
) -> str | None:
    if (
        source is None
        or governed is None
        or source.status.value != "verified"
        or governed.verification_status.value != "verified"
        or source.authority_tier not in {
            SourceAuthorityTier.TIER_1_PRIMARY_OFFICIAL,
            SourceAuthorityTier.TIER_2_OFFICIAL_INSTITUTIONAL,
        }
    ):
        return None
    value = source.source_url
    if not value:
        return None
    from urllib.parse import urlsplit

    parsed = urlsplit(value)
    host = (parsed.hostname or "").casefold().removeprefix("www.")
    if parsed.scheme not in {"http", "https"} or host not in {
        "indiacode.gov.in", "indiacode.nic.in", "egazette.gov.in", "egazette.nic.in", "nalsa.gov.in",
        "112.gov.in", "gov.in", "nic.in",
    }:
        return None
    return value


def _verified_procedure_url(procedure: LegalProcedure, verified: bool) -> str | None:
    if not verified or not procedure.source_url:
        return None
    from urllib.parse import urlsplit

    parsed = urlsplit(procedure.source_url)
    host = (parsed.hostname or "").casefold().removeprefix("www.")
    if parsed.scheme not in {"http", "https"} or host not in {
        "indiacode.gov.in", "indiacode.nic.in", "egazette.gov.in", "egazette.nic.in", "nalsa.gov.in",
        "112.gov.in", "gov.in", "nic.in",
    }:
        return None
    return procedure.source_url


def _unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result
