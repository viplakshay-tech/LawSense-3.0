import type { CaseState, InformationStatus } from '@/lib/api';
import type {
  GuideEvent,
  GuideInformationSnapshot,
  GuideStateName,
  GuideStateReason,
  GuideStateSnapshot,
} from './types';

const UNCERTAIN_INFORMATION_STATUSES = new Set<InformationStatus>([
  'unknown',
  'assumption',
  'system_inferred',
]);

function summarizeInformation(caseState: CaseState | null): GuideInformationSnapshot {
  if (!caseState) {
    return {
      unknowns: [],
      assumptions: [],
      conflicts: [],
      facts: [],
      claims: [],
      evidence: [],
      documents: [],
    };
  }

  return {
    unknowns: [...caseState.unknowns],
    assumptions: [...caseState.assumptions],
    conflicts: [...caseState.conflicts],
    facts: caseState.facts.map(({ id, status, sourceIds }) => ({
      id,
      status,
      sourceIds: [...sourceIds],
    })),
    claims: caseState.claims.map(({ id, status, evidenceIds }) => ({
      id,
      status,
      evidenceIds: [...evidenceIds],
    })),
    evidence: caseState.evidence.map(({ id, status, documentId }) => ({
      id,
      status,
      documentId,
    })),
    documents: caseState.documents.map(({ id, processingStatus, reviewStatus }) => ({
      id,
      processingStatus,
      reviewStatus,
    })),
  };
}

