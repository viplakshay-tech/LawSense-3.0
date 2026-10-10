"""Local, provenance-preserving graph and timeline models for a legal case.

The models describe recorded information only. They do not determine whether an
assertion is legally valid or predict what a court or other decision maker will do.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from enum import Enum
from hashlib import sha256
import re
from types import MappingProxyType
from typing import Any, Mapping


class NodeType(str, Enum):
    PERSON = "PERSON"
    PARTY = "PARTY"
    EVENT = "EVENT"
    FACT = "FACT"
    CLAIM = "CLAIM"
    DOCUMENT = "DOCUMENT"
    EVIDENCE = "EVIDENCE"
    LEGAL_ISSUE = "LEGAL_ISSUE"
    LAW = "LAW"
    PROCEDURE = "PROCEDURE"
    AUTHORITY = "AUTHORITY"
    ACTION = "ACTION"


class EdgeType(str, Enum):
    INVOLVES = "INVOLVES"
    OCCURRED_AT = "OCCURRED_AT"
    SUPPORTS = "SUPPORTS"
    CONTRADICTS = "CONTRADICTS"
    REFERENCES = "REFERENCES"
    RELATES_TO = "RELATES_TO"
    APPLIES_TO = "APPLIES_TO"
    LEADS_TO = "LEADS_TO"
    PROCEDURE_AVAILABLE_AT_AUTHORITY = "PROCEDURE_AVAILABLE_AT_AUTHORITY"
    DEPENDS_ON = "DEPENDS_ON"


class InformationStatus(str, Enum):
    USER_REPORTED = "user_reported"
    EVIDENCE_SUPPORTED = "evidence_supported"
    SYSTEM_INFERRED = "system_inferred"
    ASSUMPTION = "assumption"
    CONFLICTING = "conflicting"
    UNKNOWN = "unknown"


_UNRESOLVED_STATUSES = {
    InformationStatus.ASSUMPTION.value,
    InformationStatus.CONFLICTING.value,
    InformationStatus.UNKNOWN.value,
}


def normalize_datetime(value: datetime | date | str | None) -> datetime | None:
    """Parse ISO dates/timestamps and normalize them to timezone-aware UTC."""

    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, time.min)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = datetime.combine(date.fromisoformat(text), time.min)
            except ValueError:
                normalized = re.sub(
                    r"(?<=\d)(?:st|nd|rd|th)\b",
                    "",
                    text,
                    flags=re.IGNORECASE,
                ).replace(",", "")
                parsed = None
                for pattern in (
                    "%B %d %Y",
                    "%b %d %Y",
                    "%d %B %Y",
                    "%d %b %Y",
                    "%d/%m/%Y",
                    "%d-%m-%Y",
                    "%d.%m.%Y",
                ):
                    try:
                        parsed = datetime.strptime(normalized, pattern)
                        break
                    except ValueError:
                        continue
                if parsed is None:
                    return None
    else:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({str(key): _freeze(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, set):
        return frozenset(_freeze(item) for item in value)
    return value


def _thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_thaw(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return [_thaw(item) for item in value]
    return value


@dataclass(frozen=True, slots=True)
class TwinProvenance:
    """Where a graph item came from and the source's information status."""

    source_id: str
    source_type: str
    source_path: str
    status: str = InformationStatus.UNKNOWN.value
    confidence: float | None = None
    page_number: int | None = None
    extraction_method: str | None = None
    details: str | None = None
    confirmed_by_user: bool = False
    confirmed_at: str | None = None

    def __post_init__(self) -> None:
        if not self.source_id.strip() or not self.source_path.strip():
            raise ValueError("provenance source_id and source_path must be non-empty")
        if self.confidence is not None and not 0 <= self.confidence <= 1:
            raise ValueError("provenance confidence must be between 0 and 1")


def _fallback_provenance(status: str) -> tuple[TwinProvenance, ...]:
    return (
        TwinProvenance(
            source_id="unavailable",
            source_type="unspecified",
            source_path="unavailable",
            status=status,
            details="No source provenance was supplied.",
        ),
    )


