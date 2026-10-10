"""Best-effort classification from explicit hints and common identifier patterns.

The classifier returns only category names and stable signal codes. It is not
a complete PII detector; callers should treat uncertain content conservatively.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any

from .models import DataCategory, PrivacyClassification


_CATEGORY_HINTS: dict[DataCategory, tuple[str, ...]] = {
    DataCategory.IDENTITY: ("identity", "aadhaar", "aadhar", "pan", "passport", "government id", "date of birth"),
    DataCategory.FINANCIAL: ("financial", "bank", "account number", "card number", "payment", "salary", "income", "amount"),
    DataCategory.LEGAL: ("legal", "lawyer", "court", "case", "contract", "agreement", "claim", "evidence"),
    DataCategory.CONTACT: ("contact", "email", "phone", "mobile", "telephone"),
    DataCategory.LOCATION: ("location", "address", "postal address", "gps", "coordinates", "latitude", "longitude"),
    DataCategory.DOCUMENT: ("document", "file", "attachment", "pdf", "image", "scan"),
}
_EMAIL = re.compile(r"(?<![\w.+-])[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+", re.I)
_AADHAAR = re.compile(r"(?<!\d)(?:\d[ -]?){11}\d(?!\d)")
_PAN = re.compile(r"(?<![A-Z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Z0-9])", re.I)
_INDIAN_MOBILE = re.compile(r"(?<!\d)(?:\+?91[ -]?)?[6-9]\d{9}(?!\d)")
_CARD_NUMBER = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")
_CURRENCY_AMOUNT = re.compile(r"(?<!\w)(?:₹|INR|USD|EUR|GBP|\$)\s?\d[\d,]*(?:\.\d{1,2})?", re.I)
_TEXT_HINTS: tuple[tuple[DataCategory, re.Pattern[str]], ...] = (
    (DataCategory.IDENTITY, re.compile(r"\b(?:identity|aadhaar|aadhar|passport|pan card)\b", re.I)),
    (DataCategory.FINANCIAL, re.compile(r"\b(?:bank account|account number|credit card|debit card|financial|salary|income|payment|invoice|rent|amount due)\b|(?:₹|INR)\s?\d", re.I)),
    (DataCategory.LEGAL, re.compile(r"\b(?:legal|court|lawyer|attorney|contract|agreement|evidence|lawsuit|complaint|case file)\b", re.I)),
    (DataCategory.CONTACT, re.compile(r"\b(?:email|phone|mobile|telephone)\b", re.I)),
    (DataCategory.LOCATION, re.compile(r"\b(?:address|postal code|pin code|gps|coordinates|latitude|longitude)\b", re.I)),
    (DataCategory.DOCUMENT, re.compile(r"\b(?:document|attachment|pdf|scan|image file)\b", re.I)),
)
_SIGNALS = (
    ("email", _EMAIL, DataCategory.CONTACT),
    ("aadhaar", _AADHAAR, DataCategory.IDENTITY),
    ("pan", _PAN, DataCategory.IDENTITY),
    ("indian_mobile", _INDIAN_MOBILE, DataCategory.CONTACT),
    ("card_number", _CARD_NUMBER, DataCategory.FINANCIAL),
    ("currency_amount", _CURRENCY_AMOUNT, DataCategory.FINANCIAL),
)


def classify_sensitive_data(
    value: str | Mapping[str, Any] | Iterable[Any] | None,
    *,
    hints: str | DataCategory | Iterable[str | DataCategory] = (),
) -> PrivacyClassification:
    """Classify recognizable categories without returning matched source data.

    ``hints`` should describe the field or file (for example ``"legal"`` or
    ``"document"``). Mapping keys are also treated as hints. Text scanning is
    deliberately limited to common identifier shapes.
    """
    categories: set[DataCategory] = set()
    signals: set[str] = set()

    if isinstance(hints, (str, DataCategory)):
        hints = (hints,)
    for hint in hints:
        _apply_hint(hint, categories, signals)

    for text, is_key in _strings(value):
        if is_key:
            _apply_hint(text, categories, signals)
        else:
            for category, pattern in _TEXT_HINTS:
                if pattern.search(text):
                    categories.add(category)
                    signals.add(f"text.{category.value}")
        for pattern_name, pattern, category in _SIGNALS:
            if pattern.search(text):
                categories.add(category)
                signals.add(f"pattern.{pattern_name}")

    return PrivacyClassification(frozenset(categories), tuple(sorted(signals)))


def _strings(value: Any) -> Iterable[tuple[str, bool]]:
    if isinstance(value, str):
        yield value, False
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        yield str(value), False
    elif isinstance(value, Mapping):
        for key, item in value.items():
            yield str(key), True
            yield from _strings(item)
    elif isinstance(value, Iterable) and not isinstance(value, (bytes, bytearray)):
        for item in value:
            yield from _strings(item)


def _apply_hint(hint: str | DataCategory, categories: set[DataCategory], signals: set[str]) -> None:
    if isinstance(hint, DataCategory):
        categories.add(hint)
        signals.add(f"hint.{hint.value}")
        return
    normalized = " ".join(str(hint).casefold().replace("_", " ").replace("-", " ").split())
    for category, terms in _CATEGORY_HINTS.items():
        if normalized == category.value or any(term in normalized for term in terms):
            categories.add(category)
            signals.add(f"hint.{category.value}")
