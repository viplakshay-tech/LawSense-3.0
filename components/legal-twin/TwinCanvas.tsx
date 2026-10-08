'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { isActiveAt, nodeColor, parseTwinTime } from './semantics';
import { TwinEdge } from './TwinEdge';
import { TwinNode, type TwinProjectedPosition } from './TwinNode';
import type {
  TwinEdgeData,
  TwinNodeData,
  TwinPosition,
  TwinSnapshotData,
  TwinEvidenceStatus,
  TwinTemporalValue,
} from './types';

const WIDTH = 1000;
const HEIGHT = 620;
const MAX_FORCE_LAYOUT_NODES = 160;
const TRANSITION_MS = 720;

export interface TwinCanvasProps {
  nodes: readonly TwinNodeData[];
  edges: readonly TwinEdgeData[];
  currentTime?: TwinTemporalValue | null;
  snapshots?: readonly TwinSnapshotData[];
  selectedNode?: string | null;
  selectedEdge?: string | null;
  visibleNodeIds?: ReadonlySet<string>;
  highlightedRecordIds?: ReadonlySet<string>;
  currentTimeLabel?: string;
  emptyMessage?: string;
  onNodeSelect?: (node: TwinNodeData | null) => void;
  onEdgeSelect?: (edge: TwinEdgeData | null) => void;
  onCurrentTimeChange?: (currentTime: TwinTemporalValue | null) => void;
  className?: string;
  ariaLabel?: string;
}

type MutablePosition = TwinPosition;

function categoryAnchor(categoryIndex: number): TwinPosition {
  const column = categoryIndex % 3;
  const row = Math.floor(categoryIndex / 3);

  return {
    x: (column - 1) * 170,
    y: (row - 1) * 145,
    z: (categoryIndex % 2 === 0 ? -1 : 1) * 28,
  };
}

function buildLayout(
  nodes: readonly TwinNodeData[],
  edges: readonly TwinEdgeData[],
): Map<string, TwinPosition> {
  if (!nodes.length) return new Map();

  const categories = new Map<string, number>();
  const categoryMembers = new Map<string, TwinNodeData[]>();

  nodes.forEach((node) => {
    if (!categories.has(node.category)) {
      categories.set(node.category, categories.size);
    }

    const members = categoryMembers.get(node.category) ?? [];
    members.push(node);
    categoryMembers.set(node.category, members);
  });

  const origins = new Map<string, TwinPosition>();
  const positions = new Map<string, MutablePosition>();

  for (const node of nodes) {
    const categoryIndex = categories.get(node.category) ?? 0;
    const members = categoryMembers.get(node.category) ?? [node];
    const memberIndex = members.indexOf(node);

    const columns = Math.min(5, Math.max(1, members.length));
    const rows = Math.ceil(members.length / columns);
    const anchor = categoryAnchor(categoryIndex);

    const generated = {
      x: anchor.x + ((memberIndex % columns) - (columns - 1) / 2) * 34,
      y:
        anchor.y +
        (Math.floor(memberIndex / columns) - (rows - 1) / 2) * 34,
      z: anchor.z + ((memberIndex % 3) - 1) * 14,
    };

    const position = node.position ?? generated;

    origins.set(node.id, position);
    positions.set(node.id, { ...position });
  }

  if (nodes.length <= MAX_FORCE_LAYOUT_NODES) {
    const validEdges = edges.flatMap((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);

      return source && target
        ? [
            {
              sourceId: edge.source,
              targetId: edge.target,
              source,
              target,
            },
          ]
        : [];
    });

    for (let iteration = 0; iteration < 18; iteration += 1) {
      const forces = new Map<string, MutablePosition>();

      nodes.forEach((node) => {
        forces.set(node.id, { x: 0, y: 0, z: 0 });
      });

      for (
        let leftIndex = 0;
        leftIndex < nodes.length;
        leftIndex += 1
      ) {
        const leftNode = nodes[leftIndex];
        const left = positions.get(leftNode.id);

        if (!left) continue;

        for (
          let rightIndex = leftIndex + 1;
          rightIndex < nodes.length;
          rightIndex += 1
        ) {
          const rightNode = nodes[rightIndex];
          const right = positions.get(rightNode.id);

          if (!right) continue;

          const dx = left.x - right.x;
          const dy = left.y - right.y;
          const dz = left.z - right.z;

          const distanceSquared =
            dx * dx + dy * dy + dz * dz + 250;

          const forceScale =
            720 /
            (distanceSquared * Math.sqrt(distanceSquared));

          const leftForce = forces.get(leftNode.id);
          const rightForce = forces.get(rightNode.id);

          if (leftForce) {
            leftForce.x += dx * forceScale;
            leftForce.y += dy * forceScale;
            leftForce.z += dz * forceScale;
          }

          if (rightForce) {
            rightForce.x -= dx * forceScale;
            rightForce.y -= dy * forceScale;
            rightForce.z -= dz * forceScale;
          }
        }
      }

      for (const link of validEdges) {
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const dz = link.target.z - link.source.z;

        const distance = Math.hypot(dx, dy, dz) || 1;
        const forceScale = ((distance - 118) / distance) * 0.018;

        const sourceForce = forces.get(link.sourceId);
        const targetForce = forces.get(link.targetId);

        if (sourceForce) {
          sourceForce.x += dx * forceScale;
          sourceForce.y += dy * forceScale;
          sourceForce.z += dz * forceScale;
        }

        if (targetForce) {
          targetForce.x -= dx * forceScale;
          targetForce.y -= dy * forceScale;
          targetForce.z -= dz * forceScale;
        }
      }

      for (const node of nodes) {
        if (node.position) continue;

        const position = positions.get(node.id);
        const origin = origins.get(node.id);
        const force = forces.get(node.id);

        if (!position || !origin || !force) continue;

        const moves = [
          Math.max(
            -4,
            Math.min(
              4,
              force.x + (origin.x - position.x) * 0.004,
            ),
          ),
          Math.max(
            -4,
            Math.min(
              4,
              force.y + (origin.y - position.y) * 0.004,
            ),
          ),
          Math.max(
            -4,
            Math.min(
              4,
              force.z + (origin.z - position.z) * 0.004,
            ),
          ),
        ];

        position.x += moves[0];
        position.y += moves[1];
        position.z += moves[2];
      }
    }
  }

  return positions;
}