@dataclass(frozen=True, slots=True)
class TwinNode:
    id: str
    kind: NodeType
    label: str
    status: str = InformationStatus.UNKNOWN.value
    provenance: tuple[TwinProvenance, ...] = ()
    properties: Mapping[str, Any] = field(default_factory=dict)
    occurred_at: datetime | None = None
    recorded_at: datetime | None = None

    def __post_init__(self) -> None:
        if not self.id.strip() or not self.label.strip():
            raise ValueError("node id and label must be non-empty")
        object.__setattr__(self, "kind", NodeType(self.kind))
        object.__setattr__(self, "properties", _freeze(self.properties))
        object.__setattr__(self, "provenance", tuple(self.provenance) or _fallback_provenance(self.status))
        object.__setattr__(self, "occurred_at", normalize_datetime(self.occurred_at))
        object.__setattr__(self, "recorded_at", normalize_datetime(self.recorded_at))


@dataclass(frozen=True, slots=True)
class TwinEdge:
    source_id: str
    target_id: str
    kind: EdgeType
    status: str = InformationStatus.UNKNOWN.value
    provenance: tuple[TwinProvenance, ...] = ()
    recorded_at: datetime | None = None
    id: str = ""

    def __post_init__(self) -> None:
        if not self.source_id.strip() or not self.target_id.strip():
            raise ValueError("edge endpoints must be non-empty")
        object.__setattr__(self, "kind", EdgeType(self.kind))
        object.__setattr__(self, "provenance", tuple(self.provenance) or _fallback_provenance(self.status))
        object.__setattr__(self, "recorded_at", normalize_datetime(self.recorded_at))
        if not self.id:
            # Keep separate evidence paths as separate edges even when they
            # connect the same two nodes with the same relation.
            source_key = "\x1e".join(sorted(
                f"{item.source_type}\x1f{item.source_id}\x1f{item.source_path}"
                for item in self.provenance
            ))
            key = f"{self.kind.value}\x1f{self.source_id}\x1f{self.target_id}\x1f{source_key}"
            object.__setattr__(self, "id", "edge_" + sha256(key.encode("utf-8")).hexdigest()[:20])


@dataclass(frozen=True, slots=True)
class TimelineEvent:
    id: str
    kind: str
    summary: str
    occurred_at: datetime | None
    date_value: str | None
    date_precision: str
    related_node_ids: tuple[str, ...] = ()
    status: str = InformationStatus.UNKNOWN.value
    provenance: tuple[TwinProvenance, ...] = ()

    def __post_init__(self) -> None:
        if not self.id.strip() or not self.kind.strip() or not self.summary.strip():
            raise ValueError("timeline event id, kind, and summary must be non-empty")
        object.__setattr__(self, "occurred_at", normalize_datetime(self.occurred_at))
        object.__setattr__(self, "related_node_ids", tuple(self.related_node_ids))
        object.__setattr__(self, "provenance", tuple(self.provenance) or _fallback_provenance(self.status))


@dataclass(frozen=True, slots=True)
class TimelineSnapshot:
    case_id: str
    as_of: datetime
    nodes: tuple[TwinNode, ...]
    edges: tuple[TwinEdge, ...]
    timeline: tuple[TimelineEvent, ...]
    context: Mapping[str, Any] = field(default_factory=dict)
    temporally_uncertain_context_keys: tuple[str, ...] = ()
    unresolved_node_ids: tuple[str, ...] = ()
    temporally_uncertain_node_ids: tuple[str, ...] = ()
    limitations: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        cutoff = normalize_datetime(self.as_of)
        if cutoff is None:
            raise ValueError("snapshot as_of must be a valid date or datetime")
        object.__setattr__(self, "as_of", cutoff)
        object.__setattr__(self, "context", _freeze(self.context))
        for name in ("nodes", "edges", "timeline", "temporally_uncertain_context_keys", "unresolved_node_ids", "temporally_uncertain_node_ids", "limitations"):
            object.__setattr__(self, name, tuple(getattr(self, name)))


@dataclass(frozen=True, slots=True)
class NodeChange:
    id: str
    before: TwinNode
    after: TwinNode


@dataclass(frozen=True, slots=True)
class EdgeChange:
    id: str
    before: TwinEdge
    after: TwinEdge


@dataclass(frozen=True, slots=True)
class ContextChange:
    key: str
    before: Any
    after: Any
    before_present: bool
    after_present: bool


@dataclass(frozen=True, slots=True)
class ActionReadinessChange:
    id: str
    before_status: str | None
    after_status: str | None


