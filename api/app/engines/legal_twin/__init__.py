"""In-memory Legal Twin graph, timeline, and point-in-time projections."""

from app.engines.legal_twin.builder import build_legal_twin, build_twin
from app.engines.legal_twin.engine import (
    compare_snapshots,
    generate_timeline,
    snapshot_at,
    unresolved_nodes,
)
from app.engines.legal_twin.models import (
    ActionReadinessChange,
    ContextChange,
    EdgeChange,
    EdgeType,
    InformationStatus,
    LegalTwin,
    NodeChange,
    NodeType,
    SnapshotComparison,
    TimelineEvent,
    TimelineSnapshot,
    TwinEdge,
    TwinNode,
    TwinProvenance,
)

generate_snapshot = snapshot_at

__all__ = [
    "ActionReadinessChange",
    "ContextChange",
    "EdgeChange",
    "EdgeType",
    "InformationStatus",
    "LegalTwin",
    "NodeChange",
    "NodeType",
    "SnapshotComparison",
    "TimelineEvent",
    "TimelineSnapshot",
    "TwinEdge",
    "TwinNode",
    "TwinProvenance",
    "build_legal_twin",
    "build_twin",
    "compare_snapshots",
    "generate_snapshot",
    "generate_timeline",
    "snapshot_at",
    "unresolved_nodes",
]
