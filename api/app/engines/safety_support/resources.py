"""Injectable registry interface for verified official support resources."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol, Sequence

from .models import (
    OfficialResource,
    ResourceCategory,
    ResourceVerificationStatus,
)


class OfficialResourceRegistry(Protocol):
    """Lookup category candidates; the caller verifies status and locale."""

    def lookup(
        self,
        *,
        jurisdiction: str | None,
        state: str | None = None,
        categories: tuple[ResourceCategory, ...],
    ) -> Sequence[OfficialResource]:
        """Return category candidates; the caller must verify locale and status."""


class EmptyOfficialResourceRegistry:
    """Safe empty registry for deployments and tests without a resource catalog."""

    def lookup(
        self,
        *,
        jurisdiction: str | None,
        state: str | None = None,
        categories: tuple[ResourceCategory, ...],
    ) -> Sequence[OfficialResource]:
        return ()


class InMemoryOfficialResourceRegistry:
    """Small deterministic registry useful for deployments and tests."""

    def __init__(self, resources: Sequence[OfficialResource] = ()) -> None:
        self._resources = tuple(resources)

    def lookup(
        self,
        *,
        jurisdiction: str | None,
        state: str | None = None,
        categories: tuple[ResourceCategory, ...],
    ) -> Sequence[OfficialResource]:
        requested = set(categories)
        return tuple(
            resource
            for resource in self._resources
            if requested.intersection(resource.categories)
        )


class IndiaOfficialResourceRegistry(InMemoryOfficialResourceRegistry):
    """Static catalog of a small set of checked, official India resources."""

    def __init__(self) -> None:
        data_path = Path(__file__).with_name("data") / "india_official_resources.json"
        entries = json.loads(data_path.read_text(encoding="utf-8"))
        resources = tuple(
            OfficialResource(
                name=entry["name"],
                resource_id=entry.get("resource_id"),
                category=ResourceCategory(entry["categories"][0]),
                additional_categories=tuple(
                    ResourceCategory(value) for value in entry["categories"][1:]
                ),
                jurisdiction=entry["jurisdiction"],
                official=entry["verification_status"] == "verified_official",
                verification_status=ResourceVerificationStatus(entry["verification_status"]),
                url=entry.get("url"),
                phone=entry.get("phone"),
                alternate_phone=entry.get("alternate_phone"),
                description=entry.get("description"),
                availability_note=entry.get("availability_note"),
                phone_purpose=entry.get("phone_purpose"),
                accessibility_options=entry.get("accessibility_options"),
                source_url=entry["source_url"],
                verified_on=entry["verified_on"],
                jurisdiction_scope=entry["jurisdiction_scope"],
                applicable_states=tuple(entry.get("applicable_states", ())),
                excluded_states=tuple(entry.get("excluded_states", ())),
            )
            for entry in entries
        )
        super().__init__(resources)