@dataclass(frozen=True, slots=True)
class SnapshotComparison:
    before_as_of: datetime
    after_as_of: datetime
    added_nodes: tuple[TwinNode, ...]
    removed_nodes: tuple[TwinNode, ...]
    changed_nodes: tuple[NodeChange, ...]
    added_edges: tuple[TwinEdge, ...]
    removed_edges: tuple[TwinEdge, ...]
    changed_edges: tuple[EdgeChange, ...]
    changed_context: tuple[ContextChange, ...] = ()
    impacted_node_ids: tuple[str, ...] = ()
    impacted_edge_ids: tuple[str, ...] = ()
    affected_action_ids: tuple[str, ...] = ()
    impacted_document_ids: tuple[str, ...] = ()
    stale_draft_document_ids: tuple[str, ...] = ()
    action_readiness_changes: tuple[ActionReadinessChange, ...] = ()


@dataclass(slots=True)
class LegalTwin:
    """An in-memory, directed graph for one CaseState."""

    case_id: str
    nodes: dict[str, TwinNode] = field(default_factory=dict)
    edges: dict[str, TwinEdge] = field(default_factory=dict)
    timeline: tuple[TimelineEvent, ...] = ()
    context: Mapping[str, Any] = field(default_factory=dict)
    context_recorded_at: Mapping[str, datetime | None] = field(default_factory=dict)
    captured_at: datetime | None = None

    def __post_init__(self) -> None:
        if not self.case_id.strip():
            raise ValueError("case_id must be non-empty")
        self.nodes = dict(self.nodes)
        self.edges = dict(self.edges)
        self.timeline = tuple(self.timeline)
        self.context = _freeze(self.context)
        self.context_recorded_at = _freeze({key: normalize_datetime(value) for key, value in self.context_recorded_at.items()})
        self.captured_at = normalize_datetime(self.captured_at)
        for key, node in self.nodes.items():
            if key != node.id:
                raise ValueError("node mapping keys must match node ids")
        for key, edge in self.edges.items():
            if key != edge.id:
                raise ValueError("edge mapping keys must match edge ids")
            if edge.source_id not in self.nodes or edge.target_id not in self.nodes:
                raise ValueError(f"edge {edge.id} refers to a missing node")

    def add_node(self, node: TwinNode) -> None:
        existing = self.nodes.get(node.id)
        if existing is not None and existing != node:
            raise ValueError(f"node id already exists with different data: {node.id}")
        self.nodes[node.id] = node

    def add_edge(self, edge: TwinEdge) -> None:
        if edge.source_id not in self.nodes or edge.target_id not in self.nodes:
            raise ValueError("both edge endpoints must exist in the twin")
        existing = self.edges.get(edge.id)
        if existing is not None and existing != edge:
            raise ValueError(f"edge id already exists with different data: {edge.id}")
        self.edges[edge.id] = edge

    def generate_timeline(self) -> tuple[TimelineEvent, ...]:
        return tuple(sorted(self.timeline, key=_timeline_sort_key))

    def snapshot_at(self, point_in_time: datetime | date | str) -> TimelineSnapshot:
        from app.engines.legal_twin.engine import snapshot_at

        return snapshot_at(self, point_in_time)

    def compare(self, first: TimelineSnapshot, second: TimelineSnapshot) -> SnapshotComparison:
        from app.engines.legal_twin.engine import compare_snapshots

        if first.case_id != self.case_id or second.case_id != self.case_id:
            raise ValueError("snapshots must belong to this LegalTwin")
        return compare_snapshots(first, second)

    def unresolved_nodes(self) -> tuple[TwinNode, ...]:
        return tuple(
            node for node in sorted(self.nodes.values(), key=lambda item: item.id)
            if node.status in _UNRESOLVED_STATUSES
        )


def _timeline_sort_key(item: TimelineEvent) -> tuple[int, datetime, str]:
    if item.occurred_at is None:
        return (1, datetime.max.replace(tzinfo=timezone.utc), item.id)
    return (0, item.occurred_at, item.id)


def thaw_properties(properties: Mapping[str, Any]) -> dict[str, Any]:
    """Return a mutable JSON-like copy for a new node or serialization."""

    return _thaw(properties)
