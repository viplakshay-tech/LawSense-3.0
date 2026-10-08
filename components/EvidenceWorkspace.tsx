'use client';

import { DocumentReviewWorkspace } from '@/components/document-review/DocumentReviewWorkspace';

export function EvidenceWorkspace({ caseId }: { caseId: string }) {
  return <DocumentReviewWorkspace caseId={caseId} embedded />;
}
