"""Rule-based case clarification with stable ranking and source traceability."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from typing import Any, Literal

from app.schemas.case_state import CaseFact, CaseIntent, CaseState, EvidenceItem

from .models import ClarificationQuestion, ClarificationSource, ClarificationQuestions


_CATEGORY_ORDER = {
    "jurisdiction": 1,
    "dates": 2,
    "objective": 3,
    "evidence": 4,
    "parties": 5,
    "safety": 6,
    "other": 7,
}
_UNANSWERED = re.compile(
    r"^(?:(?:i\s+(?:am\s+)?|i['’]m\s+)?(?:do\s+not\s+know|don't\s+know|not\s+sure|unsure|unknown|prefer\s+not\s+to\s+say)|"
    r"pata\s+nahi(?:\s+hai)?|maloom\s+nahi|nahi\s+pata|nahi\s+maloom|"
    r"मुझे\s+नहीं\s+पता|पता\s+नहीं|मालूम\s+नहीं|नहीं\s+पता|नहीं\s+बताना\s+चाहता(?:\s+हूँ)?|"
    r"नहीं\s+बताना\s+चाहती(?:\s+हूँ)?)[.!।\s]*$",
    re.IGNORECASE,
)


def build_clarification_questions(
    case_state: CaseState,
    journey_unknowns: Iterable[Any] | None = None,
    *,
    language: str | None = None,
    limit: int | None = 3,
    include_skipped: bool = False,
) -> ClarificationQuestions:
    """Build a stable, prioritized queue from explicit CaseState/journey gaps.

    The service never infers a missing fact. It uses ``CaseState.unknowns`` and
    journey unknown records as its sole question sources, deduplicates them,
    and drops stale gaps that the current state already answers.
    """

    if not isinstance(case_state, CaseState):
        raise TypeError("case_state must be a CaseState")
    case_state, _ = normalize_unanswered_clarification_records(case_state)
    if limit is not None and (not isinstance(limit, int) or limit < 0):
        raise ValueError("limit must be a non-negative integer or None")

    selected_language = _language(language or case_state.metadata.language)
    sources: list[ClarificationSource] = []
    for index, text in enumerate(case_state.unknowns):
        cleaned = _clean(text)
        if cleaned:
            sources.append(ClarificationSource(
                source_id=_stable_id("case_unknown", case_state.id, str(index), cleaned.casefold()),
                source_type="case_state",
                source_path=f"unknowns/{index}",
                text=cleaned,
            ))

    for index, item in enumerate(_journey_unknowns(case_state, journey_unknowns)):
        unknown_id, text, priority, related_to = _unknown_fields(item, case_state.id, index)
        if not text:
            continue
        sources.append(ClarificationSource(
            source_id=unknown_id,
            source_type="journey",
            source_path=f"analysis.journey.unknowns/{unknown_id}" if _from_analysis(case_state, journey_unknowns) else f"journey.unknowns/{unknown_id}",
            text=text,
            priority=priority,
            related_to=related_to,
        ))

    groups: dict[str, list[ClarificationSource]] = defaultdict(list)
    for source in sources:
        if _source_already_answered(case_state, source.source_id):
            continue
        category, group_key = _classify(source.text, source.related_to)
        if _already_known(case_state, category, source.text):
            continue
        groups[group_key].append(source)

    questions: list[ClarificationQuestion] = []
    for group_key, group_sources in groups.items():
        # Stable first-occurrence ordering for sources and stable IDs even when
        # the same unknown appears in both the extractor and journey output.
        unique_sources = _unique_sources(group_sources)
        category, _ = _classify(unique_sources[0].text, unique_sources[0].related_to)
        source_texts = tuple(dict.fromkeys(source.text for source in unique_sources))
        question_id = _stable_id(
            "clarification",
            case_state.id,
            group_key,
            "\x1e".join(sorted(text.casefold() for text in source_texts)),
        )
        if question_id in case_state.skippedClarificationIds and not include_skipped:
            continue
        if any(_fact_question_id(fact) == question_id for fact in case_state.facts):
            continue
        prompt = _render_question(category, source_texts, selected_language)
        urgent_question = any(
            source.priority.casefold() == "urgent"
            or source.priority.casefold() == "critical"
            or (category == "safety" and (
                "immediate danger" in source.text.casefold()
                or "तत्काल खतरा" in source.text
            ))
            for source in unique_sources
        )
        questions.append(ClarificationQuestion(
            id=question_id,
            case_id=case_state.id,
            category=category,  # type: ignore[arg-type] - selected from the fixed category map.
            target=_target(category, source_texts, group_key),
            question=prompt,
            language=selected_language,
            priority=0 if urgent_question else _CATEGORY_ORDER[category],
            sources=tuple(unique_sources),
        ))

    questions.sort(key=lambda item: item.priority)
    if limit is not None:
        questions = questions[:limit]
    return ClarificationQuestions(case_id=case_state.id, questions=tuple(questions))


def apply_clarification_answer(
    case_state: CaseState,
    question: ClarificationQuestion,
    answer: str,
    *,
    journey_unknowns: Iterable[Any] | None = None,
    answered_at: str | None = None,
    allow_revision: bool = False,
) -> CaseState:
    """Return a provenance-linked CaseState copy containing a user answer.

    The corresponding extractor unknowns are removed only when a factual
    answer is supplied. Factual answers are appended as user-sourced facts and
    evidence records. Responses such as "I don't know" use skip semantics and
    create no answer, fact, or evidence record.
    """

    if not isinstance(case_state, CaseState):
        raise TypeError("case_state must be a CaseState")
    if not isinstance(question, ClarificationQuestion):
        raise TypeError("question must be a ClarificationQuestion")
    if question.case_id != case_state.id:
        raise ValueError("question belongs to a different CaseState")
    if not isinstance(answer, str) or not answer.strip():
        raise ValueError("answer must not be empty")

    case_state, _ = normalize_unanswered_clarification_records(case_state)
    normalized_answer = _clean(answer)
    # The UI uses typographic apostrophes in its English choices (for example
    # “I don’t know”). Treat them the same as the ASCII forms so an explicit
    # uncertainty response can never become a factual answer.
    answer_for_unknown_check = normalized_answer.replace("’", "'").replace("‘", "'")
    answer_is_unknown = bool(_UNANSWERED.fullmatch(answer_for_unknown_check))
    existing_question_fact = next(
        (fact for fact in case_state.facts if _fact_question_id(fact) == question.id),
        None,
    )
    if not _question_is_grounded(case_state, question, journey_unknowns) and existing_question_fact is None:
        raise ValueError("question no longer refers to an open unknown in this CaseState")
    if (
        existing_question_fact is not None
        and _clean(str(existing_question_fact.value)).casefold() != normalized_answer.casefold()
        and not allow_revision
    ):
        raise ValueError("question already has an answer; set allow_revision=True to record a correction")

    if answer_is_unknown:
        return skip_clarification_question(
            case_state,
            question,
            journey_unknowns=journey_unknowns,
            skipped_at=answered_at,
        )

    updated = case_state.model_copy(deep=True)
    fact_key = f"clarification_{question.target.replace('.', '_')}"
    answer_hash = _stable_id("answer", question.id, normalized_answer.casefold())
    evidence_id = f"clarification_source_{answer_hash.removeprefix('answer_')}"
    fact_id = f"clarification_fact_{answer_hash.removeprefix('answer_')}"

    # Reposting the same response is idempotent.
    if any(item.id == evidence_id for item in updated.evidence):
        return updated

    conflicts = [
        fact for fact in updated.facts
        if fact.key == fact_key
        and _clean(str(fact.value)).casefold() != normalized_answer.casefold()
    ]
    fact_status = "conflicting" if conflicts else "user_reported"
    fact = CaseFact(
        id=fact_id,
        key=fact_key,
        value=normalized_answer,
        status=fact_status,
        confidence="medium",
        sourceIds=[evidence_id],
        notes=(
            f"clarificationQuestionId={question.id}; category={question.category}; "
            f"sourceUnknownIds={','.join(source.source_id for source in question.sources)}; "
            f"sourceDetailsJson={json.dumps([source.model_dump() for source in question.sources], ensure_ascii=False, sort_keys=True)}"
        ),
    )
    updated.facts.append(fact)
    updated.evidence.append(EvidenceItem(
        id=evidence_id,
        type="clarification_response",
        title=f"User clarification: {question.category}",
        source="user",
        status="user_reported" if not conflicts else "conflicting",
        extractedFacts=[fact_id],
    ))

    if conflicts:
        conflict = (
            f"User clarification for {question.category} differs from an earlier response. "
            f"Both responses are retained with their sources."
        )
        if conflict not in updated.conflicts:
            updated.conflicts.append(conflict)

    resolved_paths = {
        source.source_path for source in question.sources if source.source_type == "case_state"
    }
    resolved_texts = {
        source.text.casefold() for source in question.sources if source.source_type == "case_state"
    }
    updated.unknowns = [
        text for index, text in enumerate(updated.unknowns)
        if f"unknowns/{index}" not in resolved_paths and _clean(text).casefold() not in resolved_texts
    ]

    updated.skippedClarificationIds = [
        item for item in updated.skippedClarificationIds if item != question.id
    ]
    if question.category == "objective":
        updated.intent = CaseIntent(objective=normalized_answer)
    elif question.category == "jurisdiction":
        # Preserve exactly what the user reported without guessing whether
        # tokens denote a city, district, state, or country.
        updated.jurisdiction.locationText = normalized_answer
        updated.jurisdiction.basis = "user_reported"

    updated.metadata.updatedAt = answered_at or datetime.now(timezone.utc).isoformat()
    # Any attached analysis describes the pre-answer facts and must be rebuilt
    # by the caller before it is presented as current.
    updated.analysis = None
    return updated


def skip_clarification_question(
    case_state: CaseState,
    question: ClarificationQuestion,
    *,
    journey_unknowns: Iterable[Any] | None = None,
    skipped_at: str | None = None,
) -> CaseState:
    """Dismiss a grounded question while leaving its underlying gap unknown."""

    if not isinstance(case_state, CaseState):
        raise TypeError("case_state must be a CaseState")
    if not isinstance(question, ClarificationQuestion):
        raise TypeError("question must be a ClarificationQuestion")
    if question.case_id != case_state.id:
        raise ValueError("question belongs to a different CaseState")

    case_state, _ = normalize_unanswered_clarification_records(case_state)
    if any(_fact_question_id(fact) == question.id for fact in case_state.facts):
        raise ValueError("question already has an answer")
    if not _question_is_grounded(case_state, question, journey_unknowns):
        raise ValueError("question no longer refers to an open unknown in this CaseState")

    updated = case_state.model_copy(deep=True)
    if question.id not in updated.skippedClarificationIds:
        updated.skippedClarificationIds.append(question.id)
        updated.metadata.updatedAt = skipped_at or datetime.now(timezone.utc).isoformat()
    updated.analysis = None
    return updated


def normalize_unanswered_clarification_records(case_state: CaseState) -> tuple[CaseState, bool]:
    """Remove legacy ``unknown`` clarification facts and restore their gaps.

    Older versions stored responses such as "I don't know" as fact and
    evidence records. Their source details retain the original open question,
    which is restored to ``unknowns`` while the answer-shaped records are
    removed from the canonical state.
    """

    if not isinstance(case_state, CaseState):
        raise TypeError("case_state must be a CaseState")

    evidence_by_id = {item.id: item for item in case_state.evidence}
    legacy_facts = [
        fact for fact in case_state.facts
        if fact.status == "unknown"
        and fact.id.startswith("clarification_fact_")
        and _fact_question_id(fact)
        and any(
            evidence_by_id.get(source_id) is not None
            and evidence_by_id[source_id].type == "clarification_response"
            and evidence_by_id[source_id].source == "user"
            for source_id in fact.sourceIds
        )
    ]
    if not legacy_facts:
        return case_state, False

    updated = case_state.model_copy(deep=True)
    legacy_ids = {fact.id for fact in legacy_facts}
    source_ids = {source_id for fact in legacy_facts for source_id in fact.sourceIds}
    question_ids: set[str] = set()
    restored_unknowns: list[str] = []
    legacy_categories: set[str] = set()
    for fact in legacy_facts:
        question_id = _fact_question_id(fact)
        if question_id:
            question_ids.add(question_id)
        category_match = re.search(r"(?:^|;\s*)category=([^;]+)", fact.notes or "")
        if category_match:
            legacy_categories.add(category_match.group(1))
        details_match = re.search(r"(?:^|;\s*)sourceDetailsJson=(\[.*\])\s*$", fact.notes or "")
        if not details_match:
            continue
        try:
            sources = json.loads(details_match.group(1))
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(sources, list):
            continue
        for source in sources:
            if isinstance(source, Mapping):
                text = _clean(str(source.get("text", "") or ""))
                if text:
                    restored_unknowns.append(text)

    updated.facts = [fact for fact in updated.facts if fact.id not in legacy_ids]
    updated.unknowns = list(dict.fromkeys((*updated.unknowns, *restored_unknowns)))
    updated.skippedClarificationIds = list(dict.fromkeys((*updated.skippedClarificationIds, *question_ids)))
    categories_with_remaining_conflicts = {
        match.group(1)
        for fact in updated.facts
        if fact.status == "conflicting"
        and (match := re.search(r"(?:^|;\s*)category=([^;]+)", fact.notes or ""))
    }
    categories_to_clear = legacy_categories - categories_with_remaining_conflicts
    updated.conflicts = [
        conflict for conflict in updated.conflicts
        if not any(
            conflict == (
                f"User clarification for {category} differs from an earlier response. "
                "Both responses are retained with their sources."
            )
            for category in categories_to_clear
        )
    ]
    updated.evidence = [
        item for item in updated.evidence
        if not (
            item.id in source_ids
            and item.type == "clarification_response"
            and item.source == "user"
            and not (set(item.extractedFacts) - legacy_ids)
        )
    ]
    updated.analysis = None
    return updated, True


def _journey_unknowns(case_state: CaseState, provided: Iterable[Any] | None) -> Iterable[Any]:
    if provided is not None:
        return provided
    if case_state.analysis is not None:
        return case_state.analysis.journey.unknowns
    return ()


def _from_analysis(case_state: CaseState, provided: Iterable[Any] | None) -> bool:
    return provided is None and case_state.analysis is not None


def _unknown_fields(item: Any, case_id: str, index: int) -> tuple[str, str, str, str | None]:
    if isinstance(item, str):
        text = _clean(item)
        return _stable_id("journey_unknown", case_id, text.casefold()), text, "normal", None
    if isinstance(item, Mapping):
        get = item.get
    else:
        get = lambda name, default=None: getattr(item, name, default)
    text = _clean(str(get("question", "") or ""))
    raw_id = str(get("id", "") or "").strip()
    unknown_id = raw_id or _stable_id("journey_unknown", case_id, str(index), text.casefold())
    return unknown_id, text, str(get("priority", "normal") or "normal"), get("related_to")


def _unique_sources(sources: Iterable[ClarificationSource]) -> list[ClarificationSource]:
    seen: set[tuple[str, str]] = set()
    unique: list[ClarificationSource] = []
    for source in sources:
        key = (source.source_type, source.text.casefold())
        if key not in seen:
            seen.add(key)
            unique.append(source)
    return unique


def _classify(text: str, related_to: str | None = None) -> tuple[str, str]:
    value = text.casefold()
    if (related_to or "").casefold() == "safety" or _has_any(
        value,
        ("immediate danger", "continuing", "threat", "safety", "तत्काल खतरा", "धमकी", "सुरक्षा"),
    ):
        category = "safety"
    elif _has_any(value, ("country", "countries", "state", "district", "city", "cities", "location", "where", "स्थान", "कहाँ", "शहर", "ज़िला", "जिला", "राज्य", "देश")):
        category = "jurisdiction"
    elif _has_any(value, ("date", "dates", "when", "timing", "sequence", "timeline", "how often", "कब", "तारीख", "समय", "कितनी बार")):
        category = "dates"
    elif _has_any(value, ("name", "party", "parties", "landlord", "employer", "seller", "sender", "role", "relationship", "who is suspected", "कौन", "नाम", "भूमिका")):
        category = "parties"
    elif _has_any(value, ("want", "wants", "outcome", "help organizing", "understanding", "उद्देश्य", "मदद", "क्या चाहते")):
        category = "objective"
    elif _has_any(value, ("evidence", "proof", "record", "records", "document", "documents", "receipt", "agreement", "terms", "message", "messages", "letter", "letters", "रसीद", "सबूत", "दस्तावेज़", "रिकॉर्ड", "प्रमाण")):
        category = "evidence"
    else:
        category = "other"

    if category == "other" and any(term in value for term in ("reason", "explanation", "कारण")):
        key = "other_reason"
    elif category == "other" and any(term in value for term in ("amount", "कितनी राशि")):
        key = "other_amount"
    elif category == "other":
        key = _stable_id("other_gap", value)
    elif category == "safety" and any(term in value for term in ("immediate danger", "तत्काल खतरा")):
        key = "safety"
    elif category == "safety" and any(term in value for term in ("specific words", "how often", "frequency", "specific threat", "शब्द", "कितनी बार")):
        key = "safety_details"
    elif category == "safety":
        key = "safety_timeline"
    elif category == "parties":
        party_roles = [role for role in ("landlord", "employer", "seller", "sender") if role in value]
        key = f"parties_{'_'.join(party_roles) if party_roles else 'general'}"
    elif category == "evidence" and ("agreement" in value or "terms" in value):
        key = "evidence_agreement_terms"
    elif category == "evidence" and any(term in value for term in ("proof", "payment", "deposit")):
        key = "evidence_payment_records"
    elif category == "evidence":
        key = "evidence_records"
    else:
        key = category
    return category, key


def _has_any(value: str, terms: Iterable[str]) -> bool:
    """Match English tokens without treating words like “stated” as “state”."""
    for term in terms:
        if re.fullmatch(r"[a-z ]+", term):
            if re.search(rf"(?<![a-z]){re.escape(term)}(?![a-z])", value):
                return True
        elif term in value:
            return True
    return False


def _already_known(case_state: CaseState, category: str, source_text: str) -> bool:
    value = source_text.casefold()
    if category == "jurisdiction" and any((
        case_state.jurisdiction.country,
        case_state.jurisdiction.state,
        case_state.jurisdiction.district,
        case_state.jurisdiction.city,
        case_state.jurisdiction.locationText,
    )):
        return True
    if category == "dates" and any(event.date and event.datePrecision != "unknown" for event in case_state.events):
        return True
    if category == "objective" and case_state.intent is not None:
        return True
    if category == "parties":
        if "landlord" in value and any(party.role.casefold() == "landlord" and party.name for party in case_state.parties):
            return True
        if "employer" in value and any(party.role.casefold() == "employer" and party.name for party in case_state.parties):
            return True
    # A relevant uploaded document can satisfy an unknown whose text asks only
    # whether such a record exists. Narrative mentions do not count as uploads.
    if category == "evidence" and any(
        evidence.source == "document" and evidence.status in {"user_reported", "evidence_supported"}
        and _evidence_matches(evidence.title, value)
        for evidence in case_state.evidence
    ):
        return True
    return False


def _evidence_matches(title: str, unknown: str) -> bool:
    title_value = title.casefold()
    keywords = [
        word for word in re.findall(r"[a-z\u0900-\u097f]+", unknown.casefold())
        if len(word) > 4 and word not in {"whether", "records", "record", "available", "relevant", "evidence"}
    ]
    return bool(keywords) and any(word in title_value for word in keywords)


def _render_question(category: str, source_texts: tuple[str, ...], language: str) -> str:
    joined = " ".join(source_texts).casefold()
    if category == "jurisdiction":
        return {
            "english": "Where did the relevant event or issue happen? Share the city, district, state, or country you know.",
            "hindi": "यह घटना या मामला कहाँ हुआ था? जो जानकारी हो—शहर, ज़िला, राज्य या देश—बताएँ।",
            "hinglish": "Yeh incident ya matter kahan hua tha? Jo details pata hon—city, district, state, ya country—batayein.",
        }[language]
    if category == "dates":
        return {
            "english": "What dates and sequence are known for the relevant events? Approximate dates are fine if exact dates are not known.",
            "hindi": "संबंधित घटनाओं की तारीखें और क्रम क्या थे? सही तारीख याद न हो तो अनुमानित तारीख भी बता सकते हैं।",
            "hinglish": "Relevant events ki dates aur sequence kya tha? Exact date yaad na ho toh approximate date bata sakte hain.",
        }[language]
    if category == "parties":
        return _party_question(joined, language)
    if category == "objective":
        return {
            "english": "What would you like help with or hope to understand from this case?",
            "hindi": "आप इस मामले में किस बात को लेकर मदद चाहते हैं या क्या समझना चाहते हैं?",
            "hinglish": "Aap is matter mein kis cheez ke liye help chahte hain ya kya samajhna chahte hain?",
        }[language]
    if category == "evidence":
        if "agreement" in joined or "terms" in joined:
            return {
                "english": "Do you have the agreement or written terms mentioned here, and what do they say about this issue?",
                "hindi": "क्या आपके पास यहाँ बताए गए समझौते या लिखित शर्तें हैं? उनमें इस मामले के बारे में क्या लिखा है?",
                "hinglish": "Kya aapke paas yahan mention kiya gaya agreement ya written terms hain? Unmein is matter ke baare mein kya likha hai?",
            }[language]
        return {
            "english": "Which of the records, messages, or documents mentioned in these open points do you have, if any?",
            "hindi": "इन खुले बिंदुओं से जुड़े कौन-से रिकॉर्ड, संदेश या दस्तावेज़ आपके पास हैं, यदि कोई हों?",
            "hinglish": "In open points se jude kaun se records, messages, ya documents aapke paas hain, agar koi hain?",
        }[language]
    if category == "safety":
        if any(term in joined for term in ("immediate danger", "तत्काल खतरा")):
            return {
                "english": "Is anyone in immediate danger right now?",
                "hindi": "क्या अभी किसी को तत्काल खतरा है?",
                "hinglish": "Kya abhi kisi ko turant khatra hai?",
            }[language]
        if any(term in joined for term in ("specific words", "how often", "frequency", "specific threat", "शब्द", "कितनी बार")):
            return {
                "english": "What specific words were used, and how often did this happen?",
                "hindi": "कौन-से खास शब्द कहे गए थे, और यह कितनी बार हुआ?",
                "hinglish": "Kaun se specific words use hue, aur yeh kitni baar hua?",
            }[language]
        if "threat" not in joined and "धमकी" not in joined:
            return {
                "english": "Is there any immediate safety concern right now?",
                "hindi": "क्या अभी सुरक्षा को लेकर कोई तत्काल चिंता है?",
                "hinglish": "Kya abhi safety ko lekar koi turant concern hai?",
            }[language]
        return {
            "english": "Are the reported threats continuing now?",
            "hindi": "क्या बताई गई धमकियाँ अभी भी जारी हैं?",
            "hinglish": "Kya reported threats abhi bhi continue ho rahi hain?",
        }[language]
    if category == "other":
        context = source_texts[0]
        if any(term in joined for term in ("reason", "explanation", "कारण")):
            return {
                "english": "What reason or explanation, if any, was given for this?",
                "hindi": "इसके लिए क्या कारण या स्पष्टीकरण दिया गया था, यदि कोई?",
                "hinglish": "Iske liye kya reason ya explanation diya gaya tha, agar koi?",
            }[language]
        if "amount" in joined or "कितनी राशि" in context:
            return {
                "english": "What amount was paid or discussed?",
                "hindi": "कितनी राशि का भुगतान हुआ या चर्चा हुई थी?",
                "hinglish": "Kitni amount pay hui thi ya discuss hui thi?",
            }[language]
        return {
            "english": f"What can you share about this open point: “{context}”?",
            "hindi": f"इस खुले बिंदु के बारे में आप क्या बता सकते हैं: “{context}”?",
            "hinglish": f"Is open point ke baare mein aap kya bata sakte hain: “{context}”?",
        }[language]
    raise ValueError(f"unsupported clarification category: {category}")


def _party_question(source_text: str, language: str) -> str:
    if "suspected" in source_text or "संदेह" in source_text:
        return {
            "english": "Who is suspected of causing harm, and what happened that raised the concern?",
            "hindi": "किस पर नुकसान पहुँचाने का संदेह है, और किस घटना से यह चिंता हुई?",
            "hinglish": "Kis par harm karne ka suspicion hai, aur kis incident se yeh concern hua?",
        }[language]
    if "landlord" in source_text and "employer" in source_text:
        return {
            "english": "What are the landlord’s and employer’s names, if you know them?",
            "hindi": "मकान-मालिक और नियोक्ता के नाम क्या हैं, यदि आपको पता हों?",
            "hinglish": "Landlord aur employer ke naam kya hain, agar aapko pata hon?",
        }[language]
    if any(term in source_text for term in ("sender's role", "sender's role", "role and relationship", "role and relationship")):
        return {
            "english": "What was the sender’s role and relationship to the people or organization involved?",
            "hindi": "संदेश भेजने वाले की भूमिका और संबंधित लोगों या संस्था से क्या संबंध था?",
            "hinglish": "Message bhejne wale ka role aur involved logon ya organization se kya relation tha?",
        }[language]
    if "landlord" in source_text:
        return {
            "english": "What is the landlord’s name, if you know it?",
            "hindi": "मकान-मालिक का नाम क्या है, यदि आपको पता हो?",
            "hinglish": "Landlord ka naam kya hai, agar aapko pata ho?",
        }[language]
    if "employer" in source_text:
        return {
            "english": "What is the employer’s name, if you know it?",
            "hindi": "नियोक्ता का नाम क्या है, यदि आपको पता हो?",
            "hinglish": "Employer ka naam kya hai, agar aapko pata ho?",
        }[language]
    if "role" in source_text and "name" not in source_text:
        return {
            "english": "What role did each person or organization have?",
            "hindi": "हर व्यक्ति या संस्था की क्या भूमिका थी?",
            "hinglish": "Har person ya organization ka kya role tha?",
        }[language]
    return {
        "english": "Who are the other people or organizations involved, and what are their roles? Share names if known.",
        "hindi": "इसमें कौन-से अन्य लोग या संस्थाएँ शामिल हैं और उनकी क्या भूमिका है? नाम पता हों तो बताएँ।",
        "hinglish": "Ismein kaun se doosre log ya organizations involved hain, aur unka kya role hai? Naam pata hon toh batayein.",
    }[language]


def _target(category: str, source_texts: tuple[str, ...], group_key: str) -> str:
    if category == "safety":
        return {
            "safety": "safety.immediate_danger",
            "safety_details": "safety.threat_details",
            "safety_timeline": "safety.threat_timeline",
        }[group_key]
    if category == "parties":
        return f"parties.{group_key.removeprefix('parties_')}"
    if category == "evidence":
        return f"evidence.{group_key.removeprefix('evidence_')}"
    return {
        "jurisdiction": "jurisdiction.location",
        "dates": "events.dates_and_sequence",
        "objective": "intent.objective",
        "other": f"unknowns.{group_key}",
    }[category]


def _language(value: str | None) -> Literal["english", "hindi", "hinglish"]:
    normalized = (value or "english").strip().casefold()
    if normalized in {"hindi", "hi", "हिंदी"}:
        return "hindi"
    if normalized in {"hinglish", "hi-en", "hi_en"}:
        return "hinglish"
    return "english"


def _question_is_grounded(
    case_state: CaseState,
    question: ClarificationQuestion,
    journey_unknowns: Iterable[Any] | None,
) -> bool:
    journey_items = _journey_unknowns(case_state, journey_unknowns)
    known_journey = {
        _unknown_fields(item, case_state.id, index)[0]: _unknown_fields(item, case_state.id, index)[1:]
        for index, item in enumerate(journey_items)
    }
    grounded_sources: list[ClarificationSource] = []
    for source in question.sources:
        if source.source_type == "case_state":
            try:
                index = int(source.source_path.rsplit("/", 1)[1])
            except (ValueError, IndexError):
                return False
            if not (0 <= index < len(case_state.unknowns)) or _clean(case_state.unknowns[index]).casefold() != source.text.casefold():
                return False
            expected_id = _stable_id("case_unknown", case_state.id, str(index), source.text.casefold())
            if source.source_id != expected_id or source.priority != "normal" or source.related_to is not None:
                return False
        else:
            current = known_journey.get(source.source_id)
            if current is None or current[0].casefold() != source.text.casefold():
                return False
            if source.priority != current[1] or source.related_to != current[2]:
                return False
        grounded_sources.append(source)

    if not grounded_sources:
        return False
    categories_and_groups = {
        _classify(source.text, source.related_to) for source in grounded_sources
    }
    if len(categories_and_groups) != 1:
        return False
    category, group_key = next(iter(categories_and_groups))
    source_texts = tuple(dict.fromkeys(source.text for source in _unique_sources(grounded_sources)))
    expected_id = _stable_id(
        "clarification",
        case_state.id,
        group_key,
        "\x1e".join(sorted(text.casefold() for text in source_texts)),
    )
    return (
        question.category == category
        and question.id == expected_id
        and question.target == _target(category, source_texts, group_key)
        and question.question == _render_question(category, source_texts, question.language)
    )


def _fact_question_id(fact: CaseFact) -> str | None:
    match = re.search(r"(?:^|;\s*)clarificationQuestionId=([^;]+)", fact.notes or "")
    return match.group(1) if match else None


def _source_already_answered(case_state: CaseState, source_id: str) -> bool:
    for fact in case_state.facts:
        match = re.search(r"(?:^|;\s*)sourceUnknownIds=([^;]*)", fact.notes or "")
        if match and source_id in match.group(1).split(","):
            return True
    return False


def _stable_id(kind: str, *parts: str) -> str:
    payload = "\x1f".join((kind, *parts)).encode("utf-8")
    return f"{kind}_{hashlib.sha256(payload).hexdigest()[:16]}"


def _clean(value: str) -> str:
    return " ".join(value.split()).strip()
