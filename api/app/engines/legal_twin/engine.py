"""Timeline projections, point-in-time snapshots, and snapshot comparisons."""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime

from app.engines.legal_twin.models import (
    ActionReadinessChange,
    ContextChange,
    EdgeType,
    EdgeChange,
    LegalTwin,
    NodeChange,
    NodeType,
    SnapshotComparison,
    TimelineEvent,
    TimelineSnapshot,
    TwinEdge,
    TwinNode,
    normalize_datetime,
)


_TEMPORAL_NODE_TYPES = {
    NodeType.EVENT,
    NodeType.FACT,
    NodeType.CLAIM,
    NodeType.DOCUMENT,
    NodeType.EVIDENCE,
    NodeType.LEGAL_ISSUE,
    NodeType.LAW,
    NodeType.PROCEDURE,
    NodeType.AUTHORITY,
    NodeType.ACTION,
}

_LIMITATIONS = (
    "This projection uses the supplied CaseState; it cannot reconstruct revisions that were never recorded.",
    "Only exact event dates and recorded_at timestamps exclude records after the cutoff. Approximate or missing dates remain visible and are listed as temporally uncertain.",
)


def _exact_event_datetime(
    precision: object,
    occurred_at: datetime | date | str | None,
    date_value: object,
) -> datetime | None:
    """Resolve an exact event date even when ``occurred_at`` was omitted."""
    if precision != "exact":
        return None
    return normalize_datetime(occurred_at) or normalize_datetime(
        date_value if isinstance(date_value, (datetime, date, str)) else None
    )


def generate_timeline(twin: LegalTwin) -> tuple[TimelineEvent, ...]:
    """Return the twin's events in chronological order, with undated items last."""

    if not isinstance(twin, LegalTwin):
        raise TypeError("twin must be a LegalTwin")
    return twin.generate_timeline()


def snapshot_at(
    twin: LegalTwin,
    point_in_time: datetime | date | str,
) -> TimelineSnapshot:
    """Project recorded information that can be placed at or before a time.

    Nodes without a known date stay visible as context and are flagged. Exact
    future event dates and future document/record timestamps are excluded.
    """

    if not isinstance(twin, LegalTwin):
        raise TypeError("twin must be a LegalTwin")
    cutoff = normalize_datetime(point_in_time)
    if cutoff is None:
        raise ValueError("point_in_time must be an ISO date or datetime")

    visible_nodes: list[TwinNode] = []
    uncertain: list[str] = []
    for node in twin.nodes.values():
        if node.recorded_at is not None and node.recorded_at > cutoff:
            continue
        event_precision = node.properties.get("date_precision") if node.kind == NodeType.EVENT else None
        event_date = _exact_event_datetime(
            event_precision,
            node.occurred_at,
            node.properties.get("date_value"),
        ) if node.kind == NodeType.EVENT else None
        if node.kind == NodeType.EVENT and event_precision == "exact" and event_date is not None:
            if event_date > cutoff:
                continue
        if node.kind == NodeType.EVENT and (event_precision != "exact" or event_date is None):
            uncertain.append(node.id)
        elif node.kind in _TEMPORAL_NODE_TYPES and node.recorded_at is None:
            uncertain.append(node.id)
        visible_nodes.append(node)

    visible_ids = {node.id for node in visible_nodes}
    visible_edges: list[TwinEdge] = [
        edge for edge in twin.edges.values()
        if edge.source_id in visible_ids
        and edge.target_id in visible_ids
        and (edge.recorded_at is None or edge.recorded_at <= cutoff)
    ]

    visible_timeline: list[TimelineEvent] = []
    for item in twin.generate_timeline():
        if item.related_node_ids and item.related_node_ids[0] not in visible_ids:
            continue
        related_visible = tuple(node_id for node_id in item.related_node_ids if node_id in visible_ids)
        if item.related_node_ids and not related_visible:
            continue
        event_date = _exact_event_datetime(item.date_precision, item.occurred_at, item.date_value)
        if item.date_precision == "exact" and event_date is not None and event_date > cutoff:
            continue
        visible_timeline.append(replace(item, related_node_ids=related_visible))

    ordered_nodes = tuple(sorted(visible_nodes, key=lambda node: node.id))
    ordered_edges = tuple(sorted(visible_edges, key=lambda edge: edge.id))
    unresolved = tuple(node.id for node in ordered_nodes if node.status in {"unknown", "conflicting", "assumption"})
    visible_context: dict[str, object] = {}
    uncertain_context: list[str] = []
    for key, value in twin.context.items():
        recorded_at = twin.context_recorded_at.get(key)
        if recorded_at is not None and recorded_at > cutoff:
            continue
        visible_context[key] = value
        if recorded_at is None:
            uncertain_context.append(key)
    return TimelineSnapshot(
        case_id=twin.case_id,
        as_of=cutoff,
        nodes=ordered_nodes,
        edges=ordered_edges,
        timeline=tuple(visible_timeline),
        context=visible_context,
        temporally_uncertain_context_keys=tuple(sorted(uncertain_context)),
        unresolved_node_ids=unresolved,
        temporally_uncertain_node_ids=tuple(sorted(set(uncertain))),
        limitations=_LIMITATIONS,
    )


