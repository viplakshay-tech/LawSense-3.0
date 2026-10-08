import type { KeyboardEvent, MouseEvent } from 'react';
import { nodeColor } from './semantics';
import type { TwinNodeData } from './types';

export interface TwinProjectedPosition {
  x: number;
  y: number;
  depth?: number;
}

export interface TwinNodeProps {
  node: TwinNodeData;
  position: TwinProjectedPosition;
  selected?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  onSelect?: (node: TwinNodeData) => void;
}

function handleKeyDown(event: KeyboardEvent<SVGGElement>, onSelect: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onSelect();
  }
}

export function TwinNode({
  node,
  position,
  selected = false,
  highlighted = false,
  dimmed = false,
  onSelect,
}: TwinNodeProps) {
  const color = nodeColor(node.category, node.status);
  const activate = () => onSelect?.(node);
  const ariaLabel = `${node.category.replace('_', ' ')}: ${node.label}${
    node.status ? `, ${node.status}` : ''
  }`;

  return (
    <g
      transform={`translate(${position.x} ${position.y})`}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={onSelect ? ariaLabel : undefined}
      aria-pressed={onSelect ? selected : undefined}
      className={onSelect
        ? 'group cursor-pointer outline-none transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none'
        : 'transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none'}
      opacity={dimmed ? 0.28 : 1}
      onClick={(event: MouseEvent<SVGGElement>) => {
        event.stopPropagation();
        activate();
      }}
      onKeyDown={onSelect ? (event) => handleKeyDown(event, activate) : undefined}
    >
      {onSelect && (
        <circle
          className="pointer-events-none opacity-0 group-focus-visible:opacity-100"
          r={20}
          fill="none"
          stroke="#f8fafc"
          strokeWidth={1.5}
          strokeDasharray="2 3"
        />
      )}
      {(selected || highlighted) && (
        <circle
          r={selected ? 17 : 14}
          fill="none"
          stroke={selected ? '#f8fafc' : color}
          strokeWidth={selected ? 2 : 1.5}
          strokeDasharray={selected ? undefined : '3 3'}
          opacity={0.9}
        />
      )}
      <circle
        r={10}
        fill="#0b1220"
        stroke={color}
        strokeWidth={selected ? 3 : 2}
      />
      <circle r={3} fill={color} />
      <text
        y={25}
        textAnchor="middle"
        fill={dimmed ? '#64748b' : '#e2e8f0'}
        fontSize={12}
        fontWeight={selected ? 700 : 500}
        aria-hidden="true"
      >
        {node.label.length > 22 ? `${node.label.slice(0, 20)}…` : node.label}
      </text>
      <text
        y={39}
        textAnchor="middle"
        fill={color}
        fontSize={8}
        letterSpacing="0.08em"
        aria-hidden="true"
      >
        {node.category.replace('_', ' ')}
      </text>
    </g>
  );
}