function makeSnapshot(
  name: GuideStateName,
  reason: GuideStateReason,
  caseState: CaseState | null,
  error?: string,
): GuideStateSnapshot {
  const safetyContext = caseState?.analysis?.safetyContext;

  return {
    name,
    reason,
    caseId: caseState?.id ?? null,
    information: summarizeInformation(caseState),
    ...(safetyContext && safetyContext.context !== 'none' ? { safetyContext } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

function hasConflict(caseState: CaseState): boolean {
  return (
    caseState.conflicts.length > 0 ||
    caseState.facts.some((fact) => fact.status === 'conflicting') ||
    caseState.claims.some((claim) => claim.status === 'conflicting') ||
    caseState.evidence.some(
      (item) => item.status === 'conflicting' || item.conflictsWithClaimIds.length > 0,
    )
  );
}

function hasClarificationRequest(caseState: CaseState): boolean {
  return (
    caseState.unknowns.some((question) => question.trim().length > 0) ||
    (caseState.analysis?.journey.unknowns.some((item) => item.question.trim().length > 0) ?? false)
  );
}

function hasUncertainInformation(caseState: CaseState): boolean {
  const hasUncertainRecord =
    caseState.facts.some((fact) => UNCERTAIN_INFORMATION_STATUSES.has(fact.status)) ||
    caseState.claims.some((claim) => UNCERTAIN_INFORMATION_STATUSES.has(claim.status)) ||
    caseState.evidence.some((item) => UNCERTAIN_INFORMATION_STATUSES.has(item.status));

  return (
    hasUncertainRecord ||
    caseState.assumptions.some((assumption) => assumption.trim().length > 0) ||
    caseState.jurisdiction.basis === 'inferred' ||
    caseState.jurisdiction.basis === 'unknown'
  );
}

function hasEvidence(caseState: CaseState): boolean {
  return (
    caseState.evidence.length > 0 ||
    caseState.documents.length > 0 ||
    caseState.facts.some((fact) => fact.status === 'evidence_supported')
  );
}

function hasNextAction(caseState: CaseState): boolean {
  return (
    (caseState.analysis?.journey.nextActions.length ?? 0) > 0 ||
    Boolean(caseState.analysis?.decisionScenario?.nextAction.trim())
  );
}

function hasLegalSources(caseState: CaseState): boolean {
  const legalKnowledge = caseState.analysis?.legalKnowledge;
  return legalKnowledge?.status === 'records_found' && legalKnowledge.records.length > 0;
}

function hasCompletedJourney(caseState: CaseState): boolean {
  const journey = caseState.analysis?.journey;
  const completedStatuses = new Set(['complete', 'completed', 'done', 'finished']);
  return Boolean(
    journey &&
      journey.steps.length > 0 &&
      journey.steps.every((step) => completedStatuses.has(step.status.toLocaleLowerCase())) &&
      journey.nextActions.length === 0 &&
      journey.unknowns.length === 0 &&
      caseState.unknowns.length === 0 &&
      caseState.conflicts.length === 0,
  );
}

/**
 * Selects one deterministic state from the canonical case record. This is a
 * prioritization signal only; all source statuses remain available verbatim in
 * `information` and are never collapsed into a fact or claim by the runtime.
 */
export function deriveGuideState(caseState: CaseState | null): GuideStateSnapshot {
  if (!caseState) return makeSnapshot('idle', 'no_case_loaded', null);

  const safetyContext = caseState.analysis?.safetyContext;
  if (safetyContext && safetyContext.context !== 'none') {
    return makeSnapshot('safety', 'safety_context_present', caseState);
  }

  if (hasConflict(caseState)) {
    return makeSnapshot('conflict', 'case_conflict_present', caseState);
  }

  if (caseState.evidence.some((item) => item.processingStatus === 'processing')) {
    return makeSnapshot('processing', 'evidence_processing', caseState);
  }

  if (hasCompletedJourney(caseState)) {
    return makeSnapshot('completion', 'journey_complete', caseState);
  }

  if (hasClarificationRequest(caseState)) {
    return makeSnapshot('asking', 'clarification_required', caseState);
  }

  if (hasUncertainInformation(caseState)) {
    return makeSnapshot('uncertain', 'information_uncertain', caseState);
  }

  if (hasLegalSources(caseState)) {
    return makeSnapshot('grounded', 'legal_sources_available', caseState);
  }

  if (hasEvidence(caseState)) {
    return makeSnapshot('evidence', 'evidence_available', caseState);
  }

  if (hasNextAction(caseState)) {
    return makeSnapshot('action', 'next_action_recorded', caseState);
  }

  if (!caseState.initialStatement?.trim()) {
    return makeSnapshot('idle', 'initial_account_missing', caseState);
  }

  if (!caseState.analysis) {
    return makeSnapshot('idle', 'analysis_unavailable', caseState);
  }

  return makeSnapshot('idle', 'case_record_available', caseState);
}

/** Pure state transition for one event and the current canonical case record. */
export function transitionGuideState(
  current: GuideStateSnapshot,
  event: GuideEvent,
  caseState: CaseState | null,
): GuideStateSnapshot {
  switch (event.type) {
    case 'CASE_STATE_UPDATED':
      return deriveGuideState(event.caseState);
    case 'CASE_STATE_CLEARED':
      return deriveGuideState(null);
    case 'GUIDE_USER_INPUT_STARTED':
      return makeSnapshot('listening', 'user_input_started', caseState);
    case 'GUIDE_PROCESSING_STARTED':
      return makeSnapshot('processing', 'request_processing', caseState);
    case 'GUIDE_RESPONSE_READY':
      if (!event.response.text.trim()) return current;
      const caseDerivedState = deriveGuideState(caseState);
      return caseDerivedState.name === 'idle'
        ? makeSnapshot('explaining', 'response_available', caseState)
        : caseDerivedState;
    case 'GUIDE_SPEECH_STARTED':
      return makeSnapshot('speaking', 'speech_started', caseState);
    case 'GUIDE_SPEECH_ENDED': {
      const caseDerivedState = deriveGuideState(caseState);
      return caseDerivedState.name === 'idle'
        ? makeSnapshot('explaining', 'response_available', caseState)
        : caseDerivedState;
    }
    case 'GUIDE_RESET':
      return deriveGuideState(caseState);
    case 'GUIDE_ERROR':
      return makeSnapshot('error', 'runtime_error', caseState, event.message);
    case 'GUIDE_ACTION_SELECTED':
      return current;
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
}
