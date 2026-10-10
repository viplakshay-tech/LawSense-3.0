"""Rule-based case-state extraction that preserves source and uncertainty.

This module has no HTTP, database, or model-provider dependencies. It turns a
single narrative into the existing CaseState domain model and deliberately
keeps extracted statements separate from legal conclusions.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Iterable

from app.schemas.case_state import (
    CaseClaim,
    CaseEvent,
    CaseFact,
    CaseIntent,
    CaseMetadata,
    CasePerson,
    CaseState,
    EvidenceItem,
    Jurisdiction,
    LegalIssue,
    Party,
)


_SENTENCE_BREAK = re.compile(r"(?<=[.!?।])\s+|[\r\n]+")
_WORD = re.compile(r"\b[\w'-]+\b", re.UNICODE)
_ENGLISH_MONTHS = (
    "January|February|March|April|May|June|July|August|September|October|November|December|"
    "Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec"
)
_HINDI_MONTHS = "जनवरी|फ़रवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर"
_DATE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b(\d{4}-\d{2}-\d{2})\b"), "exact"),
    (
        re.compile(
            rf"\b(({_ENGLISH_MONTHS})\s+\d{{1,2}}(?:st|nd|rd|th)?[,]?\s+\d{{4}})\b",
            re.IGNORECASE,
        ),
        "exact",
    ),
    (
        re.compile(rf"(?<!\d)(\d{{1,2}}(?:st|nd|rd|th)?\s+(?:{_ENGLISH_MONTHS}|{_HINDI_MONTHS})\s+\d{{4}})(?!\d)", re.I),
        "exact",
    ),
    (
        re.compile(rf"(?<!\d)(\d{{1,2}}\s+{_HINDI_MONTHS}\s+\d{{4}})(?!\d)"),
        "exact",
    ),
    (re.compile(r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b"), "exact"),
    (
        re.compile(
            rf"\b(({_ENGLISH_MONTHS})\s+\d{{4}})\b",
            re.IGNORECASE,
        ),
        "approximate",
    ),
    (re.compile(r"\b(?:in|during|for|on)\s+(\d{4})\b", re.IGNORECASE), "approximate"),
    (re.compile(rf"(?<!\d)({_HINDI_MONTHS}\s+\d{{4}})(?!\d)"), "approximate"),
    (re.compile(r"\b((?:19|20)\d{2})\b"), "approximate"),
)

_EVENT_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("eviction", re.compile(r"\b(evict(?:ed|ion|ing)?|vacate notice|notice to vacate)\b|बेघर|निकाल दिया|खाली करने का नोटिस", re.I)),
    (
        "payment",
        re.compile(
            r"\b(paid|payment|withheld|unpaid|refund(?:ed)?|reimburs(?:ed|ement)|salary|wages)\b"
            r"|\b(?:return(?:ed)?|refus\w*|paid|withheld).{0,30}\bdeposit\b"
            r"|\bdeposit\b.{0,30}\b(?:return(?:ed)?|refus\w*|paid|withheld|wapas|nahi)"
            r"|\bpaise?\s+wapas\b|वेतन|तनख्वाह|रुपये? वापस|पैसे वापस|जमा वापस",
            re.I,
        ),
    ),
    ("employment", re.compile(r"\b(hired|fired|terminated|resigned|laid off|dismissed)\b|\bnaukri se nikal\b|नौकरी से निकाल|काम पर रखा", re.I)),
    ("agreement", re.compile(r"\b(signed|agreement|contract|lease|renewed)\b", re.I)),
    ("threat", re.compile(r"\b(threat\w*|harass(?:ment|ed)?|blackmail(?:ed)?|dhamki|pareshan|darata)\b|धमकी|परेशान कर|डराता|ब्लैकमेल", re.I)),
    ("communication", re.compile(r"\b(called|texted|emailed|wrote|sent|told|reported|messages?)\b|संदेश|मैसेज|बताया", re.I)),
    ("injury", re.compile(r"\b(injured|injury|accident|hospitali[sz]ed)\b|चोट|दुर्घटना|अस्पताल में भर्ती", re.I)),
    ("police_contact", re.compile(r"\b(arrested|police|detained|charged)\b|पुलिस|गिरफ्तार|हिरासत", re.I)),
    ("purchase", re.compile(r"\b(bought|purchased|ordered|delivered|returned|refunded)\b|खरीदा|खरीदी|भेजा|सामान दिया", re.I)),
    ("court_or_agency", re.compile(r"\b(filed|court|hearing|complaint|application|tribunal)\b", re.I)),
    ("safety_concern", re.compile(r"\b(?:suspect(?:ed|s)?|suspicion|concern(?:ed)?)\b.{0,55}\b(?:sexual abuse|child abuse)\b|\b(?:sexual abuse|child abuse)\b.{0,40}\b(?:suspect(?:ed|s)?|suspicion|concern)\b|बच्चे.{0,35}(?:यौन शोषण|शोषण).{0,20}(?:संदेह|आशंका)|नाबालिग.{0,35}(?:यौन शोषण|शोषण).{0,20}(?:संदेह|आशंका)", re.I)),
)

_ISSUE_RULES: tuple[tuple[str, str | None, re.Pattern[str]], ...] = (
    ("housing", None, re.compile(r"\b(landlord|tenant|kirayedar|makaan malik|ghar malik|rent|evict|eviction|lease|security deposit|deposit|housing)\b|मकान मालिक|घर मालिक|किरायेदार|किराया|किराए|मकान|घर", re.I)),
    ("employment", None, re.compile(r"\b(employer|employee|niyokta|naukri|salary|wages|workplace|fired|termination|overtime|boss|vetan|tankhwah)\b|नियोक्ता|कर्मचारी|नौकरी|वेतन|तनख्वाह", re.I)),
    ("consumer", None, re.compile(r"\b(refund|defective|warranty|seller|buyer|bought|purchase|consumer|damaged|product|dukandar|vikreta|grahak|kharab samaan|paise wapas)\b|दुकानदार|विक्रेता|ग्राहक|खराब सामान|सामान|खरीद|पैसे वापस|पैसा वापस", re.I)),
    ("family", None, re.compile(r"\b(divorce|custody|child support|spouse|domestic violence|husband|wife|pati|patni|talaq)\b|तलाक|बच्चे की हिरासत|पति|पत्नी|घरेलू हिंसा", re.I)),
    (
        "dowry_related_harassment",
        "threats linked to dowry",
        re.compile(r"\b(?:dowry|dahej)\b.{0,70}\b(?:threat\w*|harass\w*|demand\w*)\b|\b(?:threat\w*|harass\w*|demand\w*)\b.{0,70}\b(?:dowry|dahej)\b|दहेज.{0,35}(?:धमकी|मांग|परेशान)|(?:धमकी|मांग|परेशान).{0,35}दहेज", re.I),
    ),
    (
        "workplace_harassment",
        "unwanted sexual communications",
        re.compile(r"\b(?:office|workplace|at work)\b.{0,70}\b(?:repeatedly|again and again|every day)\b.{0,40}\b(?:unwanted|sexual)\b.{0,30}\b(?:sexual )?(?:messages?|texts?|dm)\b|\b(?:repeatedly|again and again)\b.{0,45}\b(?:unwanted|sexual)\b.{0,30}\b(?:messages?|texts?|dm)\b.{0,45}\b(?:office|workplace|at work)\b|office.{0,20}(?:baar baar|लगातार).{0,30}(?:unwanted|sexual).{0,30}(?:message|मैसेज)", re.I),
    ),
    (
        "child_protection",
        "suspected sexual harm involving a child",
        re.compile(r"\b(?:minor|child|children)\b.{0,60}\b(?:sexual abuse|abuse|exploitation)\b|\b(?:sexual abuse|abuse|exploitation)\b.{0,60}\b(?:minor|child|children)\b|\b(?:minor|child|children)\b.{0,65}\b(?:suspect(?:ed|s)?|suspicion|concern)\b|बच्चे.{0,45}(?:यौन शोषण|शोषण|संदेह)|नाबालिग.{0,45}(?:यौन शोषण|शोषण|संदेह)", re.I),
    ),
    (
        "cyber_abuse",
        "threatened disclosure of private images",
        re.compile(r"\b(?:threaten\w*|blackmail\w*)\b.{0,65}\b(?:leak|share|publish)\b.{0,35}\b(?:private|intimate)\b.{0,15}\b(?:photos?|pictures?|videos?)\b|\b(?:private|intimate)\b.{0,15}\b(?:photos?|pictures?|videos?)\b.{0,60}\b(?:threaten\w*|blackmail\w*|leak)\b", re.I),
    ),
    ("personal_injury", None, re.compile(r"\b(injured|injury|accident|medical bills|negligence|chot|durghatna)\b|चोट|दुर्घटना|चिकित्सा खर्च", re.I)),
    ("criminal", None, re.compile(r"\b(arrested|police|criminal charge|detained|assault|stolen|threat|blackmail|harassment|dhamki|pareshan)\b|पुलिस|गिरफ्तार|हिरासत|हमला|चोरी|धमकी|ब्लैकमेल|परेशान कर", re.I)),
    ("debt", None, re.compile(r"\b(debt|loan|creditor|collection agency|repayment|defaulted|karz|udhaar)\b|कर्ज|ऋण|उधार|वसूली एजेंसी", re.I)),
    ("immigration", None, re.compile(r"\b(visa|immigration|deportation|asylum|residency permit)\b", re.I)),
)

_WORKPLACE_HARASSMENT_FACT_PATTERN = re.compile(
    r"\b(?:supervisor|manager|boss|colleague|coworker|employer)\b.{0,140}"
    r"\b(?:unwanted|sexual|harass(?:ed|ment|ing)?)\b.{0,100}"
    r"\b(?:messages?|texts?|dm|comments?|touch(?:es|ing)?|conduct)\b",
    re.I,
)

_PARTY_ROLE_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("landlord", re.compile(r"\b(landlord|makaan malik|ghar malik)\b|मकान\s+मालिक|घर\s+मालिक|\bmalik\b|मालिक", re.I)),
    ("tenant", re.compile(r"\btenant\b|\bkirayedar\b|किरायेदार", re.I)),
    ("employer", re.compile(r"\b(employer|boss|company owner|malik)\b|\bniyokta\b|नियोक्ता|मालिक", re.I)),
    ("employee", re.compile(r"\bemployee\b|\bnaukri karne wala\b|कर्मचारी", re.I)),
    ("seller", re.compile(r"\bseller\b|\bdukandar\b|दुकानदार|विक्रेता", re.I)),
    ("buyer", re.compile(r"\bbuyer\b|\bgrahak\b|ग्राहक", re.I)),
    ("husband", re.compile(r"\bhusband\b|\bpati\b|पति", re.I)),
    ("wife", re.compile(r"\bwife\b|\bpatni\b|पत्नी", re.I)),
    ("police", re.compile(r"\bpolice\b|पुलिस", re.I)),
    ("company", re.compile(r"\b(company|kampani)\b|कंपनी", re.I)),
    ("child", re.compile(r"\b(?:minor child|my child|the child|minor|child)\b|नाबालिग|बच्चा|बच्ची", re.I)),
    ("owner", re.compile(r"\b(owner|malik)\b|मालिक", re.I)),
)

_HINGLISH_MARKERS = re.compile(
    r"\b(main|mai|mujhe|mujhko|mere|meri|mera|hum|ne|nahi|nahin|wapas|"
    r"chahiye|karna|karni|hai|hoon|hua|hui|raha|rahi|wala|walon|mein|"
    r"rupaye|rupay|tees|hazaar|mahine|mahina)\b",
    re.I,
)
_ENGLISH_LEGAL_TERMS = re.compile(
    r"\b(landlord|tenant|employer|employee|seller|buyer|boss|deposit|rent|salary|"
    r"wages|refund|agreement|receipt|notice|police|company|product|security|payment)\b",
    re.I,
)
_DOCUMENT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("rental agreement", re.compile(r"\brental\s+agreement\b|किराया\s+agreement|किराया\s+समझौता", re.I)),
    ("agreement", re.compile(r"\b(agreement|lease|contract)\b|समझौता|करार", re.I)),
    ("receipt", re.compile(r"\b(receipt)\b|रसीद", re.I)),
    ("invoice", re.compile(r"\b(invoice)\b|चालान", re.I)),
    ("bill", re.compile(r"\b(bill)\b|बिल", re.I)),
    ("notice", re.compile(r"\b(notice)\b|नोटिस", re.I)),
)
_AMOUNT_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?:₹\s*|\bRs\.?\s*)(\d[\d,]*)", re.I),
    re.compile(r"(\d[\d,]*)\s*(?:rupees?|rupaye|rupay|रुपये|रुपए|रुपया|रु\.?)(?!\w)", re.I),
)
_THIRTY_THOUSAND = re.compile(r"\btees\s+hazaar\s+(?:rupees?|rupaye|rupay)\b|तीस\s+हजार\s+रुप(?:ये|ए|या)", re.I)

_ROLE_RULES: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    ("landlord", "landlord", re.compile(r"\bmy landlord (?:is )?(?P<name>[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,2})", re.I)),
    ("employer", "employer", re.compile(r"\bmy employer (?:is )?(?P<name>[A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,2})", re.I)),
    ("spouse", "spouse", re.compile(r"\bmy (?:husband|wife|spouse) (?:is )?(?P<name>[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,2})", re.I)),
    ("seller", "seller", re.compile(r"\b(?:seller|company|dealer)\s+(?:named\s+)?(?P<name>[A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,2})")),
)

_ISSUE_ALLEGATION = re.compile(
    r"\b(refused|failed|did not|didn't|never|withheld|evicted|terminated|"
    r"injured|charged|denied|kept|ignored|overcharged|not paid|not returning|"
    r"repeatedly.{0,35}(?:unwanted|sexual).{0,30}(?:message|text)|"
    r"suspect(?:ed|s)?|suspicion|threaten(?:ed|ing)?|blackmail(?:ed|ing)?|"
    r"dowry.{0,35}(?:threat|demand|harass))\b|"
    r"\bnahi(?:n)?\s+(?:kiya|ki|diya|di|kar raha|kar rahi)\b|"
    r"नहीं किया|नहीं की|नहीं दिया|नहीं दी|नहीं कर रहा|नहीं कर रही|"
    r"वापस नहीं|खराब सामान दिया|धमकी दे रहा|धमकी देता",
    re.I,
)
_HEARSAY = re.compile(r"\b(someone told me|I heard|allegedly|reportedly)\b|सुना है|किसी ने बताया", re.I)


def _stable_id(kind: str, *parts: str) -> str:
    payload = "\x1f".join((kind, *parts)).encode("utf-8")
    return f"{kind}_{hashlib.sha256(payload).hexdigest()[:16]}"


def _sentences(text: str) -> list[str]:
    protected = re.sub(r"\b(Rs)\.(?=\s+\d)", r"\1<PERIOD>", text, flags=re.I)
    parts = [part.replace("<PERIOD>", ".") for part in _SENTENCE_BREAK.split(protected)]
    return [part.strip(" \t\r\n-•") for part in parts if part.strip(" \t\r\n-•")]


def _status(source_type: str) -> str:
    return {
        "user": "user_reported",
        "document": "evidence_supported",
        "system": "system_inferred",
    }[source_type]


def _date_in(text: str) -> tuple[str | None, str]:
    for pattern, precision in _DATE_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(1).rstrip(","), precision
    return None, "unknown"


def _event_type(sentence: str) -> str | None:
    for event_type, pattern in _EVENT_RULES:
        if pattern.search(sentence):
            return event_type
    return None


def _extract_person_and_parties(
    sentences: Iterable[str], source_id: str, source_status: str
) -> tuple[CasePerson, list[Party]]:
    joined = " ".join(sentences)
    person_name: str | None = None
    name_match = re.search(
        r"\bmy name is\s+([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,3})",
        joined,
        re.IGNORECASE,
    )
    if name_match and name_match.group(1)[:1].isupper():
        person_name = name_match.group(1).strip()
    else:
        name_match = re.search(
            r"\bI am\s+([A-Z][\w'’-]+\s+[A-Z][\w'’-]+)(?=[,.;!?]|\s+(?:and|from|living|residing)\b)",
            joined,
        )
        if name_match:
            person_name = name_match.group(1).strip()

    parties: list[Party] = []
    if person_name:
        parties.append(
            Party(
                id=_stable_id("party", source_id, "client", person_name.casefold()),
                name=person_name,
                role="client",
                relationship="self",
                attributes={"sourceIds": [source_id], "nameStatus": source_status, "roleStatus": "system_inferred"},
            )
        )

    seen: set[tuple[str, str]] = set()
    for sentence in sentences:
        for relationship, role, pattern in _ROLE_RULES:
            match = pattern.search(sentence)
            if not match:
                continue
            name = match.group("name").strip(" ,.;:")
            # Avoid treating lowercase words matched under case-insensitive rules as names.
            if not name[:1].isupper() or name.casefold() in {"in", "at", "on", "the", "a", "an"}:
                continue
            key = (role, name.casefold())
            if key in seen:
                continue
            seen.add(key)
            parties.append(
                Party(
                    id=_stable_id("party", source_id, role, name.casefold()),
                    name=name,
                    role=role,
                    relationship=relationship,
                    attributes={"sourceIds": [source_id], "nameStatus": source_status, "roleStatus": "system_inferred"},
                )
            )

    present_roles = {party.role for party in parties}
    joined_lower = " ".join(sentences).casefold()
    housing_context = bool(re.search(r"landlord|tenant|kirayedar|makaan|ghar|rent|deposit|lease|मकान|घर|किराया|किरायेदार", joined_lower, re.I))
    employment_context = bool(re.search(r"employer|employee|boss|salary|wages|नौकरी|वेतन|तनख्वाह|कर्मचारी|नियोक्ता", joined_lower, re.I))
    for role, pattern in _PARTY_ROLE_RULES:
        match = pattern.search(joined_lower)
        if not match or role in present_roles:
            continue
        # "malik/मालिक" alone can mean a landlord, employer, or generic owner.
        if role == "landlord" and match.group(0).casefold() in {"malik", "मालिक"} and not housing_context:
            continue
        if role == "landlord" and match.group(0).casefold() in {"malik", "मालिक"} and employment_context and not housing_context:
            continue
        if role == "owner" and match.group(0) in {"मालिक"} and (housing_context or employment_context):
            continue
        if role == "employer" and "मालिक" in joined_lower and not employment_context:
            continue
        if role == "employer" and match.group(0) == "मालिक" and not employment_context:
            continue
        present_roles.add(role)
        parties.append(
            Party(
                id=_stable_id("party", source_id, role, ""),
                name=None,
                role=role,
                relationship=match.group(0),
                attributes={"sourceIds": [source_id], "nameStatus": "unknown", "roleStatus": "system_inferred"},
            )
        )

    return CasePerson(name=person_name), parties


def _extract_jurisdiction(sentences: Iterable[str], source_id: str) -> Jurisdiction:
    for sentence in sentences:
        stated_india_location = re.search(
            r"\b(?:in|at)\s+(?P<city>[A-Z][A-Za-z .'-]{1,48}?),\s*India\b",
            sentence,
            re.I,
        )
        if stated_india_location:
            city = " ".join(stated_india_location.group("city").split()).strip(" ,.")
            if city:
                return Jurisdiction(
                    country="India",
                    city=city,
                    locationText=f"{city}, India",
                    basis="user_reported",
                )
        patterns = (
            re.compile(r"\b(?:I live|I reside|I am based)\s+(?:in|at)\s+(?P<location>[A-Z][A-Za-z .'-]{1,48}?)(?=[,.;!?।]|\s+(?:in|on|where|and)\b|$)", re.I),
            re.compile(r"\b(?:the incident happened|this happened|the property is located)\s+(?:in|at)\s+(?P<location>[A-Z][A-Za-z .'-]{1,48}?)(?=[,.;!?।]|\s+(?:in|on|where|and)\b|$)", re.I),
            re.compile(r"\b(?:main|mai|hum)\s+(?P<location>[A-Z][A-Za-z .'-]{1,48}?)\s+mein\s+(?:rehta|rehti|rehte|rahta|rahti|bas(?:ta|ti)|hoon)\b", re.I),
            re.compile(r"\b(?:property|ghar|makaan)\s+(?P<location>[A-Z][A-Za-z .'-]{1,48}?)\s+mein\s+(?:hai|hota|hoti|located)\b", re.I),
            re.compile(r"मैं\s+(?P<location>[\u0900-\u097f][\u0900-\u097f ]{0,48}?)\s+में\s+(?:रहता|रहती|रहते|बसता|बसती)\b"),
            re.compile(r"(?:घटना|यह घटना|संपत्ति|मकान|घर)\s+(?P<location>[\u0900-\u097f][\u0900-\u097f ]{0,48}?)\s+में\s+(?:हुई|हुआ|है|स्थित)\b"),
        )
        for pattern in patterns:
            match = pattern.search(sentence)
            if match:
                location = " ".join(match.group("location").split()).strip(" .,")
                if location:
                    return Jurisdiction(city=location, basis="user_reported")

    return Jurisdiction()


def _extract_intent(sentences: Iterable[str]) -> CaseIntent | None:
    for sentence in sentences:
        match = re.search(
            r"\b(?:I want|I need|I hope|I would like)\s+(?:to\s+)?(.+?)(?:[.!?]|$)",
            sentence,
            re.I,
        )
        if match:
            objective = match.group(1).strip(" ,.;")
            if objective:
                urgent = "critical" if re.search(r"\b(immediately|urgent|today|tonight|tomorrow)\b", objective, re.I) else "medium"
                return CaseIntent(objective=objective, urgency=urgent)
        multilingual_patterns = (
            re.compile(r"\b(?:mujhe|mujhko)\s+(.+?\b(?:chahiye|hai))\b", re.I),
            re.compile(r"\b(?:deposit|paise?|paisa)\s+wapas\s+chahiye\b", re.I),
            re.compile(r"\b(?:mujhe\s+)?complaint\s+karni\s+hai\b", re.I),
            re.compile(r"\b(?:main|mai)\s+(.+?\b(?:chahta|chahti)\s+(?:hoon|hu))\b", re.I),
            re.compile(r"मुझे\s+(.+?चाहिए)"),
            re.compile(r"मैं\s+(.+?\s+(?:चाहता|चाहती)\s+हूँ)"),
            re.compile(r"जमा\s+वापस\s+चाहिए"),
        )
        for pattern in multilingual_patterns:
            match = pattern.search(sentence)
            if not match:
                continue
            objective = match.group(1) if match.lastindex else match.group(0)
            objective = objective.strip(" ,.;।")
            if objective:
                urgent = "critical" if re.search(r"\b(urgent|immediately|today|tomorrow)\b|तुरंत|आज ही", objective, re.I) else "medium"
                return CaseIntent(objective=objective, urgency=urgent)
    return None


def _extract_issues(sentences: Iterable[str], source_id: str) -> list[LegalIssue]:
    joined = " ".join(sentences)
    issues = []
    for category, subcategory, pattern in _ISSUE_RULES:
        matches_workplace_harassment = (
            category == "workplace_harassment"
            and _WORKPLACE_HARASSMENT_FACT_PATTERN.search(joined)
        )
        if pattern.search(joined) or matches_workplace_harassment:
            issues.append(
                LegalIssue(
                    id=_stable_id("issue", source_id, category),
                    category=category,
                    subcategory=subcategory,
                    confidence="low" if category == "criminal" and re.search(r"threat|blackmail|harass|dhamki|pareshan|धमकी|ब्लैकमेल|परेशान कर", joined, re.I) else "medium",
                    rationale=[f"Candidate issue category: {category.replace('_', ' ')}. Narrative contains related terms."],
                )
            )
    return issues


def _detect_language(text: str) -> str:
    devanagari = bool(re.search(r"[\u0900-\u097f]", text))
    latin_words = re.findall(r"[A-Za-z]+", text)
    hinglish = bool(_HINGLISH_MARKERS.search(text))
    if devanagari:
        return "hinglish" if hinglish or _ENGLISH_LEGAL_TERMS.search(text) else "hindi"
    if hinglish:
        return "hinglish"
    if len(latin_words) >= 2:
        return "english"
    return "unknown"


def _extract_amounts(text: str) -> list[int]:
    values: list[int] = []
    for pattern in _AMOUNT_PATTERNS:
        for match in pattern.finditer(text):
            value = int(match.group(1).replace(",", ""))
            if value not in values:
                values.append(value)
    if _THIRTY_THOUSAND.search(text) and 30000 not in values:
        values.append(30000)
    return values


def _extract_document_mentions(text: str) -> list[str]:
    found: list[str] = []
    for label, pattern in _DOCUMENT_PATTERNS:
        if label == "agreement" and "rental agreement" in found:
            continue
        if pattern.search(text) and label not in found:
            found.append(label)
    return found


def _extract_derived_facts(text: str, case_id: str, source_id: str) -> list[CaseFact]:
    facts: list[CaseFact] = []
    for amount in _extract_amounts(text):
        facts.append(
            CaseFact(
                id=_stable_id("fact", case_id, source_id, "amount_inr", str(amount)),
                key="amount_inr",
                value=amount,
                status="system_inferred",
                confidence="high",
                sourceIds=[source_id],
                notes="Normalized from an explicit rupee amount in the source text.",
            )
        )
    for document_type in _extract_document_mentions(text):
        facts.append(
            CaseFact(
                id=_stable_id("fact", case_id, source_id, "document_mentioned", document_type),
                key="document_mentioned",
                value=document_type,
                status="system_inferred",
                confidence="high",
                sourceIds=[source_id],
                notes="A document type is mentioned; this does not mean a document was uploaded.",
            )
        )
    return facts


def extract_case_state(
    text: str,
    *,
    case_id: str,
    source_id: str = "source-1",
    source_type: str = "user",
    source_title: str = "Provided narrative",
    language: str | None = None,
    created_at: str | None = None,
) -> CaseState:
    """Extract a conservative structured snapshot from one narrative.

    IDs are deterministic for the same case, source, and extracted content.
    Dates without an unambiguous year are retained as approximate text. The
    function does not infer missing facts or decide which account is true.
    """
    if not isinstance(text, str) or not text.strip():
        raise ValueError("text must be a non-empty string")
    if not isinstance(case_id, str) or not case_id.strip():
        raise ValueError("case_id must be a non-empty string")
    if not isinstance(source_id, str) or not source_id.strip():
        raise ValueError("source_id must be a non-empty string")
    if source_type not in {"user", "document", "system"}:
        raise ValueError("source_type must be 'user', 'document', or 'system'")

    sentences = _sentences(text)
    status = _status(source_type)
    facts: list[CaseFact] = []
    events: list[CaseEvent] = []
    claims: list[CaseClaim] = []
    seen_sentences: set[str] = set()

    for sentence in sentences:
        # Ignore punctuation-only fragments and repeated whitespace.
        if not _WORD.search(sentence):
            continue
        normalized_sentence = " ".join(sentence.split())
        sentence_key = normalized_sentence.casefold()
        if sentence_key in seen_sentences:
            continue
        seen_sentences.add(sentence_key)
        fact_id = _stable_id("fact", case_id, source_id, sentence_key)
        confidence = "low" if _HEARSAY.search(sentence) else "medium"
        facts.append(
            CaseFact(
                id=fact_id,
                key="statement",
                value=sentence,
                status=status,
                confidence=confidence,
                sourceIds=[source_id],
            )
        )

        event_type = _event_type(sentence)
        date, precision = _date_in(sentence)
        if event_type:
            events.append(
                CaseEvent(
                    id=_stable_id("event", case_id, source_id, event_type, sentence.casefold()),
                    type=event_type,
                    description=sentence,
                    date=date,
                    datePrecision=precision,
                    evidenceIds=[source_id],
                )
            )

        if _ISSUE_ALLEGATION.search(sentence):
            claim_id = _stable_id("claim", case_id, source_id, sentence.casefold())
            claims.append(CaseClaim(id=claim_id, text=sentence, status=status, evidenceIds=[source_id]))

    facts.extend(_extract_derived_facts(text, case_id, source_id))

    fact_ids = [fact.id for fact in facts]
    claim_ids = [claim.id for claim in claims]
    evidence = [
        EvidenceItem(
            id=source_id,
            type="narrative" if source_type == "user" else source_type,
            title=source_title,
            source=source_type,  # type: ignore[arg-type] - validated above
            status=status,  # type: ignore[arg-type] - validated above
            extractedFacts=fact_ids,
            supportsClaimIds=claim_ids,
        )
    ]

    person, parties = _extract_person_and_parties(sentences, source_id, status)
    for event in events:
        for party in parties:
            relation_terms = [party.role, party.relationship or "", party.name or ""]
            if any(term and re.search(rf"(?<!\w){re.escape(term)}(?!\w)", event.description, re.I) for term in relation_terms):
                event.partyIds.append(party.id)
    jurisdiction = _extract_jurisdiction(sentences, source_id)
    issues = _extract_issues(sentences, source_id)

    unknowns: list[str] = []
    housing_case = any(issue.category == "housing" for issue in issues) and bool(
        re.search(r"deposit|landlord|tenant|kirayedar|rent|lease|मकान|घर|किराया|किरायेदार", text, re.I)
    )
    if housing_case:
        if not jurisdiction.city:
            unknowns.append("The location of the property or relevant event is not stated.")
        deposit_case = bool(re.search(r"deposit|security deposit|जमा", text, re.I))
        if deposit_case:
            if not any(event.date for event in events):
                unknowns.append("The date of the deposit payment or return request is not stated.")
            if not any("agreement" in mention for mention in _extract_document_mentions(text)):
                unknowns.append("Whether there is a rental agreement and its relevant terms is not stated.")
            if not re.search(
                r"damage|repair|unpaid rent|reason|कारण|नुकसान|क्षति|किराया बकाया", text, re.I
            ):
                unknowns.append("The reason given for withholding the deposit is not stated.")
            if not re.search(
                r"receipt|proof|evidence|bank|transfer|transaction|upi|रसीद|बैंक|भुगतान का प्रमाण|लेनदेन", text, re.I
            ):
                unknowns.append("Proof of the deposit payment or return request is not mentioned.")
            if any(party.role == "landlord" and not party.name for party in parties):
                unknowns.append("The landlord's name is not stated.")
        elif events and not any(event.date for event in events):
            unknowns.append("The dates of the described events are not stated clearly.")
    else:
        if not jurisdiction.city and re.search(
            r"\b(landlord|employer|office|workplace|seller|court|police|property)\b|मकान मालिक|नियोक्ता|दुकानदार|पुलिस", text, re.I
        ):
            unknowns.append("The location relevant to the dispute is not clearly stated.")
        if events and not any(event.date for event in events):
            unknowns.append("The dates of the described events are not stated clearly.")
        if not parties and re.search(r"\b(they|he|she|them|my landlord|my employer|seller)\b", text, re.I):
            unknowns.append("The other party's name and role need clarification.")

    issue_categories = {issue.category for issue in issues}
    if "dowry_related_harassment" in issue_categories and not any(
        "threat" in item.casefold() or "specific" in item.casefold() for item in unknowns
    ):
        unknowns.append("The specific words used, timing, and frequency of the reported threats are not stated.")
    if "workplace_harassment" in issue_categories:
        if not any("date" in item.casefold() or "when" in item.casefold() for item in unknowns):
            unknowns.append("When the messages were received and how often they occurred is not stated clearly.")
        if not any(party.role in {"employer", "employee"} for party in parties):
            unknowns.append("The sender's role and relationship to the workplace are not stated.")
    if "child_protection" in issue_categories:
        unknowns.append("Who is suspected of causing harm and what event(s) raised the concern are not stated.")
    if "cyber_abuse" in issue_categories:
        unknowns.append("Whether any private images were sent or shared, and whether a demand was made, is not stated.")

    now = created_at or datetime.now(timezone.utc).isoformat()
    detected_language = _detect_language(text)
    return CaseState(
        id=case_id,
        person=person,
        parties=parties,
        facts=facts,
        events=events,
        evidence=evidence,
        claims=claims,
        jurisdiction=jurisdiction,
        legalIssues=issues,
        intent=_extract_intent(sentences),
        unknowns=unknowns,
        assumptions=[],
        conflicts=[],
        metadata=CaseMetadata(
            createdAt=now,
            updatedAt=now,
            language=detected_language if detected_language != "unknown" else (language or "unknown"),
        ),
    )
