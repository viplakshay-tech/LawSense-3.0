"""Conservative document classification using only available text signals."""

from __future__ import annotations

import re

from app.engines.document_intelligence.models import Classification


_RULES: tuple[tuple[str, tuple[tuple[str, re.Pattern[str]], ...]], ...] = (
    ("rent_agreement", (("rent agreement", re.compile(r"\brent(?:al)? agreement\b", re.I)), ("lease deed", re.compile(r"\blease deed\b", re.I)), ("tenancy agreement", re.compile(r"\btenancy agreement\b", re.I)))),
    ("court_document", (("court", re.compile(r"\bcourt\b", re.I)), ("petition", re.compile(r"\bpetition\b", re.I)), ("case number", re.compile(r"\bcase\s*(?:no\.?|number)\b", re.I)), ("plaintiff/defendant", re.compile(r"\b(plaintiff|defendant)\b", re.I)), ("judgment", re.compile(r"\bjudg(?:e)?ment\b", re.I)))),
    ("employment_document", (("employment terms", re.compile(r"\b(employment agreement|appointment letter|offer letter|salary slip|termination letter)\b", re.I)), ("employer", re.compile(r"\bemployer\b", re.I)))),
    ("invoice", (("invoice", re.compile(r"\binvoice\b", re.I)), ("billed amount", re.compile(r"\bbill\s+to\b", re.I)))),
    ("receipt", (("receipt", re.compile(r"\breceipt\b", re.I)), ("payment received", re.compile(r"\bpayment received\b", re.I)))),
    ("notice", (("legal notice", re.compile(r"\blegal notice\b", re.I)), ("notice", re.compile(r"\bnotice\b", re.I)))),
    ("complaint", (("complaint", re.compile(r"\bcomplaint\b", re.I)), ("grievance", re.compile(r"\bgrievance\b", re.I)))),
    ("identity_document", (("identity indicator", re.compile(r"\b(passport|aadhaar|aadhar|identity card|driving licence|driver'?s license)\b", re.I)),)),
    ("agreement", (("agreement", re.compile(r"\bagreement\b", re.I)), ("contract", re.compile(r"\bcontract\b", re.I)))),
)


def classify_document(text: str) -> Classification:
    if not text.strip():
        return Classification(category="unknown", confidence=0.0)

    matches: list[tuple[int, int, str, tuple[str, ...]]] = []
    for priority, (category, rules) in enumerate(_RULES):
        signals = tuple(label for label, pattern in rules if pattern.search(text))
        if signals:
            matches.append((len(signals), -priority, category, signals))
    if not matches:
        return Classification(category="unknown", confidence=0.0)

    score, _, category, signals = max(matches)
    confidence = min(0.92, 0.62 + (score - 1) * 0.12)
    return Classification(category=category, confidence=confidence, signals=signals)
