"""Build a deterministic procedural journey from an existing ``CaseState``."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable

from app.schemas.case_state import CaseState
from app.engines.safety.models import SafetyAssessment

from app.engines.journey.models import (
    Journey,
    JourneyStage,
    JourneyStep,
    NextAction,
    PossiblePath,
    RequiredDocument,
    RequiredEvidence,
    Risk,
    Unknown,
)


LEGAL_KNOWLEDGE_REQUIRED = "Legal knowledge verification required."

_SUPPORTED_CATEGORIES = {"housing", "employment", "consumer", "criminal", "family", "personal_injury", "debt", "immigration"}
_CATEGORY_LABELS = {
    "housing": "housing",
    "employment": "employment",
    "consumer": "consumer",
    "criminal": "safety or criminal-law-related",
    "family": "family-related",
    "personal_injury": "injury-related",
    "debt": "debt-related",
    "immigration": "immigration-related",
}
_THREAT_TERMS = re.compile(
    r"\b(threat(?:ened|ening)?|harass(?:ment|ed|ing)?|blackmail(?:ed|ing)?)\b|"
    r"धमकी|परेशान कर|डराता|ब्लैकमेल|dhamki|pareshan",
    re.IGNORECASE,
)


def _stable_id(kind: str, case_id: str, value: str) -> str:
    digest = hashlib.sha256(f"{kind}\x1f{case_id}\x1f{value.casefold()}".encode("utf-8")).hexdigest()[:16]
    return f"{kind}_{digest}"


def _case_text(case_state: CaseState) -> str:
    parts: list[str] = []
    if case_state.title:
        parts.append(case_state.title)
    if case_state.initialStatement:
        parts.append(case_state.initialStatement)
    parts.extend(str(fact.value) for fact in case_state.facts)
    parts.extend(event.description for event in case_state.events)
    parts.extend(claim.text for claim in case_state.claims)
    return " ".join(parts)


def _categories(case_state: CaseState) -> tuple[str, ...]:
    found: list[str] = []
    for issue in case_state.legalIssues:
        category = issue.category.casefold()
        if category in _SUPPORTED_CATEGORIES and category not in found:
            found.append(category)
    return tuple(found)


def _has_jurisdiction(case_state: CaseState) -> bool:
    jurisdiction = case_state.jurisdiction
    return jurisdiction.basis == "user_reported" and any((
        jurisdiction.country,
        jurisdiction.state,
        jurisdiction.district,
        jurisdiction.city,
        jurisdiction.locationText,
    ))


def _dated_events(case_state: CaseState) -> bool:
    return any(event.date and event.datePrecision != "unknown" for event in case_state.events)


def _amount_known(case_state: CaseState) -> bool:
    return any(fact.key.casefold() in {"amount_inr", "amount", "wages", "salary", "purchase_amount"} for fact in case_state.facts)


def _unique_texts(values: Iterable[str]) -> tuple[str, ...]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = " ".join(value.split()).strip()
        key = cleaned.casefold()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return tuple(result)


def _unknown_questions(case_state: CaseState, categories: tuple[str, ...], threat_sensitive: bool) -> tuple[str, ...]:
    questions: list[str] = list(case_state.unknowns)
    if not _has_jurisdiction(case_state):
        questions.append("Which country, state, district, or city is relevant to the events?")
    if not _dated_events(case_state):
        questions.append("What are the dates and sequence of the relevant events?")

    if "housing" in categories:
        if not _amount_known(case_state):
            questions.append("What amount was paid or is being discussed?")
        questions.extend((
            "Whether a rental agreement exists and what relevant terms it contains is not known.",
            "What reason, if any, was given for keeping the deposit is not known.",
            "Whether records exist for the payment, move-out, return request, or response is not known.",
        ))
    if "employment" in categories:
        questions.extend((
            "What work arrangement and written employment terms apply is not known.",
            "Which pay periods and amounts are involved is not known.",
            "What explanation or response the employer gave is not known.",
        ))
    if "consumer" in categories:
        questions.extend((
            "What was purchased, when, and for what amount is not known.",
            "What response the seller or service provider gave is not known.",
            "Whether purchase, product-condition, and support records are available is not known.",
        ))
    if not categories:
        questions.extend((
            "What happened, and what outcome or information is being sought, needs clarification.",
            "The roles of the other people or organizations involved are not clear.",
            "What records or documents relate to the events is not known.",
        ))
    if case_state.intent is None:
        questions.append("What the person wants help organizing or understanding is not stated.")
    if threat_sensitive:
        questions.extend((
            "Whether anyone is in immediate danger now is not known.",
            "When and where the reported threats occurred, and whether they are continuing, is not known.",
        ))
    answered_unknown_ids: set[str] = set()
    for fact in case_state.facts:
        if fact.status != "user_reported":
            continue
        match = re.search(r"(?:^|;\s*)sourceUnknownIds=([^;]*)", fact.notes or "")
        if match:
            answered_unknown_ids.update(item for item in match.group(1).split(",") if item)
    return tuple(
        question for question in _unique_texts(questions)
        if _stable_id("unknown", case_state.id, question) not in answered_unknown_ids
    )


def _evidence_items(categories: tuple[str, ...], threat_sensitive: bool) -> tuple[tuple[str, str], ...]:
    result: list[tuple[str, str]] = []

    def add(items: Iterable[tuple[str, str]]) -> None:
        for item, purpose in items:
            if item.casefold() not in {existing[0].casefold() for existing in result}:
                result.append((item, purpose))

    if "housing" in categories:
        add((
            ("Rental agreement or written tenancy terms, if any", "Clarify the recorded arrangement and any stated deposit terms."),
            ("Deposit payment record", "Record the amount and date said to have been paid."),
            ("Messages or letters about the deposit and its return", "Establish what was requested and what responses were given."),
            ("Move-in, move-out, condition, and key-return records, if available", "Organize the reported property condition and handover timeline."),
            ("Any itemized explanation or record of deductions", "Capture any explanation given for the amount retained."),
        ))
    if "employment" in categories:
        add((
            ("Written employment terms or offer, if available", "Clarify the reported work arrangement."),
            ("Pay statements, time records, or payment history", "Organize the periods and amounts described."),
            ("Messages, notices, or other communications about pay or work status", "Record explanations, requests, and responses."),
        ))
    if "consumer" in categories:
        add((
            ("Receipt, order confirmation, or transaction record", "Identify the purchase and its date and amount."),
            ("Product or service description and condition records", "Record what was offered and what was received or observed."),
            ("Warranty or written service terms, if available", "Capture terms relevant to the reported transaction."),
            ("Messages with the seller or provider", "Record requests, responses, and dates."),
        ))
    if threat_sensitive:
        add((
            ("Existing messages, screenshots, voicemail, or call-log details", "Preserve the reported wording, dates, and source of the communications."),
            ("Dated notes of incidents and any existing report references", "Organize what happened and when, without assuming a particular legal process."),
        ))
    if not result:
        add((
            ("Relevant agreements, transaction records, or notices, if any", "Clarify the documented context of the events."),
            ("Relevant messages, letters, or other communications", "Organize requests, responses, and dates."),
            ("A dated factual chronology", "Keep the described events in sequence and identify gaps."),
        ))
    return tuple(result)


def _documents(categories: tuple[str, ...], threat_sensitive: bool) -> tuple[tuple[str, str], ...]:
    # These are records to collect if available, not a statement that any is
    # legally required or sufficient for a particular procedure.
    result: list[tuple[str, str]] = []
    evidence_to_document = _evidence_items(categories, threat_sensitive)
    for item, purpose in evidence_to_document:
        if any(word in item.casefold() for word in ("agreement", "terms", "receipt", "record", "statement", "notice", "letter", "message", "warranty", "report")):
            result.append((item, purpose))
    return tuple(result)


def _current_situation(case_state: CaseState, categories: tuple[str, ...], threat_sensitive: bool) -> str:
    if threat_sensitive:
        return "A threat-related concern is recorded in the CaseState; current safety status is unknown. This is a preliminary description, not a legal finding."
    if not categories:
        if case_state.title:
            return f"Recorded case title: {case_state.title}. No supported issue category is available yet."
        return "The CaseState does not contain enough information to classify the reported concern."
    text = _case_text(case_state).casefold()
    labels = [_CATEGORY_LABELS[category] for category in categories]
    if "housing" in categories and any(term in text for term in ("deposit", "security deposit", "जमा")):
        subject = "housing/security-deposit"
    elif "employment" in categories and any(term in text for term in ("wage", "salary", "pay", "वेतन", "तनख्वाह")):
        subject = "employment/pay"
    elif len(labels) == 1:
        subject = labels[0]
    else:
        subject = ", ".join(labels) + " concern"
    return f"A reported {subject} concern is recorded; the category is preliminary and is not a legal finding."


def _has_specific_document(case_state: CaseState, item: str) -> bool:
    """Only count document evidence after its explicit review confirmation."""
    wanted = item.casefold()
    if "agreement" in wanted:
        aliases = ("rental agreement", "tenancy agreement", "lease")
    elif "deposit payment" in wanted:
        aliases = ("deposit receipt", "deposit payment", "payment receipt")
    elif "move-in" in wanted:
        aliases = ("move-in", "move out", "inspection", "condition photo", "key return")
    elif "itemized" in wanted:
        aliases = ("deduction", "itemized explanation", "deposit statement")
    elif "employment terms" in wanted:
        aliases = ("employment terms", "offer letter", "employment agreement")
    elif "pay statement" in wanted:
        aliases = ("pay statement", "payslip", "pay record", "time record")
    elif "receipt" in wanted:
        aliases = ("receipt", "order confirmation", "transaction record")
    elif "product or service" in wanted:
        aliases = ("product description", "service description", "condition photo")
    elif "warranty" in wanted:
        aliases = ("warranty", "service terms")
    elif "voicemail" in wanted:
        aliases = ("voicemail", "screenshot", "call log", "message")
    elif "message" in wanted:
        aliases = ("message", "email", "letter", "communication")
    elif "dated notes" in wanted:
        aliases = ("incident note", "report reference")
    elif "relevant agreements" in wanted:
        aliases = ("agreement", "transaction record", "notice")
    elif "relevant messages" in wanted:
        aliases = ("message", "letter", "communication")
    else:
        aliases = ()
    documents = {document.id: document for document in case_state.documents}
    for evidence in case_state.evidence:
        if evidence.source != "document" or evidence.status not in {"evidence_supported", "conflicting", "user_reported"}:
            continue
        if evidence.documentId and (
            evidence.documentId not in documents
            or documents[evidence.documentId].reviewStatus != "confirmed"
        ):
            continue
        label = f"{evidence.type} {evidence.title}".casefold()
        if any(alias in label for alias in aliases):
            return True
    return False


def build_journey(
    case_state: CaseState,
    *,
    safety_assessment: SafetyAssessment | None = None,
) -> Journey:
    """Create a stable journey outline from ``CaseState`` without legal advice.

    The engine has no legal-knowledge dependency. Its LAW and OPTIONS stages
    therefore stay explicitly unverified until a jurisdiction-aware,
    source-verified knowledge lookup is integrated by the caller.
    """

    categories = _categories(case_state)
    text = _case_text(case_state)
    if safety_assessment is None:
        threat_sensitive = bool(_THREAT_TERMS.search(text)) or any(
            event.type.casefold() == "threat" for event in case_state.events
        )
    else:
        threat_sensitive = safety_assessment.context.value in {
            "potentially_unsafe",
            "urgent_safety_context",
        }
    current_situation = _current_situation(case_state, categories, threat_sensitive)

    unknowns = tuple(
        Unknown(
            id=_stable_id("unknown", case_state.id, question),
            question=question,
            priority="urgent" if threat_sensitive and "immediate danger" in question.casefold() else "normal",
            related_to="safety" if threat_sensitive and any(word in question.casefold() for word in ("danger", "threat")) else None,
        )
        for question in _unknown_questions(case_state, categories, threat_sensitive)
    )
    evidence_pairs = _evidence_items(categories, threat_sensitive)
    required_evidence = tuple(
        RequiredEvidence(
            id=_stable_id("evidence", case_state.id, item),
            item=item,
            purpose=purpose,
            availability="recorded_in_case_state" if _has_specific_document(case_state, item) else "not_confirmed",
        )
        for item, purpose in evidence_pairs
    )
    required_documents = tuple(
        RequiredDocument(
            id=_stable_id("document", case_state.id, item),
            document=item,
            purpose=purpose,
            availability="recorded_in_case_state" if _has_specific_document(case_state, item) else "not_confirmed",
        )
        for item, purpose in _documents(categories, threat_sensitive)
    )

    paths = (PossiblePath(
        id=_stable_id("path", case_state.id, LEGAL_KNOWLEDGE_REQUIRED),
        label="Procedural options pending verification",
        description=LEGAL_KNOWLEDGE_REQUIRED,
    ),)

    risks: tuple[Risk, ...] = ()
    if threat_sensitive:
        risks = (Risk(
            id=_stable_id("risk", case_state.id, "reported threat current danger unknown"),
            description="Threat-related information is reported, but the current level of danger and whether the conduct is continuing are unknown.",
            escalation_trigger="If anyone is in immediate danger or a threat is unfolding now, seek urgent help from local emergency services or a trusted local safety service.",
            severity="undetermined",
        ),)

    actions: list[NextAction] = [
        NextAction(
            id=_stable_id("action", case_state.id, "clarify missing facts"),
            action="Answer the open questions in the Facts stage, starting with location and event dates.",
            reason="The journey cannot be tailored while core facts or jurisdiction are unknown.",
            stage=JourneyStage.FACTS,
        ),
        NextAction(
            id=_stable_id("action", case_state.id, "organize records"),
            action="List and gather the records in the evidence checklist that are already available.",
            reason="This organizes the reported events and identifies what has not been documented.",
            stage=JourneyStage.EVIDENCE,
        ),
        NextAction(
            id=_stable_id("action", case_state.id, "verify legal knowledge"),
            action="Have any jurisdiction-specific legal information checked against current authoritative sources before procedural options are identified.",
            reason=LEGAL_KNOWLEDGE_REQUIRED,
            stage=JourneyStage.LAW,
        ),
        NextAction(
            id=_stable_id("action", case_state.id, "prepare factual summary"),
            action="Prepare a short factual timeline with dates, amounts, people involved, and relevant responses.",
            reason="A clear summary helps a later reviewer understand what is known and what remains uncertain.",
            stage=JourneyStage.NEXT_STEP,
        ),
    ]
    if threat_sensitive:
        actions.insert(0, NextAction(
            id=_stable_id("action", case_state.id, "immediate safety check"),
            action="Check whether anyone is in immediate danger now.",
            reason="The CaseState contains a threat-related report, but current safety is unknown.",
            stage=JourneyStage.NEXT_STEP,
            condition="If anyone is in immediate danger or a threat is unfolding now, seek urgent help from local emergency services or a trusted local safety service.",
        ))

    steps: list[JourneyStep] = [JourneyStep(
        id=_stable_id("step", case_state.id, "understand current situation"),
        stage=JourneyStage.UNDERSTAND,
        title="Current situation",
        description=current_situation,
    )]
    for unknown in unknowns:
        steps.append(JourneyStep(
            id=_stable_id("step", case_state.id, f"fact:{unknown.id}"),
            stage=JourneyStage.FACTS,
            title="Clarify a missing fact",
            description=unknown.question,
            status="needs_information",
            related_ids=(unknown.id,),
        ))
    for item in required_evidence:
        steps.append(JourneyStep(
            id=_stable_id("step", case_state.id, f"evidence:{item.id}"),
            stage=JourneyStage.EVIDENCE,
            title=item.item,
            description=item.purpose,
            status="needs_information" if item.availability == "not_confirmed" else "recorded_in_case_state",
            related_ids=(item.id,),
        ))
    steps.extend((
        JourneyStep(
            id=_stable_id("step", case_state.id, "law verification"),
            stage=JourneyStage.LAW,
            title="Legal knowledge check",
            description=LEGAL_KNOWLEDGE_REQUIRED,
            status="verification_required",
        ),
        JourneyStep(
            id=_stable_id("step", case_state.id, "procedural options verification"),
            stage=JourneyStage.OPTIONS,
            title="Possible procedural paths",
            description=LEGAL_KNOWLEDGE_REQUIRED,
            status="verification_required",
            related_ids=tuple(path.id for path in paths),
        ),
    ))
    for action in actions:
        steps.append(JourneyStep(
            id=_stable_id("step", case_state.id, f"action:{action.id}"),
            stage=JourneyStage.NEXT_STEP,
            title="Next action",
            description=action.action if not action.condition else f"{action.action} {action.condition}",
            status="conditional" if action.condition else "actionable",
            related_ids=(action.id,),
        ))

    return Journey(
        id=_stable_id("journey", case_state.id, "legal journey"),
        case_id=case_state.id,
        current_situation=current_situation,
        steps=tuple(steps),
        unknowns=unknowns,
        required_evidence=required_evidence,
        possible_paths=paths,
        required_documents=required_documents,
        next_actions=tuple(actions),
        escalation_points=risks,
        jurisdiction_status="known" if _has_jurisdiction(case_state) else "unknown",
    )
