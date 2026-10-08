import type { EvidenceProvenance } from '@/lib/api';

export type EvidenceMapStatus = 'evidence-supported' | 'user-reported' | 'review-confirmed' | 'pending' | 'unknown' | 'conflict' | 'system-inferred' | 'assumption';
export type EvidenceMapLayer = 'claim-fact' | 'evidence' | 'case-intake' | 'document' | 'finding' | 'confirmation';

export interface EvidenceMapNode {
  id: string;
  layer: EvidenceMapLayer;
  title: string;
  detail: string;
  status: EvidenceMapStatus;
  documentId?: string;
  evidenceId?: string;
  pageNumber?: number;
  provenance?: EvidenceProvenance;
  confirmedByUser?: boolean;
  confirmedAt?: string | null;
}

export interface EvidenceMapRelationship {
  id: string;
  from: EvidenceMapNode;
  to: EvidenceMapNode;
  label: string;
  reason: string;
  status: EvidenceMapStatus;
  provenance: string[];
  focus?: {
    documentId: string;
    evidenceId?: string;
    pageNumber?: number;
  };
}

export interface EvidenceMapPath {
  id: string;
  relationships: EvidenceMapRelationship[];
  nodes: [EvidenceMapNode, EvidenceMapNode, EvidenceMapNode, EvidenceMapNode, EvidenceMapNode];
}

export interface EvidenceMapFocusRequest {
  documentId: string;
  evidenceId?: string;
  pageNumber?: number;
  requestId: number;
}
