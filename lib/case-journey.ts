import type { CaseState, JourneyStageName } from './api';

export const CASE_JOURNEY_STAGES = [
  { id: 'understand', name: 'UNDERSTAND', label: 'Understand', apiStages: ['UNDERSTAND'] },
  { id: 'clarify', name: 'CLARIFY', label: 'Clarify', apiStages: ['FACTS'] },
  { id: 'protect', name: 'PROTECT', label: 'Protect', apiStages: [] },
  { id: 'evidence', name: 'EVIDENCE', label: 'Evidence', apiStages: ['EVIDENCE'] },
  { id: 'law', name: 'LAW', label: 'Law', apiStages: ['LAW'] },
  { id: 'twin', name: 'CASE TWIN', label: 'Case Twin', apiStages: [] },
  { id: 'prepare', name: 'PREPARE', label: 'Prepare', apiStages: ['OPTIONS'] },
  { id: 'act', name: 'ACT', label: 'Act', apiStages: ['NEXT_STEP'] },
  { id: 'monitor', name: 'MONITOR', label: 'Monitor', apiStages: [] },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  label: string;
  apiStages: readonly JourneyStageName[];
}>;

export type CaseJourneyStageId = (typeof CASE_JOURNEY_STAGES)[number]['id'];
export type CaseJourneyStageStatus = 'Complete' | 'In progress' | 'Needs review' | 'Available';

const COMPLETE_STATUSES = new Set(['complete', 'completed', 'done', 'finished']);
const ACTIVE_STATUSES = new Set(['active', 'current', 'in_progress', 'started']);
const BLOCKED_STATUSES = new Set(['blocked', 'needs_review', 'needs_attention']);

export function getCaseJourneyStageStatus(
  caseState: CaseState | null,
  stageId: CaseJourneyStageId,
): CaseJourneyStageStatus {
  const stage = CASE_JOURNEY_STAGES.find((item) => item.id === stageId);
  const apiStages: readonly JourneyStageName[] = stage?.apiStages ?? [];
  const matched = caseState?.analysis?.journey.steps.find((step) =>
    apiStages.includes(step.stage),
  );
  if (!matched) return 'Available';

  const status = matched.status.toLocaleLowerCase();
  if (COMPLETE_STATUSES.has(status)) return 'Complete';
  if (BLOCKED_STATUSES.has(status)) return 'Needs review';
  if (ACTIVE_STATUSES.has(status)) return 'In progress';
  return 'Available';
}

