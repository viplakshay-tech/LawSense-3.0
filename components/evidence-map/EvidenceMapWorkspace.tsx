'use client';

import { useRef, useState } from 'react';
import { DocumentReviewWorkspace } from '@/components/document-review/DocumentReviewWorkspace';
import { useCaseState } from '@/app/case/[id]/CaseStateProvider';
import { EvidenceMap } from './EvidenceMap';
import type { EvidenceMapFocusRequest, EvidenceMapRelationship } from './types';

export function EvidenceMapWorkspace({ caseId }: { caseId: string }) {
  const { caseState } = useCaseState();
  const requestSequence = useRef(0);
  const [focusRequest, setFocusRequest] = useState<EvidenceMapFocusRequest | null>(null);

  function focusSource(relationship: EvidenceMapRelationship) {
    if (!relationship.focus) return;
    setFocusRequest({ ...relationship.focus, requestId: ++requestSequence.current });
  }

  return (
    <div className="space-y-6">
      {caseState && <EvidenceMap caseState={caseState} caseId={caseId} onOpenSource={focusSource} />}
      <DocumentReviewWorkspace caseId={caseId} focusRequest={focusRequest} />
    </div>
  );
}
