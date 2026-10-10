"""HTTP response models for projections of the canonical CaseState."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class TwinAPIModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class TwinProvenanceSummary(TwinAPIModel):
    source_id: str
    source_type: str
    source_path: str
    status: str
    confidence: float | None = None
    page_number: int | None = None
    extraction_method: str | None = None
    details: str | None = None
    confirmed_by_user: bool = False
    confirmed_at: str | None = None


class TwinNodeSummary(TwinAPIModel):
    id: str
    kind: str
    label: str
    status: str
    provenance: list[TwinProvenanceSummary] = Field(default_factory=list)
    properties: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime | None = None
    recorded_at: datetime | None = None


class TwinEdgeSummary(TwinAPIModel):
    id: str
    source_id: str
    target_id: str
    kind: str
    status: str
    provenance: list[TwinProvenanceSummary] = Field(default_factory=list)
    recorded_at: datetime | None = None


class TwinTimelineEventSummary(TwinAPIModel):
    id: str
    kind: str
    summary: str
    occurred_at: datetime | None = None
    date_value: str | None = None
    date_precision: str
    related_node_ids: list[str] = Field(default_factory=list)
    status: str
    provenance: list[TwinProvenanceSummary] = Field(default_factory=list)


class TwinSnapshotSummary(TwinAPIModel):
    case_id: str
    as_of: datetime
    nodes: list[TwinNodeSummary] = Field(default_factory=list)
    edges: list[TwinEdgeSummary] = Field(default_factory=list)
    timeline: list[TwinTimelineEventSummary] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)
    temporally_uncertain_context_keys: list[str] = Field(default_factory=list)
    unresolved_node_ids: list[str] = Field(default_factory=list)
    temporally_uncertain_node_ids: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class LegalTwinSummary(TwinAPIModel):
    case_id: str
    timeline: list[TwinTimelineEventSummary] = Field(default_factory=list)
    snapshot: TwinSnapshotSummary


class TwinActionReadinessChangeSummary(TwinAPIModel):
    id: str
    before_status: str | None = None
    after_status: str | None = None


class TwinDeltaSummary(TwinAPIModel):
    case_id: str
    from_as_of: datetime
    to_as_of: datetime
    added_node_ids: list[str] = Field(default_factory=list)
    removed_node_ids: list[str] = Field(default_factory=list)
    changed_node_ids: list[str] = Field(default_factory=list)
    added_edge_ids: list[str] = Field(default_factory=list)
    removed_edge_ids: list[str] = Field(default_factory=list)
    changed_edge_ids: list[str] = Field(default_factory=list)
    impacted_node_ids: list[str] = Field(default_factory=list)
    impacted_edge_ids: list[str] = Field(default_factory=list)
    affected_action_ids: list[str] = Field(default_factory=list)
    impacted_document_ids: list[str] = Field(default_factory=list)
    stale_draft_document_ids: list[str] = Field(default_factory=list)
    action_readiness_changes: list[TwinActionReadinessChangeSummary] = Field(default_factory=list)

