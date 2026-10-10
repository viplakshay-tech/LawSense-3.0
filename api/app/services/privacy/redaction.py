"""Best-effort text and structure redaction for common identifiers."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any


_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?<![\w.+-])[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+", re.I),
    re.compile(r"(?<![A-Z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Z0-9])", re.I),
    re.compile(r"(?<!\w)(?:₹|INR|USD|EUR|GBP|\$)\s?\d[\d,]*(?:\.\d{1,2})?", re.I),
    re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)"),
    re.compile(r"(?<!\d)(?:\+?91[ -]?)?[6-9]\d{9}(?!\d)"),
    re.compile(r"(?<!\d)(?:\d[ -]?){11}\d(?!\d)"),
)
_SENSITIVE_KEY_PARTS = (
    "aadhaar", "aadhar", "pan", "passport", "identity", "email", "phone", "mobile",
    "address", "location", "account", "card number", "narrative", "statement",
    "case details", "document content", "document text", "extracted text", "ocr text", "raw text",
)


def redact_text(text: str, *, replacement: str = "[REDACTED]", extra_values: tuple[str, ...] = ()) -> str:
    """Redact common identifier shapes and caller-supplied exact strings.

    Pattern matching is best-effort and does not reliably detect all personal
    or legal information. Use safe structured logging instead of logging text.
    """
    if not isinstance(text, str):
        raise TypeError("text must be a string.")
    if not replacement:
        raise ValueError("replacement cannot be empty.")
    result = text
    for value in sorted({item for item in extra_values if item}, key=len, reverse=True):
        result = result.replace(value, replacement)
    for pattern in _PATTERNS:
        result = pattern.sub(replacement, result)
    return result


def redact_structure(value: Any, *, replacement: str = "[REDACTED]", extra_values: tuple[str, ...] = ()) -> Any:
    """Return a recursively copied structure with sensitive-key values hidden."""
    if isinstance(value, Mapping):
        result: dict[Any, Any] = {}
        for key, item in value.items():
            key_text = str(key).casefold().replace("_", " ")
            if any(part in key_text for part in _SENSITIVE_KEY_PARTS):
                result[key] = replacement
            else:
                result[key] = redact_structure(item, replacement=replacement, extra_values=extra_values)
        return result
    if isinstance(value, list):
        return [redact_structure(item, replacement=replacement, extra_values=extra_values) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_structure(item, replacement=replacement, extra_values=extra_values) for item in value)
    if isinstance(value, str):
        return redact_text(value, replacement=replacement, extra_values=extra_values)
    return value