def compare_snapshots(
    first: TimelineSnapshot,
    second: TimelineSnapshot,
) -> SnapshotComparison:
    """Describe graph records added, removed, or changed between two snapshots."""

    if first.case_id != second.case_id:
        raise ValueError("snapshots must belong to the same case")

    before_nodes = {node.id: node for node in first.nodes}
    after_nodes = {node.id: node for node in second.nodes}
    before_edges = {edge.id: edge for edge in first.edges}
    after_edges = {edge.id: edge for edge in second.edges}

    shared_node_ids = before_nodes.keys() & after_nodes.keys()
    shared_edge_ids = before_edges.keys() & after_edges.keys()
    added_nodes = tuple(after_nodes[key] for key in sorted(after_nodes.keys() - before_nodes.keys()))
    removed_nodes = tuple(before_nodes[key] for key in sorted(before_nodes.keys() - after_nodes.keys()))
    changed_nodes = tuple(
        NodeChange(id=key, before=before_nodes[key], after=after_nodes[key])
        for key in sorted(shared_node_ids)
        if before_nodes[key] != after_nodes[key]
    )
    added_edges = tuple(after_edges[key] for key in sorted(after_edges.keys() - before_edges.keys()))
    removed_edges = tuple(before_edges[key] for key in sorted(before_edges.keys() - after_edges.keys()))
    changed_edges = tuple(
        EdgeChange(id=key, before=before_edges[key], after=after_edges[key])
        for key in sorted(shared_edge_ids)
        if before_edges[key] != after_edges[key]
    )

    changed_node_ids = {
        *(node.id for node in added_nodes),
        *(node.id for node in removed_nodes),
        *(change.id for change in changed_nodes),
    }
    changed_node_ids.update(
        endpoint
        for edge in (*added_edges, *removed_edges, *(item.after for item in changed_edges))
        for endpoint in (edge.source_id, edge.target_id)
    )

    # Traverse only relationships that carry support, reference, applicability,
    # sequence, or prerequisite semantics. Party/event association alone does
    # not imply that another record changed.
    propagation_edges: dict[str, TwinEdge] = {**before_edges, **after_edges}
    dependents: dict[str, list[tuple[str, str]]] = {}
    for edge in propagation_edges.values():
        if edge.kind in {EdgeType.SUPPORTS, EdgeType.CONTRADICTS, EdgeType.APPLIES_TO, EdgeType.LEADS_TO}:
            prerequisite, dependent = edge.source_id, edge.target_id
        elif edge.kind in {EdgeType.REFERENCES, EdgeType.DEPENDS_ON}:
            prerequisite, dependent = edge.target_id, edge.source_id
        else:
            continue
        dependents.setdefault(prerequisite, []).append((dependent, edge.id))

    impacted_nodes: set[str] = set()
    impacted_edges: set[str] = set()
    pending = list(sorted(changed_node_ids))
    visited = set(changed_node_ids)
    while pending:
        prerequisite = pending.pop(0)
        for dependent, edge_id in sorted(dependents.get(prerequisite, ()), key=lambda item: (item[0], item[1])):
            impacted_edges.add(edge_id)
            if dependent in visited:
                continue
            visited.add(dependent)
            impacted_nodes.add(dependent)
            pending.append(dependent)

    all_nodes = {**before_nodes, **after_nodes}
    affected_ids = changed_node_ids | impacted_nodes
    affected_actions = tuple(sorted(
        node_id for node_id in affected_ids
        if node_id in all_nodes and all_nodes[node_id].kind == NodeType.ACTION
    ))
    impacted_documents = tuple(sorted(
        node_id for node_id in affected_ids
        if node_id in all_nodes and all_nodes[node_id].kind == NodeType.DOCUMENT
    ))
    stale_draft_documents = tuple(sorted(
        node_id for node_id in affected_ids
        if node_id in all_nodes
        and all_nodes[node_id].kind == NodeType.DOCUMENT
        and all_nodes[node_id].properties.get("is_draft") is True
    ))
    readiness_changes = tuple(
        ActionReadinessChange(
            id=node_id,
            before_status=before_nodes[node_id].properties.get("readiness_status"),
            after_status=after_nodes[node_id].properties.get("readiness_status"),
        )
        for node_id in sorted(shared_node_ids)
        if before_nodes[node_id].kind == NodeType.ACTION
        and before_nodes[node_id].properties.get("readiness_status")
        != after_nodes[node_id].properties.get("readiness_status")
    )

    return SnapshotComparison(
        before_as_of=first.as_of,
        after_as_of=second.as_of,
        added_nodes=added_nodes,
        removed_nodes=removed_nodes,
        changed_nodes=changed_nodes,
        added_edges=added_edges,
        removed_edges=removed_edges,
        changed_edges=changed_edges,
        changed_context=tuple(
            ContextChange(
                key=key,
                before=first.context.get(key),
                after=second.context.get(key),
                before_present=key in first.context,
                after_present=key in second.context,
            )
            for key in sorted(first.context.keys() | second.context.keys())
            if key not in first.context or key not in second.context or first.context[key] != second.context[key]
        ),
        impacted_node_ids=tuple(sorted(impacted_nodes)),
        impacted_edge_ids=tuple(sorted(impacted_edges)),
        affected_action_ids=affected_actions,
        impacted_document_ids=impacted_documents,
        stale_draft_document_ids=stale_draft_documents,
        action_readiness_changes=readiness_changes,
    )


def unresolved_nodes(source: LegalTwin | TimelineSnapshot) -> tuple[TwinNode, ...]:
    """Return nodes explicitly marked unknown, conflicting, or assumed."""

    if isinstance(source, LegalTwin):
        nodes = source.nodes.values()
    elif isinstance(source, TimelineSnapshot):
        nodes = source.nodes
    else:
        raise TypeError("source must be a LegalTwin or TimelineSnapshot")
    return tuple(sorted(
        (node for node in nodes if node.status in {"unknown", "conflicting", "assumption"}),
        key=lambda node: node.id,
    ))
