import type {
  GuideAction,
  GuideActionContext,
  GuideActionType,
} from './types';

type GuideActionOf<Type extends GuideActionType> = Extract<GuideAction, { type: Type }>;

export type GuideActionDefinition = {
  [Type in GuideActionType]: {
    type: Type;
    resolve: (context: GuideActionContext) => readonly GuideActionOf<Type>[];
  };
}[GuideActionType];

export interface GuideActionRegistry {
  getAvailableActions(context: GuideActionContext): readonly GuideAction[];
  isAvailable(action: GuideAction, context: GuideActionContext): boolean;
}

function sameAction(left: GuideAction, right: GuideAction): boolean {
  return left.type === right.type && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}

/** Build an immutable policy registry from typed, per-action availability rules. */
export function createGuideActionRegistry(
  definitions: readonly GuideActionDefinition[],
): GuideActionRegistry {
  function getAvailableActions(context: GuideActionContext): readonly GuideAction[] {
    const actions: GuideAction[] = [];
    for (const definition of definitions) {
      actions.push(...definition.resolve(context));
    }
    return actions;
  }

  return {
    getAvailableActions,
    isAvailable: (action, context) =>
      getAvailableActions(context).some((candidate) => sameAction(candidate, action)),
  };
}

function hasClarificationRequest(caseState: NonNullable<GuideActionContext['caseState']>): boolean {
  return caseState.unknowns.some((item) => item.trim().length > 0)
    || (caseState.analysis?.journey.unknowns.some((item) => item.question.trim().length > 0) ?? false);
}

function hasEvidence(caseState: NonNullable<GuideActionContext['caseState']>): boolean {
  return caseState.evidence.length > 0
    || caseState.documents.length > 0
    || caseState.facts.some((fact) => fact.status === 'evidence_supported')
    || (caseState.analysis?.journey.requiredEvidence.length ?? 0) > 0
    || (caseState.analysis?.journey.requiredDocuments.length ?? 0) > 0;
}

function hasLegalSources(caseState: NonNullable<GuideActionContext['caseState']>): boolean {
  const knowledge = caseState.analysis?.legalKnowledge;
  return knowledge?.status === 'records_found' && knowledge.records.length > 0;
}

function getRecommendedNavigationTarget(caseState: NonNullable<GuideActionContext['caseState']>) {
  const safetyContext = caseState.analysis?.safetyContext;
  if (safetyContext && safetyContext.context !== 'none') return 'safety' as const;
  if (hasClarificationRequest(caseState)) return 'case' as const;
  if (hasEvidence(caseState)) return 'documents' as const;
  if (hasLegalSources(caseState) || caseState.legalIssues.length > 0) return 'guide' as const;
  if (caseState.analysis?.journey) return 'journey' as const;
  return 'case' as const;
}

const guideActionDefinitions: readonly GuideActionDefinition[] = [
  {
    type: 'ASK_CLARIFICATION',
    resolve: ({ caseState }) => {
      if (!caseState) return [];
      const sources: Array<'case_state' | 'journey'> = [];
      if (caseState.unknowns.some((item) => item.trim())) sources.push('case_state');
      if (caseState.analysis?.journey.unknowns.some((item) => item.question.trim())) {
        sources.push('journey');
      }
      return sources.length
        ? [{ type: 'ASK_CLARIFICATION', payload: { caseId: caseState.id, sources } }]
        : [];
    },
  },
  {
    type: 'SHOW_EVIDENCE',
    resolve: ({ caseState }) => {
      if (!caseState) return [];
      const evidenceIds = caseState.evidence.map((item) => item.id);
      const documentIds = caseState.documents.map((document) => document.id);
      const sourceIds = [...new Set(
        caseState.facts
          .filter((fact) => fact.status === 'evidence_supported')
          .flatMap((fact) => fact.sourceIds),
      )];
      const journey = caseState.analysis?.journey;
      return evidenceIds.length || documentIds.length || sourceIds.length
        || (journey?.requiredEvidence.length ?? 0) > 0
        || (journey?.requiredDocuments.length ?? 0) > 0
        ? [{
            type: 'SHOW_EVIDENCE',
            payload: { caseId: caseState.id, evidenceIds, documentIds, sourceIds },
          }]
        : [];
    },
  },
  {
    type: 'SHOW_LEGAL_GROUNDING',
    resolve: ({ caseState }) => {
      const legalKnowledge = caseState?.analysis?.legalKnowledge;
      const journey = caseState?.analysis?.journey;
      const hasLegalStage = journey?.steps.some((step) => step.stage === 'LAW' || step.stage === 'OPTIONS');
      if (!caseState || (!legalKnowledge && !hasLegalStage && caseState.legalIssues.length === 0)) return [];
      return [{
        type: 'SHOW_LEGAL_GROUNDING',
        payload: {
          caseId: caseState.id,
          recordIds: legalKnowledge?.records.map((record) => record.id) ?? [],
        },
      }];
    },
  },
  {
    type: 'OPEN_JOURNEY',
    resolve: ({ caseState }) => caseState?.analysis?.journey
      ? [{ type: 'OPEN_JOURNEY', payload: { caseId: caseState.id } }]
      : [],
  },
  {
    type: 'SHOW_TWIN',
    resolve: ({ caseState }) => caseState
      ? [{ type: 'SHOW_TWIN', payload: { caseId: caseState.id } }]
      : [],
  },
  {
    type: 'START_VOICE',
    resolve: ({ caseState }) => caseState
      ? [{ type: 'START_VOICE', payload: { caseId: caseState.id } }]
      : [],
  },
  {
    type: 'SPEAK_RESPONSE',
    resolve: ({ response }) => response?.text.trim()
      ? [{ type: 'SPEAK_RESPONSE', payload: { response } }]
      : [],
  },
  {
    type: 'OPEN_SAFETY',
    resolve: ({ caseState }) => {
      const context = caseState?.analysis?.safetyContext;
      return caseState && context && context.context !== 'none'
        ? [{ type: 'OPEN_SAFETY', payload: { caseId: caseState.id, context } }]
        : [];
    },
  },
  {
    type: 'NAVIGATE',
    resolve: ({ caseState }) => caseState
      ? [{
          type: 'NAVIGATE',
          payload: { caseId: caseState.id, target: getRecommendedNavigationTarget(caseState) },
        }]
      : [],
  },
];

export const defaultGuideActionRegistry = createGuideActionRegistry(guideActionDefinitions);
