export const TWIN_NODE_CATEGORIES = [
  'PERSON',
  'PARTY',
  'EVENT',
  'FACT',
  'CLAIM',
  'DOCUMENT',
  'EVIDENCE',
  'LEGAL_ISSUE',
  'LAW',
  'PROCEDURE',
  'AUTHORITY',
  'ACTION',
] as const;

export type TwinNodeCategory = (typeof TWIN_NODE_CATEGORIES)[number];
export type TwinTemporalValue = string | number;
export type TwinEvidenceStatus =
  | 'supported'
  | 'user_reported'
  | 'uncertain'
  | 'unknown'
  | 'conflict'
  | 'safety';

export interface TwinPosition {
  x: number;
  y: number;
  z: number;
}

export interface TwinNodeData {
  id: string;
  category: TwinNodeCategory;
  label: string;
  description?: string;
  status?: TwinEvidenceStatus;
  position?: TwinPosition;
  occurredAt?: TwinTemporalValue;
  validFrom?: TwinTemporalValue;
  validTo?: TwinTemporalValue;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface TwinEdgeData {
  id: string;
  source: string;
  target: string;
  label: string;
  description?: string;
  status?: TwinEvidenceStatus;
  directed?: boolean;
  validFrom?: TwinTemporalValue;
  validTo?: TwinTemporalValue;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface TwinSnapshotData {
  id: string;
  label: string;
  at: TwinTemporalValue;
  description?: string;
  graph?: {
    nodes: readonly TwinNodeData[];
    edges: readonly TwinEdgeData[];
  };
}

export interface TwinGraphData {
  nodes: readonly TwinNodeData[];
  edges: readonly TwinEdgeData[];
}
