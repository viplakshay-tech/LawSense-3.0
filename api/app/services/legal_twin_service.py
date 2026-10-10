"""Adapt LegalTwin engine projections to stable API response models."""

from __future__ import annotations

from datetime import date, datetime

from app.engines.legal_twin import (
    LegalTwin,
    TimelineEvent,
    TwinEdge,
    TwinNode,
    TwinProvenance,
    build_legal_twin,
    compare_snapshots,
    generate_timeline,
    snapshot_at,
)
from app.engines.legal_twin.models import SnapshotComparison, TimelineSnapshot, normalize_datetime, thaw_properties
from app.schemas.case_state import CaseState
from app.schemas.legal_twin import (
    LegalTwinSummary,
    TwinEdgeSummary,
    TwinNodeSummary,
    TwinProvenanceSummary,
    TwinSnapshotSummary,
    TwinActionReadinessChangeSummary,
    TwinDeltaSummary,
    TwinTimelineEventSummary,
)


def build_case_twin(case_state: CaseState, *, as_of: datetime | date | str | None = None) -> LegalTwinSummary:
    """Project one CaseState through the canonical LegalTwin engine."""

    twin = build_legal_twin(case_state)
    if as_of is None:
        timestamps = [normalize_datetime(case_state.metadata.updatedAt)]
        timestamps.extend(node.recorded_at for node in twin.nodes.values())
        point = max((item for item in timestamps if item is not None), default=case_state.metadata.updatedAt)
    else:
        point = as_of
    snapshot = snapshot_at(twin, point)
    return LegalTwinSummary(
        case_id=twin.case_id,
        timeline=[_timeline_event(item) for item in generate_timeline(twin)],
        snapshot=_snapshot(snapshot),
    )


def build_case_twin_snapshot(
    case_state: CaseState,
    *,
    as_of: datetime | date | str,
) -> TwinSnapshotSummary:
    """Return the engine's point-in-time projection for one case."""

    return _snapshot(snapshot_at(build_legal_twin(case_state), as_of))


def build_case_twin_delta(
    case_state: CaseState,
    *,
    from_as_of: datetime | date | str,
    to_as_of: datetime | date | str,
) -> TwinDeltaSummary:
    """Compare two point-in-time projections of the current CaseState."""

    twin = build_legal_twin(case_state)
    before = snapshot_at(twin, from_as_of)
    after = snapshot_at(twin, to_as_of)
    return _delta(twin.case_id, compare_snapshots(before, after))


def compare_case_twin_states(before_state: CaseState, after_state: CaseState) -> TwinDeltaSummary:
    """Calculate a state delta when a caller has both CaseState revisions."""

    if before_state.id != after_state.id:
        raise ValueError("CaseState revisions must belong to the same case")
    before_twin = build_legal_twin(before_state)
    after_twin = build_legal_twin(after_state)
    before = snapshot_at(before_twin, _latest_as_of(before_state, before_twin))
    after = snapshot_at(after_twin, _latest_as_of(after_state, after_twin))
    return _delta(after_state.id, compare_snapshots(before, after))


def _latest_as_of(case_state: CaseState, twin: LegalTwin) -> datetime | date | str:
    timestamps = [normalize_datetime(case_state.metadata.updatedAt)]
    timestamps.extend(node.recorded_at for node in twin.nodes.values())
    return max((item for item in timestamps if item is not None), default=case_state.metadata.updatedAt)


def _delta(case_id: str, comparison: SnapshotComparison) -> TwinDeltaSummary:
    # SnapshotComparison is intentionally kept in the engine layer; this is
    # the API adapter that gives clients stable camel-cased IDs and statuses.
    return TwinDeltaSummary(
        case_id=case_id,
        from_as_of=comparison.before_as_of,
        to_as_of=comparison.after_as_of,
        added_node_ids=[item.id for item in comparison.added_nodes],
        removed_node_ids=[item.id for item in comparison.removed_nodes],
        changed_node_ids=[item.id for item in comparison.changed_nodes],
        added_edge_ids=[item.id for item in comparison.added_edges],
        removed_edge_ids=[item.id for item in comparison.removed_edges],
        changed_edge_ids=[item.id for item in comparison.changed_edges],
        impacted_node_ids=list(comparison.impacted_node_ids),
        impacted_edge_ids=list(comparison.impacted_edge_ids),
        affected_action_ids=list(comparison.affected_action_ids),
        impacted_document_ids=list(comparison.impacted_document_ids),
        stale_draft_document_ids=list(comparison.stale_draft_document_ids),
        action_readiness_changes=[
            TwinActionReadinessChangeSummary(
                id=item.id,
                before_status=item.before_status,
                after_status=item.after_status,
            )
            for item in comparison.action_readiness_changes
        ],
    )


def _snapshot(snapshot: TimelineSnapshot) -> TwinSnapshotSummary:
    return TwinSnapshotSummary(
        case_id=snapshot.case_id,
        as_of=snapshot.as_of,
        nodes=[_node(item) for item in snapshot.nodes],
        edges=[_edge(item) for item in snapshot.edges],
        timeline=[_timeline_event(item) for item in snapshot.timeline],
        context=thaw_properties(snapshot.context),
        temporally_uncertain_context_keys=list(snapshot.temporally_uncertain_context_keys),
        unresolved_node_ids=list(snapshot.unresolved_node_ids),
        temporally_uncertain_node_ids=list(snapshot.temporally_uncertain_node_ids),
        limitations=list(snapshot.limitations),
    )


def _node(node: TwinNode) -> TwinNodeSummary:
    return TwinNodeSummary(
        id=node.id,
        kind=node.kind.value,
        label=node.label,
        status=node.status,
        provenance=[_provenance(item) for item in node.provenance],
        properties=thaw_properties(node.properties),
        occurred_at=node.occurred_at,
        recorded_at=node.recorded_at,
    )


def _edge(edge: TwinEdge) -> TwinEdgeSummary:
    return TwinEdgeSummary(
        id=edge.id,
        source_id=edge.source_id,
        target_id=edge.target_id,
        kind=edge.kind.value,
        status=edge.status,
        provenance=[_provenance(item) for item in edge.provenance],
        recorded_at=edge.recorded_at,
    )


def _timeline_event(item: TimelineEvent) -> TwinTimelineEventSummary:
    return TwinTimelineEventSummary(
        id=item.id,
        kind=item.kind,
        summary=item.summary,
        occurred_at=item.occurred_at,
        date_value=item.date_value,
        date_precision=item.date_precision,
        related_node_ids=list(item.related_node_ids),
        status=item.status,
        provenance=[_provenance(entry) for entry in item.provenance],
    )


def _provenance(item: TwinProvenance) -> TwinProvenanceSummary:
    return TwinProvenanceSummary(
        source_id=item.source_id,
        source_type=item.source_type,
        source_path=item.source_path,
        status=item.status,
        confidence=item.confidence,
        page_number=item.page_number,
        extraction_method=item.extraction_method,
        details=item.details,
        confirmed_by_user=item.confirmed_by_user,
        confirmed_at=item.confirmed_at,
    )
