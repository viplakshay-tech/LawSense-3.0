import type { CaseState, InformationStatus } from '@/lib/api';
import type { GuideActionType, GuideStateName } from './types';

export interface GuideRecordedFact {
  id: string;
  label: string;
  value: string;
  status: InformationStatus;
}

export interface GuideNextAction {
  actionType: GuideActionType;
  label: string;
  detail: string;
}

export interface GuidePresentationModel {
  understanding: {
    initialAccount: string | null;
    facts: readonly GuideRecordedFact[];
    factCount: number;
    evidenceCount: number;
    documentCount: number;
  };
  unknowns: readonly string[];
  assumptions: readonly string[];
  conflicts: readonly string[];
  safetySummary: string | null;
  whyItMatters: string;
  uncertainty: {
    relevant: boolean;
    label: string;
    detail: string;
  };
  nextAction: GuideNextAction | null;
  speechText: string;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value.trim() || 'No value recorded.';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'No value recorded.';
  try {
    return JSON.stringify(value) ?? 'Value could not be displayed.';
  } catch {
    return 'Value could not be displayed.';
  }
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function collectUnknowns(caseState: CaseState): string[] {
  return [...new Set([
    ...caseState.unknowns,
    ...(caseState.analysis?.journey.unknowns.map((item) => item.question) ?? []),
    ...(caseState.analysis?.decisionScenario?.unknowns.map((item) => item.question) ?? []),
  ].map((item) => item.trim()).filter(Boolean))];
}

function hasUncertainty(caseState: CaseState, unknowns: readonly string[]): boolean {
  return unknowns.length > 0
    || caseState.assumptions.length > 0
    || caseState.jurisdiction.basis === 'inferred'
    || caseState.jurisdiction.basis === 'unknown'
    || caseState.facts.some((fact) => fact.status === 'unknown' || fact.status === 'assumption' || fact.status === 'system_inferred')
    || caseState.claims.some((claim) => claim.status === 'unknown' || claim.status === 'assumption' || claim.status === 'system_inferred')
    || caseState.evidence.some((item) => item.status === 'unknown' || item.status === 'assumption' || item.status === 'system_inferred');
}

function chooseNextAction(caseState: CaseState, state: GuideStateName, unknowns: readonly string[]): GuideNextAction | null {
  const safety = caseState.analysis?.safetyContext;
  if (safety && safety.context !== 'none') {
    return {
      actionType: 'OPEN_SAFETY',
      label: 'Review the recorded safety context',
      detail: 'Open the Safety workspace for the context returned with this case.',
    };
  }
  if (unknowns.length > 0) {
    return {
      actionType: 'ASK_CLARIFICATION',
      label: 'Answer an open case question',
      detail: 'The clarification panel loads the current questions from the case service.',
    };
  }
  if (state === 'conflict') {
    return {
      actionType: 'SHOW_TWIN',
      label: 'Review recorded conflicts',
      detail: 'Open the Living Twin to inspect the case records and their links.',
    };
  }

  const decisionAction = caseState.analysis?.decisionScenario?.nextAction.trim();
  const journeyAction = caseState.analysis?.journey.nextActions.find((item) => item.action.trim());
  const recordedAction = decisionAction || journeyAction?.action.trim();
  if (recordedAction) {
    const stage = decisionAction ? undefined : journeyAction?.stage;
    const actionType: GuideActionType = stage === 'LAW' || stage === 'OPTIONS'
      ? 'SHOW_LEGAL_GROUNDING'
      : stage === 'EVIDENCE'
        ? 'SHOW_EVIDENCE'
        : 'OPEN_JOURNEY';
    return {
      actionType,
      label: recordedAction,
      detail: 'This next step is copied from the current case analysis.',
    };
  }

  if (caseState.evidence.length > 0 || caseState.documents.length > 0) {
    return {
      actionType: 'SHOW_EVIDENCE',
      label: 'Open the Evidence Map',
      detail: 'Trace recorded links from claims and facts to evidence, documents, and page-level sources.',
    };
  }
  const journey = caseState.analysis?.journey;
  if ((journey?.requiredEvidence.length ?? 0) > 0 || (journey?.requiredDocuments.length ?? 0) > 0) {
    return {
      actionType: 'SHOW_EVIDENCE',
      label: 'Review the listed evidence needs',
      detail: 'The journey lists evidence or documents to consider. These are not attached items.',
    };
  }
  const knowledge = caseState.analysis?.legalKnowledge;
  if (knowledge?.status === 'records_found' || caseState.legalIssues.length > 0) {
    return {
      actionType: 'SHOW_LEGAL_GROUNDING',
      label: 'Review legal grounding',
      detail: 'Open the source candidates and grounding information returned for this case.',
    };
  }

  return null;
}

export function createGuidePresentation(
  caseState: CaseState | null,
  state: GuideStateName,
): GuidePresentationModel {
  if (!caseState) {
    return {
      understanding: { initialAccount: null, facts: [], factCount: 0, evidenceCount: 0, documentCount: 0 },
      unknowns: [],
      assumptions: [],
      conflicts: [],
      safetySummary: null,
      whyItMatters: 'The case record is not available yet, so the Guide has no case details to summarize.',
      uncertainty: { relevant: false, label: 'Waiting for case data', detail: 'No CaseState has been loaded.' },
      nextAction: null,
      speechText: '',
    };
  }

  const unknowns = collectUnknowns(caseState);
  const conflictingCount = caseState.conflicts.length
    + caseState.facts.filter((fact) => fact.status === 'conflicting').length
    + caseState.claims.filter((claim) => claim.status === 'conflicting').length
    + caseState.evidence.filter((item) => item.status === 'conflicting').length;
  const inferredCount = caseState.facts.filter((fact) => fact.status === 'system_inferred').length
    + caseState.claims.filter((claim) => claim.status === 'system_inferred').length
    + caseState.evidence.filter((item) => item.status === 'system_inferred').length;
  const uncertain = hasUncertainty(caseState, unknowns);
  const safetyPresent = Boolean(
    caseState.analysis?.safetyContext && caseState.analysis.safetyContext.context !== 'none',
  );

  let whyItMatters = 'This surface mirrors the supplied CaseState. It does not establish a legal outcome.';
  if (safetyPresent) {
    whyItMatters = 'A safety context is present in the case analysis. Review its recorded context in the Safety workspace.';
  } else if (conflictingCount > 0) {
    whyItMatters = `${conflictingCount} conflict marker${conflictingCount === 1 ? '' : 's'} appear in CaseState. Review the linked material before treating an account as settled.`;
  } else if (unknowns.length > 0) {
    whyItMatters = `${unknowns.length} open question${unknowns.length === 1 ? '' : 's'} are recorded. Answers can add user-reported information to the case record.`;
  } else if (caseState.assumptions.length > 0 || inferredCount > 0) {
    whyItMatters = 'Some details are marked as assumptions or system-inferred. Their recorded source status remains visible for review.';
  } else if (caseState.evidence.length > 0 || caseState.documents.length > 0) {
    whyItMatters = 'Evidence and document statuses describe how items were recorded or reviewed; they do not verify authenticity or truth.';
  }

  const uncertaintyParts = [
    unknowns.length ? `${unknowns.length} open question${unknowns.length === 1 ? '' : 's'}` : '',
    caseState.assumptions.length ? `${caseState.assumptions.length} assumption${caseState.assumptions.length === 1 ? '' : 's'}` : '',
    inferredCount ? `${inferredCount} system-inferred record${inferredCount === 1 ? '' : 's'}` : '',
    conflictingCount ? `${conflictingCount} conflict${conflictingCount === 1 ? '' : 's'}` : '',
    caseState.jurisdiction.basis === 'inferred' ? 'jurisdiction basis is inferred' : '',
    caseState.jurisdiction.basis === 'unknown' ? 'jurisdiction is not established' : '',
  ].filter(Boolean);
  const uncertainty = uncertain || conflictingCount > 0
    ? {
        relevant: true,
        label: conflictingCount > 0 ? 'Review source conflicts' : 'Uncertainty in the record',
        detail: uncertaintyParts.join(' · ') || 'Some case details are not established.',
      }
    : {
        relevant: false,
        label: 'No uncertainty marker recorded',
        detail: 'This reflects the current CaseState; it is not a completeness assessment.',
      };

  const facts = caseState.facts.slice(0, 4).map((fact) => ({
    id: fact.id,
    label: humanize(fact.key),
    value: formatValue(fact.value).slice(0, 200),
    status: fact.status,
  }));
  const nextAction = chooseNextAction(caseState, state, unknowns);
  const caseLabel = caseState.title?.trim() || 'This case';
  const safety = caseState.analysis?.safetyContext;
  const safetySummary = safety && safety.context !== 'none'
    ? `${humanize(safety.context)} · ${humanize(safety.urgency)} urgency · assessment ${humanize(safety.assessmentStatus)}`
    : null;
  const speechText = `${caseLabel}: ${caseState.facts.length} recorded fact${caseState.facts.length === 1 ? '' : 's'}, ${unknowns.length} open question${unknowns.length === 1 ? '' : 's'}, and ${conflictingCount} conflict marker${conflictingCount === 1 ? '' : 's'}. ${whyItMatters}`;

  return {
    understanding: {
      initialAccount: caseState.initialStatement?.trim() || null,
      facts,
      factCount: caseState.facts.length,
      evidenceCount: caseState.evidence.length,
      documentCount: caseState.documents.length,
    },
    unknowns,
    assumptions: caseState.assumptions,
    conflicts: caseState.conflicts,
    safetySummary,
    whyItMatters,
    uncertainty,
    nextAction,
    speechText,
  };
}

export function guideStateLabel(state: GuideStateName): string {
  const labels: Record<GuideStateName, string> = {
    idle: 'Ready',
    listening: 'Listening',
    processing: 'Processing',
    explaining: 'Explaining',
    asking: 'Asking for detail',
    evidence: 'Evidence review',
    grounded: 'Legal grounding',
    uncertain: 'Uncertainty present',
    conflict: 'Conflict review',
    action: 'Next step recorded',
    safety: 'Safety context',
    completion: 'Journey complete',
    speaking: 'Speaking',
    error: 'Action needs attention',
  };
  return labels[state];
}

export function guideStateChangeMessage(state: GuideStateName): string {
  const messages: Record<GuideStateName, string> = {
    idle: 'The current case record is available to review.',
    listening: 'Voice capture is listening for your input.',
    processing: 'The workspace is processing the current evidence or transcript.',
    explaining: 'The case update is ready to review.',
    asking: 'Open questions are recorded in the case.',
    evidence: 'Evidence or documents are recorded in the case.',
    grounded: 'Legal source records are present in the case analysis.',
    uncertain: 'Unknown, assumed, or inferred details remain in the record.',
    conflict: 'Conflicting information is recorded in the case.',
    action: 'A next step is recorded in the case analysis.',
    safety: 'Safety context is present in the case analysis.',
    completion: 'Every recorded journey step is complete, with no open questions or next actions remaining.',
    speaking: 'Guide speech has started.',
    error: 'The Guide could not complete the last action.',
  };
  return messages[state];
}
