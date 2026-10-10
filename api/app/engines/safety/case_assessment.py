"""Case-aware safety context built from the canonical case narrative and links."""

from __future__ import annotations

import re

from app.schemas.case_state import CaseState

from .detector import _sentences, detect_safety_context
from .models import SafetyAssessment, SafetyCategory, SafetyIndicator, SafetyUrgency


_WORKPLACE_SEXUAL_MESSAGES = re.compile(
    r"\b(?:office|workplace|at work)\b.{0,70}"
    r"\b(?:repeatedly|again and again|every day|baar baar)\b.{0,40}"
    r"\b(?:unwanted|sexual)\b.{0,30}\b(?:sexual )?(?:messages?|texts?|dm)\b|"
    r"\b(?:repeatedly|again and again|baar baar)\b.{0,55}"
    r"\b(?:unwanted|sexual)\b.{0,30}\b(?:messages?|texts?|dm)\b.{0,45}"
    r"\b(?:office|workplace|at work)\b",
    re.I,
)
_CHILD_SEXUAL_HARM_CONCERN = re.compile(
    r"\b(?:minor|child|children)\b.{0,60}"
    r"\b(?:sexual abuse|abuse|exploitation)\b.{0,45}"
    r"\b(?:suspect(?:ed|s)?|suspicion|concern|possible)\b|"
    r"\b(?:suspect(?:ed|s)?|suspicion|concern|possible)\b.{0,45}"
    r"\b(?:sexual abuse|child abuse|abuse of (?:a )?(?:minor|child))\b.{0,35}"
    r"\b(?:minor|child|children)\b|"
    r"नाबालिग.{0,50}(?:यौन शोषण|शोषण).{0,30}(?:संदेह|आशंका)|"
    r"बच्चे.{0,50}(?:यौन शोषण|शोषण).{0,30}(?:संदेह|आशंका)",
    re.I,
)
_DOWRY_TERMS = re.compile(r"\b(?:dowry|dahej)\b|दहेज", re.I)


def detect_case_safety_context(case_state: CaseState) -> SafetyAssessment:
    """Assess possible safety indicators while retaining source and uncertainty.

    Composite checks require several contextual elements to occur together.
    They flag a possible concern only; none is a finding that conduct occurred
    or that a legal test has been met.
    """

    if not isinstance(case_state, CaseState):
        raise TypeError("case_state must be a CaseState")
    statement = case_state.initialStatement
    if not statement or not statement.strip():
        raise ValueError("CaseState must retain a non-empty initialStatement")

    baseline = detect_safety_context(statement)
    extra: list[SafetyIndicator] = []
    for sentence in _sentences(statement):
        workplace_match = _WORKPLACE_SEXUAL_MESSAGES.search(sentence)
        if workplace_match:
            extra.append(SafetyIndicator(
                category="workplace_sexual_harassment_concern",
                confidence="medium",
                matched_text=workplace_match.group(0),
                source_text=sentence,
            ))

        child_match = _CHILD_SEXUAL_HARM_CONCERN.search(sentence)
        child_is_linked = any(
            party.role.casefold() == "child"
            or (party.relationship or "").casefold() in {"child", "minor child"}
            for party in case_state.parties
        )
        if child_match and child_is_linked:
            extra.append(SafetyIndicator(
                category="child_safety_concern",
                confidence="medium",
                matched_text=child_match.group(0),
                source_text=sentence,
            ))

        dowry_match = _DOWRY_TERMS.search(sentence)
        related_party = any(
            party.role.casefold() in {"husband", "wife", "spouse", "in_law"}
            or (party.relationship or "").casefold() in {
                "spouse", "husband", "wife", "in-law", "mother-in-law", "father-in-law",
            }
            for party in case_state.parties
        )
        sentence_categories = {
            item.category for item in baseline.indicators if item.source_text == sentence
        }
        has_related_abuse = bool(sentence_categories.intersection({
            "threat", "domestic_violence", "harassment", "coercion", "intimidation",
            "dowry_related_abuse",
        }))
        already_detected = "dowry_related_abuse" in sentence_categories
        if dowry_match and related_party and has_related_abuse:
            if not already_detected:
                extra.append(SafetyIndicator(
                    category="dowry_related_abuse",
                    confidence="medium",
                    matched_text=sentence,
                    source_text=sentence,
                ))
            # Preserve the established indicator identifier consumed by saved
            # analyses while the new category enables the domain-specific tag.
            if "threat" in sentence_categories:
                extra.append(SafetyIndicator(
                    category="dowry_related_threat_concern",
                    confidence="medium",
                    matched_text=sentence,
                    source_text=sentence,
                ))

    indicators = list(baseline.indicators)
    seen = {(item.category, item.source_text, item.matched_text.casefold()) for item in indicators}
    for item in extra:
        key = (item.category, item.source_text, item.matched_text.casefold())
        if key not in seen:
            seen.add(key)
            indicators.append(item)

    if not indicators or baseline.context == SafetyCategory.URGENT_SAFETY_CONTEXT:
        return baseline

    confidence = max(
        (item.confidence for item in indicators),
        key={"low": 0, "medium": 1, "high": 2}.__getitem__,
    )
    return SafetyAssessment(
        context=SafetyCategory.POTENTIALLY_UNSAFE,
        confidence=confidence,
        indicators=tuple(indicators),
        source_text=statement,
        urgency=SafetyUrgency.ELEVATED,
        recommended_safety_prompt=baseline.recommended_safety_prompt or (
            "Some of what you described may indicate a potentially unsafe situation. "
            "Are you in immediate danger right now, and is it safe to continue discussing this here?"
        ),
    )

