import type { ReactNode } from 'react';
import type {
  AvatarAdapter,
  AvatarContext,
  AvatarEmotion,
  AvatarGazeTarget,
  AvatarGestureHint,
  AvatarSpeechState,
  AvatarSpeechTiming,
} from './avatar/types';

/** States supplied by Guide Runtime and represented by the Guide presence. */
export const GUIDE_PRESENCE_STATES = [
  'IDLE',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'CLARIFYING',
  'UNCERTAIN',
  'CONFLICT',
  'ACTION_REQUIRED',
  'SAFETY',
  'IMMEDIATE_DANGER',
] as const;

export type CanonicalGuidePresenceState = (typeof GUIDE_PRESENCE_STATES)[number];

export type GuidePresenceState = CanonicalGuidePresenceState;

export const GUIDE_PRESENCE_LABELS: Record<GuidePresenceState, string> = {
  IDLE: 'Ready when you are',
  LISTENING: 'Listening closely',
  THINKING: 'Thinking through your information',
  SPEAKING: 'Speaking',
  CLARIFYING: 'Clarifying a detail',
  UNCERTAIN: 'Some details are uncertain',
  CONFLICT: 'Sources appear to conflict',
  ACTION_REQUIRED: 'A next step needs attention',
  SAFETY: 'Safety guidance',
  IMMEDIATE_DANGER: 'Urgent safety context',
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
  /** Optional renderer adapter. The illustrated Guide is used when none is supplied. */
  avatarAdapter?: AvatarAdapter;
  /** Explicit speech lifecycle. SPEAKING is inferred from `state` when omitted. */
  speechState?: AvatarSpeechState;
  /** External audio-timeline input; the presentation does not estimate phonemes. */
  speechTiming?: AvatarSpeechTiming;
  emotion?: AvatarEmotion;
  context?: AvatarContext;
  gazeTarget?: AvatarGazeTarget;
  gestureHint?: AvatarGestureHint;
  size?: GuidePresenceSize;
  /** Forces still animations in addition to respecting the system preference. */
  reducedMotion?: boolean;
  className?: string;
}
