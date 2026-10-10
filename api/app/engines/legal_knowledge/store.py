"""Append-only local repository and deterministic source-ranked retrieval."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Protocol

from app.engines.legal_knowledge.models import (
    Authority,
    Jurisdiction,
    KnowledgeItem,
    KnowledgeRelationship,
    LegalDocument,
    LegalProcedure,
    LegalProvision,
    LegalRule,
    LegalSource,
    RelationshipType,
    SourceAuthorityTier,
    SourceVersion,
)
from app.engines.legal_knowledge.validation import validate_knowledge_item, validate_source_reference


class LegalKnowledgeStoreError(ValueError):
    """Raised when a repository operation would break lineage or immutability."""


class LegalKnowledgeRepository(Protocol):
    """Read contract used by retrieval, replaceable by a persistent local store."""

    def search(
        self,
        query: str,
        jurisdiction: str | Jurisdiction | None = None,
        filters: Mapping[str, object] | None = None,
    ) -> tuple[KnowledgeItem, ...]: ...

    def get_provision(self, provision_id: str) -> LegalProvision | None: ...


class InMemoryLegalKnowledgeStore:
    """Small local-first store; records are immutable and IDs cannot be replaced."""

    def __init__(self) -> None:
        self._records: dict[str, KnowledgeItem] = {}
        self._relationships: list[KnowledgeRelationship] = []

    @property
    def items(self) -> tuple[KnowledgeItem, ...]:
        return tuple(self._records.values())

    @property
    def relationships(self) -> tuple[KnowledgeRelationship, ...]:
        return tuple(self._relationships)

    def get(self, item_id: str) -> KnowledgeItem | None:
        return self._records.get(item_id)

    def get_provision(self, provision_id: str) -> LegalProvision | None:
        item = self._records.get(provision_id)
        return item if isinstance(item, LegalProvision) else None

    def add(self, item: KnowledgeItem) -> None:
        self.add_many((item,))

    def add_many(self, items: Sequence[KnowledgeItem]) -> None:
        """Validate a batch atomically, then append without replacing history."""
        incoming = tuple(items)
        if not incoming:
            return
        candidate = dict(self._records)
        incoming_ids: set[str] = set()
        for item in incoming:
            validate_knowledge_item(item)
            if item.id in candidate or item.id in incoming_ids:
                raise LegalKnowledgeStoreError(f"Knowledge item ID already exists: {item.id}")
            candidate[item.id] = item
            incoming_ids.add(item.id)

        for item in incoming:
            self._validate_catalog_references(item, candidate)
        new_supersession_edges: list[KnowledgeRelationship] = []
        successor_by_predecessor: dict[str, str] = {}
        for record in candidate.values():
            if record.supersedes:
                previous_successor = successor_by_predecessor.get(record.supersedes)
                if previous_successor and previous_successor != record.id:
                    raise LegalKnowledgeStoreError(
                        f"Record {record.supersedes} already has a superseding record."
                    )
                successor_by_predecessor[record.supersedes] = record.id
        for item in incoming:
            if item.supersedes:
                predecessor = candidate.get(item.supersedes)
                if predecessor is None:
                    raise LegalKnowledgeStoreError(f"Superseded record does not exist: {item.supersedes}")
                if type(predecessor) is not type(item) or predecessor.source != item.source:
                    raise LegalKnowledgeStoreError("A successor must have the same record type and source as its predecessor.")
                new_supersession_edges.append(
                    KnowledgeRelationship(
                        subject_id=item.id,
                        relationship=RelationshipType.SUPERSEDES,
                        object_id=predecessor.id,
                    )
                )
            if item.superseded_by:
                successor = candidate.get(item.superseded_by)
                if successor is None or successor.supersedes != item.id:
                    raise LegalKnowledgeStoreError("superseded_by must point to a record that supersedes this item.")

        for record in candidate.values():
            visited: set[str] = set()
            cursor: KnowledgeItem | None = record
            while cursor is not None and cursor.supersedes:
                if cursor.id in visited:
                    raise LegalKnowledgeStoreError("Supersession relationships cannot contain cycles.")
                visited.add(cursor.id)
                cursor = candidate.get(cursor.supersedes)

        self._records = candidate
        self._relationships.extend(new_supersession_edges)

    def superseding_record(self, item_id: str) -> KnowledgeItem | None:
        """Resolve the inverse supersession link without editing the old record."""
        matches = [item for item in self._records.values() if item.supersedes == item_id]
        if not matches:
            old = self._records.get(item_id)
            if old and old.superseded_by:
                return self._records.get(old.superseded_by)
            return None
        return matches[0]

    def add_relationship(self, relationship: KnowledgeRelationship) -> None:
        if not isinstance(relationship, KnowledgeRelationship):
            raise LegalKnowledgeStoreError("Relationships must use KnowledgeRelationship values.")
        if (
            not isinstance(relationship.subject_id, str)
            or not relationship.subject_id.strip()
            or not isinstance(relationship.object_id, str)
            or not relationship.object_id.strip()
        ):
            raise LegalKnowledgeStoreError("Relationship endpoints are required.")
        if not isinstance(relationship.relationship, RelationshipType):
            raise LegalKnowledgeStoreError("Relationship type must be a RelationshipType value.")
        if not isinstance(relationship.provenance, tuple):
            raise LegalKnowledgeStoreError("Relationship provenance must be an immutable tuple.")
        for reference in relationship.provenance:
            validate_source_reference(reference)
        if relationship in self._relationships:
            return
        self._relationships.append(relationship)

    def search(
        self,
        query: str,
        jurisdiction: str | Jurisdiction | None = None,
        filters: Mapping[str, object] | None = None,
    ) -> tuple[KnowledgeItem, ...]:
        normalized_query = query.strip().casefold()
        jurisdiction_id = jurisdiction.id if isinstance(jurisdiction, Jurisdiction) else jurisdiction
        accepted_filters = {"type", "status", "authority", "source", "version", "jurisdiction"}
        filter_values = dict(filters or {})
        unknown_filters = set(filter_values) - accepted_filters
        if unknown_filters:
            raise ValueError(f"Unsupported legal knowledge filters: {', '.join(sorted(unknown_filters))}")

        results: list[KnowledgeItem] = []
        for item in self._records.values():
            if not isinstance(item, (LegalDocument, LegalProvision, LegalRule, LegalProcedure)):
                continue
            searchable = " ".join(
                (
                    item.title,
                    item.search_text,
                    getattr(item, "text", None) or "",
                    getattr(item, "rule_text", None) or "",
                    " ".join(getattr(item, "steps", ()) or ()),
                )
            ).casefold()
            if normalized_query and normalized_query not in searchable:
                continue
            requested_jurisdiction = filter_values.get("jurisdiction", jurisdiction_id)
            if isinstance(requested_jurisdiction, Jurisdiction):
                requested_jurisdiction = requested_jurisdiction.id
            if requested_jurisdiction is not None and item.jurisdiction != requested_jurisdiction:
                continue
            if any(not _matches_filter(item, name, expected) for name, expected in filter_values.items() if name != "jurisdiction"):
                continue
            results.append(item)

        return tuple(sorted(results, key=self._trust_sort_key))

    def _trust_sort_key(self, item: KnowledgeItem) -> tuple[int, str]:
        source = self._records.get(item.source or "")
        tier = source.authority_tier if isinstance(source, LegalSource) else SourceAuthorityTier.TIER_4_UNVERIFIED_GENERAL
        return int(tier), item.id

    @staticmethod
    def _validate_catalog_references(item: KnowledgeItem, records: Mapping[str, KnowledgeItem]) -> None:
        if isinstance(item, LegalSource):
            authority = records.get(item.authority or "")
            if not isinstance(authority, Authority):
                raise LegalKnowledgeStoreError("A legal source must reference a registered Authority.")
        if isinstance(item, (LegalDocument, LegalProvision, LegalRule, LegalProcedure)):
            source = records.get(item.source or "")
            authority = records.get(item.authority or "")
            jurisdiction = records.get(item.jurisdiction or "")
            if not isinstance(source, LegalSource):
                raise LegalKnowledgeStoreError("Legal knowledge must reference a registered LegalSource.")
            if not isinstance(authority, Authority):
                raise LegalKnowledgeStoreError("Legal knowledge must reference a registered Authority.")
            if not isinstance(jurisdiction, Jurisdiction):
                raise LegalKnowledgeStoreError("Legal knowledge must reference a registered Jurisdiction.")
        if isinstance(item, SourceVersion) and not isinstance(records.get(item.source or ""), LegalSource):
            raise LegalKnowledgeStoreError("A source version must reference a registered LegalSource.")
        if isinstance(item, SourceVersion):
            authority = records.get(item.authority or "")
            if not isinstance(authority, Authority):
                raise LegalKnowledgeStoreError("A source version must reference a registered Authority.")
            for record_id in item.record_ids:
                versioned_record = records.get(record_id)
                if versioned_record is None or versioned_record.source != item.source:
                    raise LegalKnowledgeStoreError(
                        f"SourceVersion record_id must resolve to a record from its source: {record_id}"
                    )
        if isinstance(item, LegalProvision):
            document = records.get(item.document_id or "")
            if not isinstance(document, LegalDocument):
                raise LegalKnowledgeStoreError("A legal provision must reference a registered LegalDocument.")
            if document.source != item.source:
                raise LegalKnowledgeStoreError("A provision and its document must reference the same source.")
        if isinstance(item, LegalRule) and not isinstance(records.get(item.provision_id or ""), LegalProvision):
            raise LegalKnowledgeStoreError("A legal rule must reference a registered LegalProvision.")
        if isinstance(item, LegalProcedure):
            for provision_id in item.related_provision_ids:
                if not isinstance(records.get(provision_id), LegalProvision):
                    raise LegalKnowledgeStoreError(
                        f"Procedure provision link must resolve to a LegalProvision: {provision_id}"
                    )
        for reference in item.provenance:
            if reference.document_id:
                document = records.get(reference.document_id)
                if not isinstance(document, LegalDocument):
                    raise LegalKnowledgeStoreError("Provenance document_id must resolve to a registered LegalDocument.")
                if document.source != reference.source_id:
                    raise LegalKnowledgeStoreError("A provenance document must belong to its referenced source.")
            if reference.provision_id:
                provision = records.get(reference.provision_id)
                if not isinstance(provision, LegalProvision):
                    raise LegalKnowledgeStoreError("Provenance provision_id must resolve to a registered LegalProvision.")
                if provision.source != reference.source_id:
                    raise LegalKnowledgeStoreError("A provenance provision must belong to its referenced source.")


def _matches_filter(item: KnowledgeItem, name: str, expected: object) -> bool:
    actual = getattr(item, name)
    if isinstance(expected, (set, frozenset, tuple, list)):
        return actual in expected
    if name == "status":
        expected = expected.value if hasattr(expected, "value") else expected
        actual = actual.value
    return actual == expected
