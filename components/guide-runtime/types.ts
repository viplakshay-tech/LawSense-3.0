import type { CaseState, InformationStatus, SafetyContextSummary } from '@/lib/api';

export const GUIDE_STATES = [
  'idle',
  'listening',
  'processing',
  'explaining',
  'asking',
  'evidence',
  'grounded',
  'uncertain',
  'conflict',
  'action',
  'safety',
  'completion',
  'speaking',
  'error',
] as const;

export type GuideStateName = (typeof GUIDE_STATES)[number];
export type GuideSpeechLifecycleState = 'idle' | 'speaking' | 'paused' | 'interrupted';

export type GuideStateReason =
  | 'no_case_loaded'
  | 'case_record_available'
  | 'initial_account_missing'
  | 'analysis_unavailable'
  | 'safety_context_present'
  | 'journey_complete'
  | 'evidence_processing'
  | 'case_conflict_present'
  | 'clarification_required'
  | 'information_uncertain'
  | 'evidence_available'
  | 'next_action_recorded'
  | 'legal_sources_available'
  | 'user_input_started'
  | 'request_processing'
  | 'response_available'
  | 'speech_started'
  | 'runtime_error';

/** Exact source-status values stay attached to their original record kind. */
export interface GuideFactReference {
  id: string;
  status: InformationStatus;
  sourceIds: readonly string[];
}

export interface GuideClaimReference {
  id: string;
  status: InformationStatus;
  evidenceIds: readonly string[];
}

export interface GuideEvidenceReference {
  id: string;
  status: InformationStatus;
  documentId?: string | null;
}

export interface GuideDocumentReference {
  id: string;
  processingStatus: CaseState['documents'][number]['processingStatus'];
  reviewStatus: CaseState['documents'][number]['reviewStatus'];
}

export interface GuideInformationSnapshot {
  /** Values copied from CaseState; each list retains its original meaning. */
  unknowns: readonly string[];
  assumptions: readonly string[];
  conflicts: readonly string[];
  facts: readonly GuideFactReference[];
  claims: readonly GuideClaimReference[];
  evidence: readonly GuideEvidenceReference[];
  documents: readonly GuideDocumentReference[];
}

export interface GuideStateSnapshot {
  name: GuideStateName;
  reason: GuideStateReason;
  caseId: string | null;
  information: GuideInformationSnapshot;
  /** Present only when supplied by the case analysis. */
  safetyContext?: SafetyContextSummary;
  /** Error detail passed in by the caller; the runtime does not author it. */
  error?: string;
}

export type GuideNavigationTarget =
  | 'case'
  | 'documents'
  | 'guide'
  | 'journey'
  | 'twin'
  | 'voice'
  | 'safety';

export interface GuideResponse {
  /** Stable identifier supplied by the integrating application. */
  id: string;
  /** Existing caller-provided response text. The runtime never generates it. */
  text: string;
}

export interface GuideActionContext {
  caseState: CaseState | null;
  state: GuideStateSnapshot;
  response: GuideResponse | null;
}

export interface GuideActionPayloadMap {
  ASK_CLARIFICATION: {
    caseId: string;
    sources: readonly ('case_state' | 'journey')[];
  };
  SHOW_EVIDENCE: {
    caseId: string;
    evidenceIds: readonly string[];
    documentIds: readonly string[];
    sourceIds: readonly string[];
  };
  SHOW_LEGAL_GROUNDING: { caseId: string; recordIds: readonly string[] };
  OPEN_JOURNEY: { caseId: string };
  SHOW_TWIN: { caseId: string };
  START_VOICE: { caseId: string };
  SPEAK_RESPONSE: { response: GuideResponse };
  OPEN_SAFETY: { caseId: string; context: SafetyContextSummary };
  NAVIGATE: { caseId: string; target: GuideNavigationTarget };
}

export type GuideActionType = keyof GuideActionPayloadMap;

export type GuideAction = {
  [Type in GuideActionType]: {
    type: Type;
    payload: GuideActionPayloadMap[Type];
  };
}[GuideActionType];

export type GuideEvent =
  | { type: 'CASE_STATE_UPDATED'; caseState: CaseState }
  | { type: 'CASE_STATE_CLEARED' }
  | { type: 'GUIDE_USER_INPUT_STARTED' }
  | { type: 'GUIDE_PROCESSING_STARTED' }
  | { type: 'GUIDE_RESPONSE_READY'; response: GuideResponse }
  | { type: 'GUIDE_SPEECH_STARTED' }
  | { type: 'GUIDE_SPEECH_PAUSED' }
  | { type: 'GUIDE_SPEECH_INTERRUPTED' }
  | { type: 'GUIDE_SPEECH_ENDED' }
  | { type: 'GUIDE_ERROR'; message: string }
  | { type: 'GUIDE_ACTION_SELECTED'; action: GuideAction }
  | { type: 'GUIDE_RESET' };

export type GuideRuntimeEmission =
  | {
      type: 'guide_state_changed';
      previous: GuideStateSnapshot;
      current: GuideStateSnapshot;
    }
  | { type: 'available_actions_changed'; actions: readonly GuideAction[] }
  | { type: 'action_requested'; action: GuideAction }
  | {
      type: 'action_rejected';
      action: GuideAction;
      reason: 'not_available';
    }
  | { type: 'response_available'; response: GuideResponse }
  | { type: 'response_rejected'; reason: 'empty_text' }
  | {
      type: 'speech_state_changed';
      previous: GuideSpeechLifecycleState;
      current: GuideSpeechLifecycleState;
    };

export interface GuideRuntimeSnapshot {
  caseState: CaseState | null;
  state: GuideStateSnapshot;
  availableActions: readonly GuideAction[];
  response: GuideResponse | null;
  /** Runtime-owned playback lifecycle; presentation never guesses from animation. */
  speechState: GuideSpeechLifecycleState;
}

export interface GuideRuntimeResult {
  snapshot: GuideRuntimeSnapshot;
  emissions: readonly GuideRuntimeEmission[];
}
