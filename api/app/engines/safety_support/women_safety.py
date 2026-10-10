"""Women-safety extensions derived from the canonical Safety assessment.

This module does not run a second detector. It classifies the existing
SafetySupportAssessment signals, maps only to issue categories already used by
the legal-knowledge catalog, and exposes returned procedures as candidates.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence

from app.schemas.case_state import CaseState

from .models import (
    ImmediateDangerAnswer,
    OfficialResource,
    SafetyLanguage,
    SafetySituation,
    SafetyUrgency,
    TriggerEvidence,
    WomenSafetyAction,
    WomenSafetyActionType,
    WomenSafetyContext,
    WomenSafetyDomain,
    WomenSafetyDomainEvidence,
    WomenSafetyLegalIssueMapping,
    WomenSafetyProcedure,
    WomenSafetySourceReference,
    WomenSafetyUrgency,
)


_DOMAIN_ORDER = tuple(WomenSafetyDomain)
_URGENT_CUES = re.compile(
    r"\b(?:threatened to kill|threat(?:ened|ening)? to (?:shoot|stab)|"
    r"chok(?:ed|ing)|strangl(?:ed|ing)|forced me to have sex|sexual assault|"
    r"rape(?:d)?|human trafficking|trafficked me|locked me in)\b"
    r"|जान से मार(?:ने|ने की धमकी)|गला दबा(?:या|ने)|बलात्कार|यौन हिंसा|"
    r"मानव तस्करी|जबरन बंद",
    re.IGNORECASE,
)
_SEXUAL_CUE = re.compile(
    r"\b(?:sexual|sexually|unwanted sexual|sexual harassment|sexual messages?)\b"
    r"|यौन|अश्लील|\b(?:yaun|sexual)\b",
    re.IGNORECASE,
)

# These are issue-category labels already present in the case/legal registry.
# Empty entries mean the current source catalog has no supported mapping.
_LEGAL_ISSUE_CANDIDATES: dict[WomenSafetyDomain, tuple[str, ...]] = {
    WomenSafetyDomain.DOMESTIC_ABUSE: ("family",),
    WomenSafetyDomain.SEXUAL_VIOLENCE: (),
    WomenSafetyDomain.WORKPLACE_SEXUAL_HARASSMENT: ("workplace_harassment",),
    WomenSafetyDomain.STALKING: (),
    WomenSafetyDomain.THREATS_COERCION: (),
    WomenSafetyDomain.CYBER_HARASSMENT: (),
    WomenSafetyDomain.INTIMATE_IMAGE_ABUSE: (),
    WomenSafetyDomain.DOWRY_RELATED_ABUSE: ("family", "dowry_related_harassment"),
    WomenSafetyDomain.FINANCIAL_CONTROL_ABUSE: ("family",),
    WomenSafetyDomain.TRAFFICKING_EXPLOITATION: (),
}

_RECORD_TERMS: dict[WomenSafetyDomain, tuple[str, ...]] = {
    WomenSafetyDomain.DOMESTIC_ABUSE: ("domestic violence",),
    WomenSafetyDomain.WORKPLACE_SEXUAL_HARASSMENT: ("sexual harassment", "workplace"),
    WomenSafetyDomain.DOWRY_RELATED_ABUSE: ("domestic violence", "dowry"),
    WomenSafetyDomain.FINANCIAL_CONTROL_ABUSE: ("domestic violence", "economic abuse"),
}

_EVIDENCE_GUIDANCE: dict[SafetyLanguage, dict[str, str]] = {
    SafetyLanguage.ENGLISH: {
        "intimate": (
            "If safe, keep related messages, links, account names, and dates. Do not create, download, forward, or share intimate images to preserve evidence."
        ),
        "workplace": (
            "If safe, keep original workplace messages or emails and their dates; use only records you are allowed to access."
        ),
        "stalking": (
            "If safe, note dates, places, and unwanted contact and retain original messages; do not confront or follow anyone to collect evidence."
        ),
        "other": (
            "If safe, keep original records related to the concern. You do not need to collect evidence before seeking support."
        ),
    },
    SafetyLanguage.HINDI: {
        "intimate": (
            "यदि सुरक्षित हो, तो संबंधित संदेश, लिंक, खाते के नाम और तारीखें रखें। सबूत के लिए अंतरंग तस्वीरें न बनाएँ, डाउनलोड न करें, आगे न भेजें और साझा न करें।"
        ),
        "workplace": (
            "यदि सुरक्षित हो, तो कार्यस्थल के मूल संदेश या ईमेल और उनकी तारीखें रखें; केवल वही रिकॉर्ड उपयोग करें जिन्हें देखने की आपको अनुमति है।"
        ),
        "stalking": (
            "यदि सुरक्षित हो, तो तारीखें, जगहें और अनचाहे संपर्क का विवरण लिखें और मूल संदेश रखें; सबूत जुटाने के लिए किसी का सामना या पीछा न करें।"
        ),
        "other": (
            "यदि सुरक्षित हो, तो चिंता से जुड़े मूल रिकॉर्ड रखें। सहायता माँगने से पहले सबूत इकट्ठा करना ज़रूरी नहीं है।"
        ),
    },
    SafetyLanguage.HINGLISH: {
        "intimate": (
            "Agar safe ho, related messages, links, account names aur dates rakhein. Evidence ke liye intimate images create, download, forward ya share na karein."
        ),
        "workplace": (
            "Agar safe ho, workplace ke original messages ya emails aur unki dates rakhein; sirf wahi records use karein jinhe access karne ki aapko permission hai."
        ),
        "stalking": (
            "Agar safe ho, dates, places aur unwanted contact note karein aur original messages rakhein; evidence collect karne ke liye kisi ka saamna ya peecha na karein."
        ),
        "other": (
            "Agar safe ho, concern se jude original records rakhein. Support maangne se pehle evidence collect karna zaroori nahi hai."
        ),
    },
}


def _domain_trigger_categories(
    evidence: Sequence[TriggerEvidence], situations: set[SafetySituation]
) -> dict[WomenSafetyDomain, tuple[str, ...]]:
    categories = {item.category for item in evidence}
    workplace_sexual = any(
        item.category in {"workplace_sexual_harassment_concern", "workplace_harassment_context"}
        and _SEXUAL_CUE.search(item.source_text)
        for item in evidence
    )
    if not workplace_sexual and SafetySituation.WORKPLACE_HARASSMENT in situations:
        workplace_sexual = any(
            SafetySituation.WORKPLACE_HARASSMENT in item.situations
            and _SEXUAL_CUE.search(item.source_text)
            for item in evidence
        )

    evidence_categories: dict[WomenSafetyDomain, set[str]] = {
        WomenSafetyDomain.DOMESTIC_ABUSE: set(),
        WomenSafetyDomain.SEXUAL_VIOLENCE: set(),
        WomenSafetyDomain.WORKPLACE_SEXUAL_HARASSMENT: set(),
        WomenSafetyDomain.STALKING: set(),
        WomenSafetyDomain.THREATS_COERCION: set(),
        WomenSafetyDomain.CYBER_HARASSMENT: set(),
        WomenSafetyDomain.INTIMATE_IMAGE_ABUSE: set(),
        WomenSafetyDomain.DOWRY_RELATED_ABUSE: set(),
        WomenSafetyDomain.FINANCIAL_CONTROL_ABUSE: set(),
        WomenSafetyDomain.TRAFFICKING_EXPLOITATION: set(),
    }

    if "domestic_violence" in categories or situations.intersection({
        SafetySituation.DOMESTIC_VIOLENCE,
        SafetySituation.COERCIVE_CONTROL,
        SafetySituation.FORCED_ISOLATION,
    }):
        evidence_categories[WomenSafetyDomain.DOMESTIC_ABUSE].update(
            categories.intersection({"domestic_violence", "coercion", "forced_isolation", "financial_control"})
        )
        if not evidence_categories[WomenSafetyDomain.DOMESTIC_ABUSE]:
            evidence_categories[WomenSafetyDomain.DOMESTIC_ABUSE].add("relationship_control_context")

    if "sexual_violence" in categories:
        evidence_categories[WomenSafetyDomain.SEXUAL_VIOLENCE].add("sexual_violence")

    if workplace_sexual:
        evidence_categories[WomenSafetyDomain.WORKPLACE_SEXUAL_HARASSMENT].update(
            categories.intersection({
                "workplace_sexual_harassment_concern", "workplace_harassment_context", "harassment",
            }) or {"workplace_sexual_harassment_context"}
        )

    if "stalking" in categories or SafetySituation.STALKING in situations:
        evidence_categories[WomenSafetyDomain.STALKING].update(
            categories.intersection({"stalking"}) or {"stalking_context"}
        )

    threat_categories = categories.intersection({"threat", "coercion", "intimidation"})
    if threat_categories or SafetySituation.THREATS in situations:
        evidence_categories[WomenSafetyDomain.THREATS_COERCION].update(
            threat_categories or {"threat_context"}
        )

    if "cyber_harassment_context" in categories or SafetySituation.CYBER_HARASSMENT in situations:
        evidence_categories[WomenSafetyDomain.CYBER_HARASSMENT].update(
            categories.intersection({"cyber_harassment_context", "blackmail", "harassment", "threat"})
            or {"cyber_harassment_context"}
        )

    if "intimate_image_abuse" in categories or SafetySituation.INTIMATE_IMAGE_ABUSE in situations:
        evidence_categories[WomenSafetyDomain.INTIMATE_IMAGE_ABUSE].add("intimate_image_abuse")

    if "dowry_related_abuse" in categories or SafetySituation.DOWRY_RELATED_ABUSE in situations:
        evidence_categories[WomenSafetyDomain.DOWRY_RELATED_ABUSE].add("dowry_related_abuse")

    control_categories = categories.intersection({"financial_control", "coercion", "forced_isolation"})
    if control_categories or situations.intersection({
        SafetySituation.FINANCIAL_CONTROL,
        SafetySituation.COERCIVE_CONTROL,
        SafetySituation.FORCED_ISOLATION,
    }):
        evidence_categories[WomenSafetyDomain.FINANCIAL_CONTROL_ABUSE].update(
            control_categories or {"coercive_control_context"}
        )

    if "exploitation" in categories or SafetySituation.EXPLOITATION in situations:
        evidence_categories[WomenSafetyDomain.TRAFFICKING_EXPLOITATION].update(
            categories.intersection({"exploitation"}) or {"exploitation_context"}
        )

    return {
        domain: tuple(sorted(trigger_categories))
        for domain, trigger_categories in evidence_categories.items()
        if trigger_categories
    }


def _case_legal_knowledge(case_state: CaseState | None) -> tuple[object, ...]:
    if case_state is None or case_state.analysis is None:
        return ()
    legal_knowledge = case_state.analysis.legal_knowledge
    if legal_knowledge is None:
        return ()
    return tuple(legal_knowledge.records)


def _matching_legal_records(
    *,
    domain: WomenSafetyDomain,
    candidate_categories: tuple[str, ...],
    matched_issue_ids: tuple[str, ...],
    legal_records: tuple[object, ...],
) -> tuple[object, ...]:
    if not candidate_categories or not matched_issue_ids:
        return ()
    terms = _RECORD_TERMS.get(domain, ())
    if not terms:
        return ()
    matches: list[object] = []
    for record in legal_records:
        searchable = " ".join((
            str(getattr(record, "title", "")),
            str(getattr(record, "reference", "")),
            str(getattr(record, "source", "")),
        )).casefold()
        if any(term in searchable for term in terms):
            matches.append(record)
    return tuple(matches)


def _issue_mappings(
    *, domains: tuple[WomenSafetyDomain, ...], case_state: CaseState | None,
) -> tuple[tuple[WomenSafetyLegalIssueMapping, ...], tuple[object, ...]]:
    legal_records = _case_legal_knowledge(case_state)
    issue_records = tuple(case_state.legalIssues) if case_state is not None else ()
    mappings: list[WomenSafetyLegalIssueMapping] = []
    selected_records: dict[str, object] = {}

    for domain in domains:
        candidates = _LEGAL_ISSUE_CANDIDATES[domain]
        matched_issues = tuple(
            issue for issue in issue_records
            if issue.category.casefold() in candidates
            or (issue.subcategory or "").casefold() in candidates
        )
        matching_records = _matching_legal_records(
            domain=domain,
            candidate_categories=candidates,
            matched_issue_ids=tuple(issue.id for issue in matched_issues),
            legal_records=legal_records,
        )
        selected_records.update({str(record.id): record for record in matching_records})
        if not candidates:
            status = "no_current_registry_mapping"
        elif case_state is None:
            status = "case_state_not_available"
        elif matched_issues:
            status = "matched_case_issue"
        else:
            status = "no_matching_case_issue"
        mappings.append(WomenSafetyLegalIssueMapping(
            domain=domain,
            status=status,
            candidate_issue_categories=candidates,
            matched_case_issue_ids=tuple(issue.id for issue in matched_issues),
            source_record_ids=tuple(str(record.id) for record in matching_records),
        ))
    return tuple(mappings), tuple(selected_records.values())


def _legal_source_references(records: Iterable[object]) -> tuple[WomenSafetySourceReference, ...]:
    references: dict[tuple[str, str, str | None], WomenSafetySourceReference] = {}
    for record in records:
        record_id = str(getattr(record, "id", ""))
        record_sources = tuple(getattr(record, "provenance", ()) or ())
        for reference in record_sources:
            source_id = getattr(reference, "source_id", None)
            if not record_id or not source_id:
                continue
            item = WomenSafetySourceReference(
                record_id=record_id,
                source_id=str(source_id),
                retrieval_time=getattr(reference, "retrieval_time", None),
                source_url=getattr(reference, "source_url", None),
                provision_id=getattr(reference, "provision_id", None),
                page_section_reference=getattr(reference, "page_section_reference", None),
                jurisdiction=getattr(record, "jurisdiction", None),
                verification_status=getattr(record, "source_verification_status", None),
                freshness_status=getattr(record, "source_freshness_status", None),
                applicability_status=getattr(record, "source_applicability_status", None),
                jurisdiction_match_status=getattr(record, "jurisdiction_match_status", None),
            )
            references[(record_id, str(source_id), item.page_section_reference)] = item
    return tuple(references[key] for key in sorted(references))


def _procedures(records: Iterable[object]) -> tuple[WomenSafetyProcedure, ...]:
    procedures: list[WomenSafetyProcedure] = []
    for record in records:
        if getattr(record, "type", None) != "legal_procedure":
            continue
        source_ids = tuple(dict.fromkeys(
            str(reference.source_id)
            for reference in (getattr(record, "provenance", ()) or ())
            if getattr(reference, "source_id", None)
        ))
        procedures.append(WomenSafetyProcedure(
            record_id=str(record.id),
            title=str(record.title),
            jurisdiction=getattr(record, "jurisdiction", None),
            verification_status=getattr(record, "source_verification_status", None),
            applicability_status=getattr(record, "source_applicability_status", None),
            jurisdiction_match_status=getattr(record, "jurisdiction_match_status", None),
            source_ids=source_ids,
        ))
    return tuple(procedures)


def build_women_safety_context(
    *,
    trigger_evidence: Sequence[TriggerEvidence],
    situations: Sequence[SafetySituation],
    shared_urgency: SafetyUrgency,
    language: SafetyLanguage,
    immediate_danger: ImmediateDangerAnswer | None,
    evidence_guidance_available: bool,
    resources: Sequence[OfficialResource],
    case_state: CaseState | None,
    jurisdiction: str | None,
    state: str | None,
) -> WomenSafetyContext:
    """Build the women-focused view from the already-computed shared result."""

    trigger_categories_by_domain = _domain_trigger_categories(
        trigger_evidence, set(situations)
    )
    domains = tuple(domain for domain in _DOMAIN_ORDER if domain in trigger_categories_by_domain)
    domain_evidence = tuple(
        WomenSafetyDomainEvidence(domain, trigger_categories_by_domain[domain])
        for domain in domains
    )

    all_trigger_text = " ".join(item.source_text for item in trigger_evidence)
    has_explicit_immediate_danger = (
        shared_urgency is SafetyUrgency.URGENT
        or immediate_danger is ImmediateDangerAnswer.YES
    )
    if has_explicit_immediate_danger:
        urgency = WomenSafetyUrgency.IMMEDIATE_DANGER
    elif immediate_danger is ImmediateDangerAnswer.NOT_SURE:
        urgency = WomenSafetyUrgency.NOT_SURE
    elif _URGENT_CUES.search(all_trigger_text):
        urgency = WomenSafetyUrgency.URGENT
    elif domains:
        urgency = WomenSafetyUrgency.CONCERNING
    else:
        urgency = WomenSafetyUrgency.NORMAL

    issue_mappings, matched_records = _issue_mappings(domains=domains, case_state=case_state)
    procedures = _procedures(matched_records)
    legal_sources = _legal_source_references(matched_records)
    resource_ids = tuple(dict.fromkeys(
        resource.resource_id for resource in resources if resource.resource_id
    ))

    actions = [WomenSafetyAction(
        id="women-safety-immediate-danger-check",
        type=WomenSafetyActionType.IMMEDIATE_DANGER_CHECK,
        status="answered" if immediate_danger is not None else "awaiting_user_choice",
        condition="user chooses YES, NO, or NOT_SURE",
    )]
    if domains and evidence_guidance_available:
        actions.append(WomenSafetyAction(
            id="women-safety-evidence-preservation",
            type=WomenSafetyActionType.EVIDENCE_PRESERVATION,
            status="optional_if_safe",
            condition="only if preserving records does not increase risk",
        ))
    actions.append(WomenSafetyAction(
        id="women-safety-review-support-resources",
        type=WomenSafetyActionType.REVIEW_SUPPORT_RESOURCES,
        status="available" if resource_ids else "no_verified_resource_returned",
        condition="user chooses whether to open or contact a listed resource",
        jurisdiction_required=True,
        source_ids=resource_ids,
    ))
    procedure_record_ids = tuple(procedure.record_id for procedure in procedures)
    actions.append(WomenSafetyAction(
        id="women-safety-review-legal-procedures",
        type=WomenSafetyActionType.REVIEW_LEGAL_PROCEDURES,
        status="candidate_records_available" if procedures else "no_source_record_returned",
        condition="candidate source records require jurisdiction and applicability review",
        jurisdiction_required=True,
        source_ids=tuple(dict.fromkeys((*procedure_record_ids, *(source.source_id for source in legal_sources)))),
    ))

    specific_evidence_guidance: tuple[str, ...] = ()
    if domains and evidence_guidance_available:
        guidance = _EVIDENCE_GUIDANCE[language]
        if WomenSafetyDomain.INTIMATE_IMAGE_ABUSE in domains:
            specific_evidence_guidance = (guidance["intimate"],)
        elif WomenSafetyDomain.WORKPLACE_SEXUAL_HARASSMENT in domains:
            specific_evidence_guidance = (guidance["workplace"],)
        elif WomenSafetyDomain.STALKING in domains:
            specific_evidence_guidance = (guidance["stalking"],)
        else:
            specific_evidence_guidance = (guidance["other"],)

    return WomenSafetyContext(
        domains=domains,
        domain_evidence=domain_evidence,
        urgency=urgency,
        immediate_danger_answer=immediate_danger,
        jurisdiction_status="known" if jurisdiction else "unknown",
        jurisdiction=jurisdiction,
        state=state,
        legal_issue_mappings=issue_mappings,
        procedures=procedures,
        actions=tuple(actions),
        evidence_preservation_guidance=specific_evidence_guidance,
        legal_sources=legal_sources,
        contacted_anyone=False,
    )
