"""Logging helpers that deliberately omit free-form content and exception text."""

from __future__ import annotations

import hashlib
import logging
import re
from typing import Any

from .models import DataCategory, PrivacyClassification, SecureDataReference


_SAFE_LABEL = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")


def safe_log_fields(
    event: str,
    *,
    reference: SecureDataReference | str | None = None,
    classification: PrivacyClassification | None = None,
    outcome: str | None = None,
    error: BaseException | type[BaseException] | None = None,
) -> dict[str, Any]:
    """Build a small safe record; never accept messages, text, or arbitrary extras.

    A reference is represented by a stable SHA-256 fingerprint so caller IDs
    that happen to contain personal data are not copied into logs.
    """
    fields: dict[str, Any] = {"event": _label(event, "event")}
    reference_id = reference.reference_id if isinstance(reference, SecureDataReference) else reference
    if reference_id is not None:
        fields["reference_fingerprint"] = hashlib.sha256(str(reference_id).encode("utf-8")).hexdigest()[:16]
    effective_classification = classification
    if effective_classification is None and isinstance(reference, SecureDataReference):
        effective_classification = reference.classification
    if effective_classification is not None:
        fields["categories"] = sorted(category.value for category in effective_classification.categories)
        fields["sensitivity"] = effective_classification.sensitivity_level.value
    if outcome is not None:
        fields["outcome"] = _label(outcome, "outcome")
    if error is not None:
        error_type = error if isinstance(error, type) else type(error)
        fields["error_type"] = _label(error_type.__name__.casefold(), "error type")
    return fields


def log_privacy_event(
    logger: logging.Logger,
    event: str,
    **safe_options: Any,
) -> dict[str, Any]:
    """Emit a generic message with only fields produced by ``safe_log_fields``."""
    fields = safe_log_fields(event, **safe_options)
    logger.info("privacy_event", extra={"privacy": fields})
    return fields


def _label(value: str, label_name: str) -> str:
    normalized = str(value).casefold()
    if not _SAFE_LABEL.fullmatch(normalized):
        raise ValueError(f"{label_name} must be a short lowercase safe token.")
    return normalized
