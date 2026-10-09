import type {
  CaseState,
  JourneyExecutionResponse,
  JourneyExecutionStageName,
  JourneyStageName,
} from './api';

export const CASE_JOURNEY_STAGES = [
  {
    id: 'understand',
    name: 'UNDERSTAND',
    label: 'Understand',
    journeyStages: ['UNDERSTAND'],
    executionStages: ['Problem'],
    readinessDimensions: ['facts'],
  },
  {
    id: 'clarify',
    name: 'CLARIFY',
    label: 'Clarify',
    journeyStages: ['FACTS'],
    executionStages: ['Clarify', 'Facts'],
    readinessDimensions: ['facts'],
  },
  {
    id: 'protect',
    name: 'PROTECT',
    label: 'Protect',
    journeyStages: [],
    executionStages: [],
    readinessDimensions: ['safety'],
  },
  {
    id: 'evidence',
    name: 'EVIDENCE',
    label: 'Evidence',
    journeyStages: ['EVIDENCE'],
    executionStages: ['Evidence'],
    readinessDimensions: ['evidence'],
  },
  {
    id: 'law',
    name: 'LAW',
    label: 'Law',
    journeyStages: ['LAW'],
    executionStages: ['Law'],
    readinessDimensions: ['legal_grounding', 'jurisdiction'],
  },
  {
    id: 'twin',
    name: 'LIVING CASE TWIN',
    label: 'Living Case Twin',
    journeyStages: [],
    executionStages: [],
    readinessDimensions: [],
  },
  {
    id: 'prepare',
    name: 'PREPARE',
    label: 'Prepare',
    journeyStages: ['OPTIONS'],
    executionStages: ['Possible Paths', 'Document'],
    readinessDimensions: ['documents', 'procedure'],
  },
  {
    id: 'act',
    name: 'ACT',
    label: 'Act',
    journeyStages: ['NEXT_STEP'],
    executionStages: ['Action'],
    readinessDimensions: ['procedure'],
  },
  {
    id: 'monitor',
    name: 'MONITOR',
    label: 'Monitor',
    journeyStages: [],
    executionStages: ['Follow-up'],
    readinessDimensions: ['procedure'],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  label: string;
  journeyStages: readonly JourneyStageName[];
  executionStages: readonly JourneyExecutionStageName[];
  readinessDimensions: readonly string[];
}>;

export type CaseJourneyStageId = (typeof CASE_JOURNEY_STAGES)[number]['id'];
export type CaseJourneyStageStatus = 'Complete' | 'In progress' | 'Blocked' | 'Available' | 'Unknown';

type CaseJourneyStageDefinition = {
  id: string;
  name: string;
  label: string;
  journeyStages: readonly JourneyStageName[];
  executionStages: readonly JourneyExecutionStageName[];
  readinessDimensions: readonly string[];
};

export interface CaseJourneyStageAssessment {
  status: CaseJourneyStageStatus;
  blockers: string[];
  unknowns: string[];
}

const COMPLETE_STATUSES = new Set(['complete', 'completed', 'done', 'finished']);
const ACTIVE_STATUSES = new Set(['active', 'current', 'in_progress', 'started', 'waiting']);
const BLOCKED_STATUSES = new Set(['blocked', 'needs_review', 'needs review', 'needs_attention', 'needs attention']);
const OPEN_REQUEST_STATUSES = new Set(['not_confirmed', 'unavailable']);

function normalize(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase().replaceAll('_', ' ') ?? '';
}

function statusFromLabel(value: string | null | undefined): CaseJourneyStageStatus | null {
  const status = normalize(value);
  if (COMPLETE_STATUSES.has(status)) return 'Complete';
  if (BLOCKED_STATUSES.has(status)) return 'Blocked';
  if (ACTIVE_STATUSES.has(status)) return 'In progress';
  if (status === 'available' || status === 'not started' || status === 'proposed' || status === 'planned') {
    return 'Available';
  }
  if (status === 'unknown' || status === 'unavailable') return 'Unknown';
  return null;
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function getStageBlockers(
  stage: CaseJourneyStageDefinition,
  execution: JourneyExecutionResponse | null,
): string[] {
  if (!execution) return [];
  const stageNames = new Set<string>(stage.executionStages);
  const executionBlockers = execution.execution.blockers
    .filter((item) => stageNames.has(item.stage))
    .map((item) => item.message);
  const readinessBlockers = (execution.execution.case_readiness?.blockers ?? [])
    .filter((item) => stage.readinessDimensions.includes(item.dimension))
    .map((item) => item.message);
  return unique([...executionBlockers, ...readinessBlockers]).slice(0, 3);
}

function getStageUnknowns(
  caseState: CaseState | null,
  execution: JourneyExecutionResponse | null,
  stageId: string,
): string[] {
  if (stageId === 'understand' || stageId === 'clarify') {
    return unique([
      ...(caseState?.unknowns ?? []),
      ...(caseState?.analysis?.journey.unknowns ?? []).map((item) => item.question),
      ...(execution?.execution.missing_information ?? [])
        .filter((item) => item.status === 'open')
        .map((item) => item.question),
    ]).slice(0, 3);
  }

  if (stageId === 'protect') {
    return unique((execution?.execution.missing_information ?? [])
      .filter((item) => item.status === 'open')
      .filter((item) => `${item.related_to ?? ''} ${item.question}`.toLocaleLowerCase()
        .match(/safety|danger|threat|violence|unsafe/))
      .map((item) => item.question)).slice(0, 3);
  }

  if (stageId === 'evidence') {
    return unique((execution?.execution.evidence_requests ?? [])
      .filter((item) => OPEN_REQUEST_STATUSES.has(item.status))
      .map((item) => item.status === 'unavailable'
        ? `Evidence unavailable: ${item.item}`
        : `Evidence not confirmed: ${item.item}`)).slice(0, 3);
  }

  if (stageId === 'prepare') {
    return unique((execution?.execution.document_requests ?? [])
      .filter((item) => OPEN_REQUEST_STATUSES.has(item.status))
      .map((item) => item.status === 'unavailable'
        ? `Document unavailable: ${item.document}`
        : `Document not confirmed: ${item.document}`)).slice(0, 3);
  }

  return [];
}

function getReadinessStatus(
  stage: CaseJourneyStageDefinition,
  execution: JourneyExecutionResponse | null,
): CaseJourneyStageStatus | null {
  const dimensions = execution?.execution.case_readiness?.dimensions
    .filter((item) => stage.readinessDimensions.includes(item.name)) ?? [];
  if (dimensions.length === 0) return null;
  if (dimensions.some((item) => item.level === 'blocked')) return 'Blocked';
  if (dimensions.some((item) => item.level === 'partial')) return 'In progress';
  if (dimensions.some((item) => item.level === 'unknown')) return 'Unknown';
  return 'Available';
}

function getExplicitExecutionStatus(
  stage: CaseJourneyStageDefinition,
  execution: JourneyExecutionResponse | null,
): CaseJourneyStageStatus | null {
  const state = execution?.execution;
  if (!state || stage.executionStages.length === 0) return null;
  const progress = state.stage_progress.filter((item) => stage.executionStages.includes(item.stage));
  if (progress.length !== stage.executionStages.length) return null;

  const stageBlockers = getStageBlockers(stage, execution);
  if (
    stageBlockers.length > 0
    || state.blocked_stages.some((item) => stage.executionStages.includes(item))
  ) return 'Blocked';

  const validCompletion = progress.every((item) =>
    item.completed && state.completed_stages.includes(item.stage),
  );
  if (validCompletion) return 'Complete';

  if (stage.executionStages.includes(state.current_stage)) return 'In progress';
  if (progress.some((item) => item.inputs.length > 0)) return 'In progress';

  if (stage.id === 'act' || stage.id === 'monitor') {
    const actions = state.action_plan.filter((item) => stage.executionStages.includes(item.stage));
    if (actions.some((item) => item.status === 'IN_PROGRESS' || item.status === 'WAITING')) {
      return 'In progress';
    }
    if (actions.length > 0 && actions.every((item) => item.status === 'BLOCKED')) return 'Blocked';
  }

  const readinessStatus = getReadinessStatus(stage, execution);
  if (readinessStatus) return readinessStatus;
  return 'Available';
}

function getJourneySummaryStatus(
  caseState: CaseState | null,
  stage: CaseJourneyStageDefinition,
): CaseJourneyStageStatus | null {
  if (!caseState?.analysis?.journey || stage.journeyStages.length === 0) return null;
  const steps = caseState.analysis.journey.steps.filter((item) => stage.journeyStages.includes(item.stage));
  if (steps.length === 0) return null;
  const statuses = steps.map((item) => statusFromLabel(item.status)).filter(
    (item): item is CaseJourneyStageStatus => item !== null,
  );
  if (statuses.length === 0) return null;
  if (statuses.includes('Blocked')) return 'Blocked';
  if (statuses.includes('In progress')) return 'In progress';
  if (statuses.every((item) => item === 'Complete')) return 'Complete';
  if (statuses.includes('Unknown')) return 'Unknown';
  return 'Available';
}

function getSafetyStatus(
  caseState: CaseState | null,
  execution: JourneyExecutionResponse | null,
): CaseJourneyStageStatus {
  const safetyContext = execution?.execution.safety_context
    ?? caseState?.analysis?.safetyContext.context;
  if (!safetyContext || safetyContext === 'unknown') return 'Unknown';

  const stage = CASE_JOURNEY_STAGES.find((item) => item.id === 'protect')!;
  const readinessStatus = getReadinessStatus(stage, execution);
  if (readinessStatus === 'Blocked' || getStageBlockers(stage, execution).length > 0) return 'Blocked';
  if (readinessStatus === 'In progress') return 'In progress';
  if (safetyContext !== 'none') return 'In progress';
  return readinessStatus ?? 'Available';
}

function getTwinStatus(caseState: CaseState | null): CaseJourneyStageStatus {
  if (!caseState) return 'Unknown';
  const hasSavedTwinSource = Boolean(
    caseState.initialStatement?.trim()
    || caseState.facts.length
    || caseState.events.length
    || caseState.claims.length
    || caseState.evidence.length
    || caseState.documents.length
    || caseState.legalIssues.length,
  );
  return hasSavedTwinSource ? 'Available' : 'Unknown';
}

export function getCaseJourneyStageAssessment(
  caseState: CaseState | null,
  executionResponse: JourneyExecutionResponse | null,
  stageId: CaseJourneyStageId | string,
): CaseJourneyStageAssessment {
  const stage = CASE_JOURNEY_STAGES.find((item) => item.id === stageId);
  if (!stage) return { status: 'Unknown', blockers: [], unknowns: [] };

  const execution = executionResponse && caseState && executionResponse.caseId !== caseState.id
    ? null
    : executionResponse;
  const blockers = getStageBlockers(stage, execution);
  const unknowns = getStageUnknowns(caseState, execution, stage.id);

  if (stage.id === 'protect') {
    return { status: getSafetyStatus(caseState, execution), blockers, unknowns };
  }
  if (stage.id === 'twin') {
    return { status: getTwinStatus(caseState), blockers, unknowns };
  }

  const executionStatus = getExplicitExecutionStatus(stage, execution);
  const journeyStatus = getJourneySummaryStatus(caseState, stage);
  const status = journeyStatus === 'Blocked' || executionStatus === 'Blocked'
    ? 'Blocked'
    : executionStatus === 'Complete'
      ? 'Complete'
      : executionStatus === 'In progress' || journeyStatus === 'In progress'
        ? 'In progress'
        : executionStatus === 'Available' && journeyStatus === 'Complete'
          ? 'In progress'
          : executionStatus ?? journeyStatus ?? 'Unknown';
  return { status, blockers, unknowns };
}

export function getCaseJourneyStageStatus(
  caseState: CaseState | null,
  executionResponse: JourneyExecutionResponse | null,
  stageId: CaseJourneyStageId | string,
): CaseJourneyStageStatus {
  return getCaseJourneyStageAssessment(caseState, executionResponse, stageId).status;
}
