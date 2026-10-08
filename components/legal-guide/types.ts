import type { ReactNode } from 'react';

export const LEGAL_GUIDE_STATES = [
  'idle',
  'listening',
  'explaining',
  'speaking',
  'extracting',
  'asking',
  'evidence_review',
  'safety_warning',
  'legal_verification',
  'journey_action',
  'completion',
  'error',
] as const;

export type GuideStateName = (typeof LEGAL_GUIDE_STATES)[number];

export const GUIDE_STATE_LABELS: Record<GuideStateName, string> = {
  idle: 'Idle',
  listening: 'Listening',
  explaining: 'Explaining',
  speaking: 'Speaking',
  extracting: 'Extracting details',
  asking: 'Clarifying information',
  evidence_review: 'Evidence review',
  safety_warning: 'Safety warning',
  legal_verification: 'Legal verification',
  journey_action: 'Journey action',
  completion: 'Journey complete',
  error: 'Error',
};

export interface GuideStateChangeEvent {
  type: 'state_change';
  previousState: GuideStateName;
  state: GuideStateName;
}

export interface GuideActionEvent {
  type: 'action';
  actionId: string;
  label: string;
  state: GuideStateName;
}

export type LegalGuideEvent = GuideStateChangeEvent | GuideActionEvent;

export interface GuideActionItem {
  /** Stable key for the consumer's action handler. */
  id: string;
  /** Display text supplied by the integrating application. */
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet';
  /** Optional local transition to run when this action is activated. */
  nextState?: GuideStateName;
}

export type GuideMessageKind = 'guide' | 'user' | 'notice';

export interface GuideMessageProps {
  /** Content comes from the caller; the runtime provides no sample dialogue. */
  message: ReactNode;
  kind?: GuideMessageKind;
  speaker?: string;
}
