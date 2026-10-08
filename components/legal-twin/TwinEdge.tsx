import type { KeyboardEvent, MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { statusColor, TWIN_COLORS } from './semantics';
import type { TwinEdgeData } from './types';
import type { TwinProjectedPosition } from './TwinNode';

export interface TwinEdgeProps {
  edge: TwinEdgeData;
  source: TwinProjectedPosition;
  target: TwinProjectedPosition;
  sourceLabel?: string;
  targetLabel?: string;
  markerId?: string;
  selected?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  reducedMotion?: boolean;
  onSelect?: (edge: TwinEdgeData) => void;
}

function handleKeyDown(event: KeyboardEvent<SVGGElement>, onSelect: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onSelect();
  }
}

export function TwinEdge({
  edge,
  source,
  target,
  sourceLabel = edge.source,
  targetLabel = edge.target,
  markerId,
  selected = false,
  highlighted = false,
  dimmed = false,
  reducedMotion = false,
  onSelect,
}: TwinEdgeProps) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const startX = source.x + (dx / length) * 13;
  const startY = source.y + (dy / length) * 13;
  const endX = target.x - (dx / length) * 14;
  const endY = target.y - (dy / length) * 14;
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const color = statusColor(edge.status) ?? TWIN_COLORS.neutral;
  const activate = () => onSelect?.(edge);

  return (
    <g
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={
        onSelect
          ? `${edge.label}: ${sourceLabel} ${edge.directed === false ? 'related to' : 'to'} ${targetLabel}`
          : undefined
      }
      aria-pressed={onSelect ? selected : undefined}
      className={onSelect
        ? 'group cursor-pointer outline-none transition-opacity duration-300 ease-out motion-reduce:transition-none'
        : 'transition-opacity duration-300 ease-out motion-reduce:transition-none'}
      opacity={dimmed ? 0.16 : highlighted ? 1 : 0.76}
      onClick={(event: MouseEvent<SVGGElement>) => {
        event.stopPropagation();
        activate();
      }}
      onKeyDown={onSelect ? (event) => handleKeyDown(event, activate) : undefined}
    >
      <line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={endY}
        stroke="transparent"
        strokeWidth={14}
      />
      {onSelect && (
        <line
          className="pointer-events-none opacity-0 group-focus-visible:opacity-100"
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke="#f8fafc"
          strokeWidth={4}
          strokeDasharray="2 3"
        />
      )}
      <motion.line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={endY}
        stroke={selected ? '#f8fafc' : color}
        strokeWidth={selected ? 2.6 : highlighted ? 2 : 1.4}
        strokeDasharray={edge.status === 'unknown' ? '2 4' : edge.status === 'uncertain' ? '5 4' : edge.status === 'user_reported' ? '1 3' : undefined}
        markerEnd={edge.directed === false || !markerId ? undefined : `url(#${markerId})`}
        pointerEvents="none"
        initial={reducedMotion ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reducedMotion ? 0 : 0.48, ease: 'easeOut' }}
      />
      {edge.label && (
        <text
          x={midX}
          y={midY - 5}
          textAnchor="middle"
          fill={selected ? '#f8fafc' : color}
          fontSize={10}
          paintOrder="stroke"
          stroke="#0b1220"
          strokeWidth={4}
          strokeLinejoin="round"
          pointerEvents="none"
        >
          {edge.label.length > 28 ? `${edge.label.slice(0, 26)}…` : edge.label}
        </text>
      )}
    </g>
  );
}
