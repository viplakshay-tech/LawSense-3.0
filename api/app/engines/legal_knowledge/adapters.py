"""Ingestion adapter contract and a deterministic, non-network test adapter."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from app.engines.legal_knowledge.models import KnowledgeItem, LegalSource
from app.engines.legal_knowledge.validation import LegalKnowledgeValidationError, validate_knowledge_item


@dataclass(frozen=True, slots=True)
class FetchedLegalSource:
    source_id: str
    retrieved_at: datetime
    payload: bytes


class LegalSourceAdapter(Protocol):
    """Lifecycle expected of a future verified-source adapter.

    Implementations may communicate with an approved source, but this module
    itself contains no scraper, network client, or source-specific behavior.
    """

    def discover(self) -> Sequence[LegalSource]: ...

    def fetch(self, source: LegalSource) -> FetchedLegalSource: ...

    def parse(self, fetched: FetchedLegalSource) -> object: ...

    def normalize(self, parsed: object) -> Sequence[KnowledgeItem]: ...

    def validate(self, items: Sequence[KnowledgeItem]) -> Sequence[KnowledgeItem]: ...

    def version(self, items: Sequence[KnowledgeItem]) -> Sequence[KnowledgeItem]: ...


class MockLegalSourceAdapter:
    """Fixture-only adapter that returns caller-supplied records unchanged."""

    def __init__(
        self,
        source: LegalSource,
        records: Sequence[KnowledgeItem],
        *,
        retrieved_at: datetime,
        payload: bytes = b"local fixture payload",
    ) -> None:
        self._source = source
        self._records = tuple(records)
        self._retrieved_at = retrieved_at
        self._payload = payload

    def discover(self) -> tuple[LegalSource, ...]:
        return (self._source,)

    def fetch(self, source: LegalSource) -> FetchedLegalSource:
        if source.id != self._source.id:
            raise ValueError(f"Mock adapter does not know source {source.id}.")
        return FetchedLegalSource(source_id=source.id, retrieved_at=self._retrieved_at, payload=self._payload)

    def parse(self, fetched: FetchedLegalSource) -> tuple[KnowledgeItem, ...]:
        if fetched.source_id != self._source.id:
            raise ValueError("Fetched payload belongs to a different source.")
        return self._records

    def normalize(self, parsed: object) -> tuple[KnowledgeItem, ...]:
        if not isinstance(parsed, (tuple, list)) or any(not isinstance(item, KnowledgeItem) for item in parsed):
            raise LegalKnowledgeValidationError("Mock adapter parse output must contain knowledge records.")
        return tuple(parsed)

    def validate(self, items: Sequence[KnowledgeItem]) -> tuple[KnowledgeItem, ...]:
        normalized = tuple(items)
        for item in normalized:
            validate_knowledge_item(item)
        return normalized

    def version(self, items: Sequence[KnowledgeItem]) -> tuple[KnowledgeItem, ...]:
        """Preserve explicit fixture versions; never invent or rewrite them."""
        versioned = tuple(items)
        for item in versioned:
            if not item.version:
                raise LegalKnowledgeValidationError(f"Record {item.id} has no explicit version.")
        return versioned


def ingest_discovered_sources(adapter: LegalSourceAdapter) -> tuple[KnowledgeItem, ...]:
    """Run the adapter lifecycle and return validated, explicitly versioned records."""
    collected: list[KnowledgeItem] = []
    for source in adapter.discover():
        validate_knowledge_item(source)
        fetched = adapter.fetch(source)
        if not isinstance(fetched, FetchedLegalSource) or fetched.source_id != source.id:
            raise LegalKnowledgeValidationError("Fetched payload must identify the discovered source.")
        if (
            not isinstance(fetched.retrieved_at, datetime)
            or fetched.retrieved_at.tzinfo is None
            or fetched.retrieved_at.utcoffset() is None
        ):
            raise LegalKnowledgeValidationError("Fetched payload retrieval time must be timezone-aware.")
        if not isinstance(fetched.payload, bytes):
            raise LegalKnowledgeValidationError("Fetched payload must be bytes.")
        parsed = adapter.parse(fetched)
        normalized = adapter.normalize(parsed)
        validated = adapter.validate(normalized)
        versioned = tuple(adapter.version(validated))
        for item in versioned:
            validate_knowledge_item(item)
            if item.source != source.id:
                raise LegalKnowledgeValidationError(
                    f"Record {item.id} does not reference the source that was fetched."
                )
        collected.extend(versioned)
    return tuple(collected)