function projectLayout(
  layout: Map<string, TwinPosition>,
  yaw: number,
  zoom: number,
  focusId?: string | null,
): Map<string, TwinProjectedPosition> {
  const pitch = 0.72;
  const projected = new Map<string, TwinProjectedPosition>();

  const raw: Array<{
    id: string;
    x: number;
    y: number;
    depth: number;
  }> = [];

  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  for (const [id, point] of layout) {
    const rotatedX =
      point.x * cosYaw - point.y * sinYaw;

    const rotatedY =
      point.x * sinYaw + point.y * cosYaw;

    raw.push({
      id,
      x: rotatedX,
      y: rotatedY * sinPitch - point.z * cosPitch,
      depth:
        rotatedY * cosPitch + point.z * sinPitch,
    });
  }

  const minX = Math.min(...raw.map((point) => point.x), 0);
  const maxX = Math.max(...raw.map((point) => point.x), 0);
  const minY = Math.min(...raw.map((point) => point.y), 0);
  const maxY = Math.max(...raw.map((point) => point.y), 0);

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const scale =
    Math.min(760 / spanX, 405 / spanY, 1.4) * zoom;

  const averageX = (minX + maxX) / 2;
  const averageY = (minY + maxY) / 2;
  const focus = raw.find((point) => point.id === focusId);
  const centerX = focus ? lerp(averageX, focus.x, 0.38) : averageX;
  const centerY = focus ? lerp(averageY, focus.y, 0.38) : averageY;

  for (const point of raw) {
    projected.set(point.id, {
      x:
        WIDTH / 2 +
        (point.x - centerX) * scale,
      y:
        HEIGHT / 2 +
        (point.y - centerY) * scale,
      depth: point.depth,
    });
  }

  return projected;
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function formatEvidenceStatus(status: TwinEvidenceStatus | undefined): string {
  switch (status) {
    case 'supported': return 'Evidence-supported';
    case 'user_reported': return 'User-reported';
    case 'uncertain': return 'Uncertain';
    case 'conflict': return 'Conflicting';
    case 'unknown':
    default: return 'Unknown';
  }
}

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function interpolateProjection(
  from: Map<string, TwinProjectedPosition>,
  to: Map<string, TwinProjectedPosition>,
  progress: number,
): Map<string, TwinProjectedPosition> {
  const next = new Map<string, TwinProjectedPosition>();

  for (const [id, target] of to) {
    const previous = from.get(id);

    if (!previous) {
      next.set(id, {
        x: target.x,
        y: target.y,
        depth: target.depth ?? 0,
      });
      continue;
    }

    next.set(id, {
      x: lerp(previous.x, target.x, progress),
      y: lerp(previous.y, target.y, progress),
      depth: lerp(
        previous.depth ?? 0,
        target.depth ?? 0,
        progress,
      ),
    });
  }

  return next;
}

export function TwinCanvas({
  nodes,
  edges,
  currentTime = null,
  snapshots = [],
  selectedNode = null,
  selectedEdge = null,
  visibleNodeIds: requestedVisibleNodeIds,
  highlightedRecordIds = new Set<string>(),
  currentTimeLabel,
  emptyMessage,
  onNodeSelect,
  onEdgeSelect,
  onCurrentTimeChange,
  className = '',
  ariaLabel = 'Legal twin relationship graph',
}: TwinCanvasProps) {
  const reactId = useId();

  const markerId = `twin-arrow-${reactId.replace(
    /[^a-zA-Z0-9_-]/g,
    '',
  )}`;

  const [yaw, setYaw] = useState(0.52);
  const [zoom, setZoom] = useState(1);
  const [prefersReducedMotion, setPrefersReducedMotion] =
    useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const animationFrameRef =
    useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [labelScale, setLabelScale] = useState(1);

  const [animatedProjection, setAnimatedProjection] =
    useState<Map<string, TwinProjectedPosition>>(
      new Map(),
    );

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    );

    const update = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    update();
    mediaQuery.addEventListener('change', update);

    return () => {
      mediaQuery.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? svg.clientWidth;
      if (!width) return;
      setLabelScale(Math.max(1, Math.min(4, WIDTH / width)));
    });

    resizeObserver.observe(svg);
    return () => resizeObserver.disconnect();
  }, []);

  const snapshotAtTime = useMemo(() => {
    const timestamp = parseTwinTime(currentTime);

    if (timestamp === null) return undefined;

    return snapshots.find(
      (snapshot) =>
        snapshot.graph &&
        parseTwinTime(snapshot.at) === timestamp,
    );
  }, [currentTime, snapshots]);

  const graph = snapshotAtTime?.graph ?? {
    nodes,
    edges,
  };

  const visibleNodes = useMemo(
    () =>
      (snapshotAtTime
        ? graph.nodes
        : graph.nodes.filter((node) =>
            isActiveAt(
              node.validFrom,
              node.validTo,
              currentTime,
            ),
          )).filter((node) => !requestedVisibleNodeIds || requestedVisibleNodeIds.has(node.id)),
    [
      currentTime,
      graph.nodes,
      requestedVisibleNodeIds,
      snapshotAtTime,
    ],
  );

  const visibleNodeIds = useMemo(
    () =>
      new Set(
        visibleNodes.map((node) => node.id),
      ),
    [visibleNodes],
  );

  const visibleNodeById = useMemo(
    () =>
      new Map(
        visibleNodes.map((node) => [node.id, node]),
      ),
    [visibleNodes],
  );

  const visibleEdges = useMemo(
    () =>
      (
        snapshotAtTime
          ? graph.edges
          : graph.edges.filter((edge) =>
              isActiveAt(
                edge.validFrom,
                edge.validTo,
                currentTime,
              ),
            )
      ).filter(
        (edge) =>
          visibleNodeIds.has(edge.source) &&
          visibleNodeIds.has(edge.target),
      ),
    [
      currentTime,
      graph.edges,
      snapshotAtTime,
      visibleNodeIds,
    ],
  );

  const layout = useMemo(
    () => buildLayout(graph.nodes, graph.edges),
    [graph.edges, graph.nodes],
  );

  const targetProjection = useMemo(
    () =>
      projectLayout(
        layout,
        yaw,
        zoom,
        selectedNode,
      ),
    [layout, selectedNode, yaw, zoom],
  );

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const previous = animatedProjection.size
      ? animatedProjection
      : targetProjection;

    if (
      prefersReducedMotion ||
      previous.size === 0
    ) {
      animationFrameRef.current =
        requestAnimationFrame(() => {
          animationFrameRef.current = null;
          setAnimatedProjection(targetProjection);
        });

      return () => {
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      };
    }

    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const rawProgress = Math.min(
        1,
        elapsed / TRANSITION_MS,
      );

      const progress = easeInOutCubic(
        rawProgress,
      );

      setAnimatedProjection(
        interpolateProjection(
          previous,
          targetProjection,
          progress,
        ),
      );

      if (rawProgress < 1) {
        animationFrameRef.current =
          requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current =
      requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(
          animationFrameRef.current,
        );
      }
    };
    // Intentionally animate from the existing rendered projection
    // toward the new target projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    targetProjection,
    prefersReducedMotion,
  ]);

  const projection =
    !prefersReducedMotion && animatedProjection.size > 0
      ? animatedProjection
      : targetProjection;

  const visibleSelectedNode =
    selectedNode &&
    visibleNodeIds.has(selectedNode)
      ? selectedNode
      : null;

  const sortedNodes = useMemo(
    () =>
      [...visibleNodes].sort(
        (left, right) =>
          (projection.get(left.id)?.depth ?? 0) -
          (projection.get(right.id)?.depth ?? 0),
      ),
    [projection, visibleNodes],
  );

  const selectedEdgeData =
    visibleEdges.find(
      (edge) => edge.id === selectedEdge,
    );

  const focusedNodeIds = useMemo(() => {
    if (visibleSelectedNode) {
      const ids = new Set([
        visibleSelectedNode,
      ]);

      visibleEdges.forEach((edge) => {
        if (
          edge.source === visibleSelectedNode
        ) {
          ids.add(edge.target);
        }

        if (
          edge.target === visibleSelectedNode
        ) {
          ids.add(edge.source);
        }
      });

      return ids;
    }

    if (selectedEdgeData) {
      return new Set([
        selectedEdgeData.source,
        selectedEdgeData.target,
      ]);
    }

    return null;
  }, [
    selectedEdgeData,
    visibleSelectedNode,
    visibleEdges,
  ]);

  const statusCounts = useMemo(
    () =>
      visibleNodes.reduce(
        (counts, node) => {
          const status =
            node.status ?? 'unknown';

          if (status === 'supported') {
            counts.supported += 1;
          } else if (status === 'user_reported') {
            counts.userReported += 1;
          } else if (status === 'uncertain') {
            counts.uncertain += 1;
          } else if (
            status === 'conflict'
          ) {
            counts.conflict += 1;
          } else if (
            status === 'safety'
          ) {
            counts.safety += 1;
          } else {
            counts.unknown += 1;
          }

          return counts;
        },
        {
          supported: 0,
          userReported: 0,
          uncertain: 0,
          conflict: 0,
          safety: 0,
          unknown: 0,
        },
      ),
    [visibleNodes],
  );
  const hoveredNode = visibleNodes.find((node) => node.id === hoveredNodeId);

  function clearSelection() {
    onNodeSelect?.(null);
    onEdgeSelect?.(null);
  }

  return (
    <figure
      className={`relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#070b13] ${className}`}
    >
      <style>{`
        @keyframes lawsense-twin-pulse {
          0%, 100% { opacity: .38; }
          50% { opacity: .78; }
        }

        @keyframes lawsense-twin-confirmation {
          0% { opacity: .78; transform: scale(.72); }
          100% { opacity: 0; transform: scale(1.7); }
        }

        .lawsense-twin-pulse {
          animation: lawsense-twin-pulse 2.6s ease-in-out infinite;
        }

        .lawsense-twin-confirmation-ring {
          transform-box: fill-box;
          transform-origin: center;
          animation: lawsense-twin-confirmation 900ms ease-out 2;
        }

        @media (prefers-reduced-motion: reduce) {
          .lawsense-twin-pulse,
          .lawsense-twin-confirmation-ring {
            animation: none !important;
          }
        }
      `}</style>

      <figcaption className="relative z-10 flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)] lawsense-twin-pulse" />
            <h2 className="text-sm font-semibold text-slate-100">
              CaseState graph
            </h2>
          </div>

          <p className="mt-1 text-xs text-slate-400">
            {visibleNodes.length} nodes · {visibleEdges.length} relationships
            {snapshotAtTime
              ? ` · ${snapshotAtTime.label}`
              : currentTimeLabel
                ? ` · ${currentTimeLabel}`
                : ''}
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-xs text-emerald-100">
              {statusCounts.supported} evidence-supported
            </span>

            <span className="rounded-full border border-blue-400/20 bg-blue-400/[0.08] px-2.5 py-1 text-xs text-blue-100">
              {statusCounts.userReported} user-reported
            </span>
            <span className="rounded-full border border-amber-400/25 bg-amber-400/[0.08] px-2.5 py-1 text-xs text-amber-100">
              {statusCounts.uncertain} uncertain
            </span>
            <span className="rounded-full border border-rose-400/25 bg-rose-400/[0.08] px-2.5 py-1 text-xs text-rose-100">
              {statusCounts.conflict + statusCounts.safety} conflicting
            </span>
            <span className="rounded-full border border-slate-400/20 bg-slate-400/[0.07] px-2.5 py-1 text-xs text-slate-200">
              {statusCounts.unknown} unknown
            </span>
          </div>
        </div>

        <div
          className="flex items-center gap-1"
          aria-label="Graph view controls"
        >
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            onClick={() =>
              setYaw(
                (value) =>
                  value - Math.PI / 8,
              )
            }
            aria-label="Rotate graph left"
            title="Rotate graph left"
          >
            ←
          </button>

          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            onClick={() =>
              setYaw(
                (value) =>
                  value + Math.PI / 8,
              )
            }
            aria-label="Rotate graph right"
            title="Rotate graph right"
          >
            →
          </button>

          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            onClick={() =>
              setZoom((value) =>
                Math.max(
                  0.65,
                  value - 0.15,
                ),
              )
            }
            aria-label="Zoom out"
          >
            −
          </button>

          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            onClick={() =>
              setZoom((value) =>
                Math.min(
                  1.75,
                  value + 0.15,
                ),
              )
            }
            aria-label="Zoom in"
          >
            +
          </button>

          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            onClick={() => {
              setYaw(0.52);
              setZoom(1);
            }}
          >
            Reset
          </button>
        </div>
      </figcaption>

      <div className="pointer-events-none absolute inset-x-0 top-[92px] h-32 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.08),transparent_68%)]" />

      <div className="relative overflow-hidden">
        {visibleNodes.length === 0 ? (
          <div className="flex min-h-[24rem] items-center justify-center px-6 text-center">
            <p className="max-w-md text-sm leading-6 text-slate-400">
              {emptyMessage ?? (nodes.length === 0
                ? 'No graph data was supplied.'
                : 'No nodes are active at this point in the timeline.')}
            </p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="group"
            aria-label={ariaLabel}
            className="block h-auto min-h-[22rem] w-full touch-pan-y select-none"
            onClick={clearSelection}
          >
            <title>{ariaLabel}</title>

            <desc>
              Animated accessible projection of the supplied legal graph.
              Timeline changes smoothly move the graph between legal states.
              The SVG works without WebGL.
            </desc>

            <defs>
              <marker
                id={markerId}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  fill="#94a3b8"
                />
              </marker>
            </defs>

            <AnimatePresence initial={!prefersReducedMotion}>
              {visibleEdges.map((edge) => {
                const source = projection.get(edge.source);
                const target = projection.get(edge.target);

                if (!source || !target) return null;

                const selected = edge.id === selectedEdge;

                const highlighted =
                  selected ||
                  (!!visibleSelectedNode &&
                    (edge.source === visibleSelectedNode ||
                      edge.target === visibleSelectedNode));

                return (
                  <motion.g
                    key={`edge:${edge.id}`}
                    initial={prefersReducedMotion ? false : { opacity: 0 }}
                    animate={{ opacity: highlighted ? 1 : 0.78 }}
                    exit={{ opacity: 0, transition: { duration: prefersReducedMotion ? 0 : 0.18 } }}
                    transition={{ duration: prefersReducedMotion ? 0 : 0.34, ease: 'easeOut' }}
                  >
                    <TwinEdge
                      edge={edge}
                      source={source}
                      target={target}
                      sourceLabel={
                        visibleNodeById.get(edge.source)?.label
                      }
                      targetLabel={
                        visibleNodeById.get(edge.target)?.label
                      }
                      markerId={markerId}
                      selected={selected}
                      highlighted={highlighted}
                      dimmed={!!focusedNodeIds && !highlighted}
                      reducedMotion={prefersReducedMotion}
                      onSelect={(nextEdge) => {
                        onEdgeSelect?.(nextEdge);
                        onNodeSelect?.(visibleNodeById.get(nextEdge.source) ?? null);
                      }}
                    />
                  </motion.g>
                );
              })}
            </AnimatePresence>

            <AnimatePresence initial={!prefersReducedMotion}>
              {sortedNodes.map((node) => {
                const position = projection.get(node.id);

                if (!position) return null;

                const isSelected =
                  node.id === visibleSelectedNode;

                const isHighlighted =
                  !!focusedNodeIds?.has(node.id) &&
                  !isSelected;

                const isDimmed =
                  !!focusedNodeIds &&
                  !focusedNodeIds.has(node.id);

                return (
                  <motion.g
                    key={`node:${node.id}`}
                    initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.84 }}
                    animate={{ opacity: isDimmed ? 0.22 : 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.84, transition: { duration: prefersReducedMotion ? 0 : 0.2 } }}
                    transition={{ duration: prefersReducedMotion ? 0 : 0.42, ease: [0.22, 1, 0.36, 1] }}
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  >
                    <TwinNode
                      node={node}
                      position={position}
                      selected={isSelected}
                      highlighted={isHighlighted}
                      dimmed={isDimmed}
                      labelScale={labelScale}
                      confirmed={!prefersReducedMotion && node.status === 'supported' && highlightedRecordIds.has(`node:${node.id}`)}
                      onHover={(hovered) => setHoveredNodeId(hovered?.id ?? null)}
                      onSelect={(nextNode) => {
                        onNodeSelect?.(nextNode);
                        onEdgeSelect?.(null);
                      }}
                    />
                  </motion.g>
                );
              })}
            </AnimatePresence>
          </svg>
        )}
        <AnimatePresence mode="wait" initial={false}>
          {hoveredNode && (
            <motion.div
              key={hoveredNode.id}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -4 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.18 }}
              className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[min(26rem,calc(100%-1.5rem))] rounded-xl border border-white/10 bg-[#101827]/95 px-3.5 py-3 shadow-xl backdrop-blur"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-200">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: nodeColor(hoveredNode.category, hoveredNode.status) }} />
                {hoveredNode.category.replaceAll('_', ' ')} · {formatEvidenceStatus(hoveredNode.status)}
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-100">{hoveredNode.label}</p>
              {hoveredNode.description && <p className="mt-1 line-clamp-3 text-sm leading-5 text-slate-300">{hoveredNode.description}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] px-4 py-3 text-sm leading-5 text-slate-300">
        <span>
          Only recorded CaseState records are shown. Position is for readability and does not imply legal weight.
        </span>

        {currentTimeLabel && <span className="font-mono text-xs text-slate-300">Temporal view · {currentTimeLabel}</span>}

        {currentTime !== null &&
          currentTime !== undefined &&
          onCurrentTimeChange && (
            <button
              type="button"
              className="underline decoration-slate-600 underline-offset-2 transition hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              onClick={() =>
                onCurrentTimeChange(null)
              }
            >
              Clear time filter
            </button>
          )}
      </div>
    </figure>
  );
}
