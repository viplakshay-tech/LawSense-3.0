"""Small, serializable privacy metadata types for local application services.

These types describe handling intent and references. They do not encrypt,
securely erase, or otherwise protect the bytes they describe.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from uuid import uuid4


class DataCategory(str, Enum):
    IDENTITY = "identity"
    FINANCIAL = "financial"
    LEGAL = "legal"
    CONTACT = "contact"
    LOCATION = "location"
    DOCUMENT = "document"


class SensitivityLevel(str, Enum):
    UNCLASSIFIED = "unclassified"
    SENSITIVE = "sensitive"
    RESTRICTED = "restricted"


_CATEGORY_LEVELS = {
    DataCategory.IDENTITY: SensitivityLevel.RESTRICTED,
    DataCategory.FINANCIAL: SensitivityLevel.RESTRICTED,
    DataCategory.LEGAL: SensitivityLevel.RESTRICTED,
    DataCategory.CONTACT: SensitivityLevel.SENSITIVE,
    DataCategory.LOCATION: SensitivityLevel.SENSITIVE,
    DataCategory.DOCUMENT: SensitivityLevel.RESTRICTED,
}
_LEVEL_RANK = {
    SensitivityLevel.UNCLASSIFIED: 0,
    SensitivityLevel.SENSITIVE: 1,
    SensitivityLevel.RESTRICTED: 2,
}
_SAFE_TOKEN = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")
_SAFE_REFERENCE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")


@dataclass(frozen=True)
class PrivacyClassification:
    """Categories and stable detection signals, without captured source text."""

    categories: frozenset[DataCategory] = field(default_factory=frozenset)
    signals: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        categories = frozenset(
            item if isinstance(item, DataCategory) else DataCategory(item)
            for item in self.categories
        )
        signals = tuple(sorted(set(self.signals)))
        if any(not _SAFE_TOKEN.fullmatch(signal) for signal in signals):
            raise ValueError("Classification signals must be safe lowercase tokens.")
        object.__setattr__(self, "categories", categories)
        object.__setattr__(self, "signals", signals)

    @property
    def sensitivity_level(self) -> SensitivityLevel:
        if not self.categories:
            return SensitivityLevel.UNCLASSIFIED
        return max(
            ( _CATEGORY_LEVELS[category] for category in self.categories ),
            key=_LEVEL_RANK.__getitem__,
        )


class ConsentPurpose(str, Enum):
    LOCAL_PROCESSING = "local_processing"
    LOCAL_STORAGE = "local_storage"
    ANALYSIS = "analysis"
    EXPORT = "export"


@dataclass(frozen=True)
class ConsentState:
    """A point-in-time consent decision; no narrative or consent copy is stored."""

    purpose: ConsentPurpose
    granted: bool
    decided_at: datetime
    consent_id: str = field(default_factory=lambda: f"consent_{uuid4().hex}")
    categories: frozenset[DataCategory] = field(default_factory=frozenset)

    def __post_init__(self) -> None:
        _require_aware(self.decided_at, "decided_at")
        object.__setattr__(self, "purpose", ConsentPurpose(self.purpose))
        if not isinstance(self.granted, bool):
            raise ValueError("granted must be a boolean.")
        if not self.consent_id or not _SAFE_TOKEN.fullmatch(self.consent_id.casefold()):
            raise ValueError("consent_id must be a non-empty safe token.")
        object.__setattr__(
            self,
            "categories",
            frozenset(item if isinstance(item, DataCategory) else DataCategory(item) for item in self.categories),
        )


@dataclass(frozen=True)
class RetentionPolicy:
    """Retention metadata with either a fixed expiry or an age-based period.

    Leaving both fields empty means no automatic expiry is defined; it does not
    mean that data should be kept forever.
    """

    policy_id: str = field(default_factory=lambda: f"retention_{uuid4().hex}")
    retain_for_days: int | None = None
    expires_at: datetime | None = None

    def __post_init__(self) -> None:
        if not self.policy_id or not _SAFE_TOKEN.fullmatch(self.policy_id.casefold()):
            raise ValueError("policy_id must be a non-empty safe token.")
        if self.retain_for_days is not None:
            if isinstance(self.retain_for_days, bool) or not isinstance(self.retain_for_days, int):
                raise ValueError("retain_for_days must be an integer.")
            if self.retain_for_days < 0:
                raise ValueError("retain_for_days cannot be negative.")
        if self.retain_for_days is not None and self.expires_at is not None:
            raise ValueError("Specify retain_for_days or expires_at, not both.")
        if self.expires_at is not None:
            _require_aware(self.expires_at, "expires_at")

    def expiry_for(self, created_at: datetime) -> datetime | None:
        _require_aware(created_at, "created_at")
        if self.expires_at is not None:
            return self.expires_at
        if self.retain_for_days is not None:
            return created_at + timedelta(days=self.retain_for_days)
        return None

    def is_expired(self, created_at: datetime, *, now: datetime | None = None) -> bool:
        current = now or datetime.now(timezone.utc)
        _require_aware(current, "now")
        expiry = self.expiry_for(created_at)
        return expiry is not None and current >= expiry


@dataclass(frozen=True)
class SecureDataReference:
    """Opaque metadata reference for a future encrypted local storage adapter."""

    reference_id: str
    classification: PrivacyClassification
    created_at: datetime
    sha256: str | None = None
    size_bytes: int | None = None
    media_type: str | None = None
    retention: RetentionPolicy | None = None
    storage_key: str | None = None

    def __post_init__(self) -> None:
        if not _SAFE_REFERENCE_ID.fullmatch(self.reference_id):
            raise ValueError("reference_id must be an opaque identifier, not a path or content.")
        _require_aware(self.created_at, "created_at")
        if not isinstance(self.classification, PrivacyClassification):
            raise ValueError("classification must be a PrivacyClassification.")
        if self.sha256 is not None and not re.fullmatch(r"[0-9a-f]{64}", self.sha256):
            raise ValueError("sha256 must be a lowercase SHA-256 hex digest.")
        if self.size_bytes is not None and self.size_bytes < 0:
            raise ValueError("size_bytes cannot be negative.")
        if self.media_type is not None and not self.media_type.strip():
            raise ValueError("media_type cannot be blank.")
        if self.storage_key is not None and not _SAFE_REFERENCE_ID.fullmatch(self.storage_key):
            raise ValueError("storage_key must be an opaque identifier, not a path or content.")


class AuditOutcome(str, Enum):
    SUCCESS = "success"
    FAILURE = "failure"
    DENIED = "denied"


class AuditActor(str, Enum):
    USER = "user"
    LOCAL_SERVICE = "local_service"
    SYSTEM = "system"


@dataclass(frozen=True)
class AuditEvent:
    """Payload-free audit metadata; do not add document text or user narratives."""

    event_type: str
    action: str
    outcome: AuditOutcome
    occurred_at: datetime
    actor: AuditActor = AuditActor.LOCAL_SERVICE
    reference_id: str | None = None
    categories: frozenset[DataCategory] = field(default_factory=frozenset)
    event_id: str = field(default_factory=lambda: f"event_{uuid4().hex}")

    def __post_init__(self) -> None:
        for name in ("event_type", "action", "event_id"):
            value = getattr(self, name)
            if not value or not _SAFE_TOKEN.fullmatch(value.casefold()):
                raise ValueError(f"{name} must be a non-empty safe token.")
        _require_aware(self.occurred_at, "occurred_at")
        object.__setattr__(self, "outcome", AuditOutcome(self.outcome))
        object.__setattr__(self, "actor", AuditActor(self.actor))
        if self.reference_id is not None and not _SAFE_REFERENCE_ID.fullmatch(self.reference_id):
            raise ValueError("reference_id must be an opaque identifier, not a path or content.")
        object.__setattr__(
            self,
            "categories",
            frozenset(item if isinstance(item, DataCategory) else DataCategory(item) for item in self.categories),
        )


def _require_aware(value: datetime, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone.")
