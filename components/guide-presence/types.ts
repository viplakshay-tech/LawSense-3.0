import type { ReactNode } from 'react';

/** Runtime states that the visual presence can represent. */
export const GUIDE_PRESENCE_STATES = [
  'IDLE',
  'LISTENING',
  'PROCESSING',
  'EXPLAINING',
  'ASKING',
  'EVIDENCE',
  'GROUNDED',
  'ACTION',
  'UNCERTAIN',
  'CONFLICT',
  'SAFETY',
  'SPEAKING',
  'ERROR',
] as const;

export type GuidePresenceState = (typeof GUIDE_PRESENCE_STATES)[number];

export const GUIDE_PRESENCE_LABELS: Record<GuidePresenceState, string> = {
  IDLE: 'Ready',
  LISTENING: 'Listening',
  PROCESSING: 'Reviewing your information',
  EXPLAINING: 'Explaining',
  ASKING: 'Needs a little more detail',
  EVIDENCE: 'Reviewing evidence',
  GROUNDED: 'Grounded in sources',
  ACTION: 'A next step is recorded',
  UNCERTAIN: 'Some details are uncertain',
  CONFLICT: 'Sources appear to conflict',
  SAFETY: 'Safety guidance',
  SPEAKING: 'Speaking',
  ERROR: 'Unable to continue',
};

export type GuidePresenceSize = 'compact' | 'regular' | 'hero';

export interface GuidePresenceProps {
  /** Current state supplied by Guide Runtime. This component does not own state. */
  state: GuidePresenceState;
  /** Optional runtime-supplied context shown beside the visual. */
  detail?: string;
  /** Optional replacement for the state label announced by assistive technology. */
  accessibleLabel?: string;
  /** Visual-only extension point for a custom state visualization. */
  visual?: ReactNode;
  size?: GuidePresenceSize;
  /** Forces still animations in addition to respecting the system preference. */
  reducedMotion?: boolean;
  className?: string;
}
