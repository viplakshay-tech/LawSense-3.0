"""Append-only legal source registry backed by the shared knowledge store."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from app.engines.legal_knowledge.models import (
    Authority,
    Jurisdiction,
    KnowledgeItem,
    KnowledgeStatus,
    LegalSource,
)
from app.engines.legal_knowledge.store import (
    InMemoryLegalKnowledgeStore,
    LegalKnowledgeStoreError,
)

from app.engines.legal_sources.models import (
    RegistrySourceVersion,
    SourceRegistryEntry,
    SourceType,
)
from app.engines.legal_sources.validation import (
    SourceRegistryValidationError,
    validate_registry_catalog,
    validate_registry_version,
    validate_source_identity,
)


class SourceRegistryError(ValueError):
    """Raised when a registry operation would break source lineage."""


class SourceRegistryRepository(Protocol):
    """Minimal shared legal knowledge store contract used by the registry."""

    @property
    def items(self) -> tuple[KnowledgeItem, ...]: ...

    def get(self, item_id: str) -> KnowledgeItem | None: ...

    def add_many(self, items: Sequence[KnowledgeItem]) -> None: ...


class LegalSourceRegistry:
    """Registry façade over the append-only legal knowledge repository.

    The registry stores shared ``LegalSource``, ``Authority``, and
    ``Jurisdiction`` catalog records alongside ``RegistrySourceVersion``
    snapshots in the same repository. It never fetches the network or fills in
    metadata that a caller did not supply.
    """

    def __init__(self, repository: SourceRegistryRepository | None = None) -> None:
        self.repository = repository or InMemoryLegalKnowledgeStore()

    def register(
        self,
        source: LegalSource,
        version: RegistrySourceVersion,
        *,
        authority: Authority | None = None,
        jurisdiction: Jurisdiction | None = None,
    ) -> SourceRegistryEntry:
        """Register a source and its first explicit snapshot atomically.

        Catalog records can be supplied here or already exist in the shared
        repository. A missing Authority is an error; the registry will not
        synthesize catalog data.
        """

        validate_source_identity(source)
        validate_registry_version(version)
        if self.repository.get(source.id) is not None:
            raise SourceRegistryError(f"Source ID already exists: {source.id}")
        if version.supersedes is not None:
            raise SourceRegistryError("The first source version cannot supersede another version.")
        if self._versions_for(source.id):
            raise SourceRegistryError(f"Source already has registry versions: {source.id}")

        resolved_authority = self._resolve_authority(source.authority, authority)
        jurisdiction_records = self._resolve_jurisdictions(
            (source.jurisdiction, version.jurisdiction), jurisdiction
        )
        selected_jurisdiction = next(
            (item for item in jurisdiction_records if item.id == version.jurisdiction), None
        )
        validate_registry_catalog(
            source,
            version,
            authority=resolved_authority,
            jurisdiction=selected_jurisdiction,
        )
        batch: list[KnowledgeItem] = []
        if self.repository.get(resolved_authority.id) is None:
            batch.append(resolved_authority)
        batch.extend(
            item for item in jurisdiction_records if self.repository.get(item.id) is None
        )
        batch.extend((source, version))
        try:
            self.repository.add_many(tuple(batch))
        except LegalKnowledgeStoreError as exc:
            raise SourceRegistryError(str(exc)) from exc
        return self.get(source.id)  # type: ignore[return-value]

    def append_version(self, version: RegistrySourceVersion) -> SourceRegistryEntry:
        """Append a successor snapshot while preserving every prior version."""

        validate_registry_version(version)
        source = self.repository.get(version.source or "")
        if not isinstance(source, LegalSource):
            raise SourceRegistryError("The snapshot must reference a registered LegalSource.")
        if version.authority != source.authority:
            raise SourceRegistryError("The snapshot Authority must match its LegalSource.")
        if version.authority_tier != source.authority_tier:
            raise SourceRegistryError("The snapshot authority tier must match its LegalSource.")

        authority = self.repository.get(version.authority or "")
        if not isinstance(authority, Authority):
            raise SourceRegistryError("The snapshot Authority is not registered.")
        jurisdiction = self._resolve_jurisdictions((version.jurisdiction,), None)
        jurisdiction_record = jurisdiction[0] if jurisdiction else None
        if version.status is KnowledgeStatus.VERIFIED and jurisdiction_record is None:
            raise SourceRegistryValidationError(
                "Verified snapshots require a registered Jurisdiction."
            )
        if jurisdiction_record is not None and jurisdiction_record.id != version.jurisdiction:
            raise SourceRegistryValidationError("Snapshot jurisdiction does not resolve.")

        history = self._ordered_versions(source.id)
        if not history:
            raise SourceRegistryError(f"Source has no initial registry version: {source.id}")
        current = history[-1]
        if version.supersedes != current.id:
            raise SourceRegistryError(
                f"A new source version must supersede the current version {current.id}."
            )
        if self.repository.get(version.id) is not None:
            raise SourceRegistryError(f"Version ID already exists: {version.id}")
        try:
            self.repository.add_many((version,))
        except LegalKnowledgeStoreError as exc:
            raise SourceRegistryError(str(exc)) from exc
        return self.get(source.id)  # type: ignore[return-value]

    def get(self, source_id: str) -> SourceRegistryEntry | None:
        """Return the source with its latest snapshot and complete history."""

        source = self.repository.get(source_id)
        if not isinstance(source, LegalSource):
            return None
        versions = self._ordered_versions(source_id)
        if not versions:
            return None
        authority = self.repository.get(source.authority or "")
        if not isinstance(authority, Authority):
            return None
        current = versions[-1]
        jurisdiction = self.repository.get(current.jurisdiction or "")
        if not isinstance(jurisdiction, Jurisdiction):
            jurisdiction = None
        return SourceRegistryEntry(
            source=source,
            current_version=current,
            versions=versions,
            authority=authority,
            jurisdiction=jurisdiction,
        )

    def entries(self) -> tuple[SourceRegistryEntry, ...]:
        """List registry sources in their repository insertion order."""

        result = []
        for item in self.repository.items:
            if isinstance(item, LegalSource):
                entry = self.get(item.id)
                if entry is not None:
                    result.append(entry)
        return tuple(result)

    def authoritative_sources(
        self,
        *,
        jurisdiction: str | None = None,
        source_type: SourceType | None = None,
    ) -> tuple[SourceRegistryEntry, ...]:
        """List current sources that pass verification and authority-tier checks."""

        return tuple(
            entry
            for entry in self.entries()
            if entry.is_authoritative
            and (jurisdiction is None or entry.jurisdiction_id == jurisdiction)
            and (source_type is None or entry.source_type is source_type)
        )

    def retrieval_candidates(self) -> tuple[SourceRegistryEntry, ...]:
        """Return current, non-withdrawn snapshots for future update jobs."""

        return tuple(
            entry
            for entry in self.entries()
            if entry.verification_status is not KnowledgeStatus.WITHDRAWN
        )

    def versions(self, source_id: str) -> tuple[RegistrySourceVersion, ...]:
        """Return the append-only history in supersession order."""

        return self._ordered_versions(source_id)

    def legal_sources(self) -> tuple[LegalSource, ...]:
        """Expose shared LegalSource records to existing ingestion adapters."""

        return tuple(
            item for item in self.repository.items if isinstance(item, LegalSource)
        )

    def _versions_for(self, source_id: str) -> tuple[RegistrySourceVersion, ...]:
        return tuple(
            item
            for item in self.repository.items
            if isinstance(item, RegistrySourceVersion) and item.source == source_id
        )

    def _ordered_versions(self, source_id: str) -> tuple[RegistrySourceVersion, ...]:
        versions = self._versions_for(source_id)
        if not versions:
            return ()
        by_id = {version.id: version for version in versions}
        roots = [version for version in versions if version.supersedes is None]
        if len(roots) != 1:
            raise SourceRegistryError(f"Source {source_id} must have exactly one version root.")
        ordered = [roots[0]]
        while True:
            successors = [version for version in versions if version.supersedes == ordered[-1].id]
            if not successors:
                break
            if len(successors) != 1:
                raise SourceRegistryError(f"Source {source_id} has a branched version history.")
            ordered.append(successors[0])
        if len(ordered) != len(by_id):
            raise SourceRegistryError(f"Source {source_id} has a disconnected version history.")
        return tuple(ordered)

    def _resolve_authority(
        self,
        authority_id: str | None,
        supplied: Authority | None,
    ) -> Authority:
        if not authority_id:
            raise SourceRegistryValidationError("A LegalSource must identify its Authority.")
        existing = self.repository.get(authority_id)
        if existing is not None:
            if not isinstance(existing, Authority):
                raise SourceRegistryValidationError("Source authority ID does not resolve to Authority.")
            if supplied is not None and supplied.id != authority_id:
                raise SourceRegistryValidationError("Supplied Authority ID does not match the source.")
            return existing
        if supplied is None or supplied.id != authority_id:
            raise SourceRegistryValidationError(
                "Supply the existing Authority record or register it in the shared repository first."
            )
        return supplied

    def _resolve_jurisdictions(
        self,
        jurisdiction_ids: Sequence[str | None],
        supplied: Jurisdiction | None,
    ) -> tuple[Jurisdiction, ...]:
        requested = tuple(dict.fromkeys(item for item in jurisdiction_ids if item))
        if supplied is not None and supplied.id not in requested:
            raise SourceRegistryValidationError("Supplied Jurisdiction ID is not used by this source.")
        resolved: list[Jurisdiction] = []
        for jurisdiction_id in requested:
            existing = self.repository.get(jurisdiction_id)
            if existing is not None:
                if not isinstance(existing, Jurisdiction):
                    raise SourceRegistryValidationError(
                        "Source jurisdiction ID does not resolve to Jurisdiction."
                    )
                resolved.append(existing)
                continue
            if supplied is None or supplied.id != jurisdiction_id:
                raise SourceRegistryValidationError(
                    f"Supply the Jurisdiction record for {jurisdiction_id} or register it first."
                )
            resolved.append(supplied)
        return tuple(resolved)


SourceRegistry = LegalSourceRegistry


__all__ = [
    "LegalSourceRegistry",
    "SourceRegistry",
    "SourceRegistryError",
    "SourceRegistryRepository",
]
