import type { ComponentType } from 'react';
import type { CanonicalGuidePresenceState } from '../types';

export type AvatarSpeechState = 'idle' | 'speaking' | 'paused' | 'interrupted';

export type AvatarViseme = 'sil' | 'rest' | 'A' | 'E' | 'I' | 'O' | 'U' | 'M' | 'FV' | 'L';

export interface AvatarVisemeCue {
  /** Offset from the beginning of the current utterance. */
  startMs: number;
  /** Cue duration; the cue is active until startMs + durationMs. */
  durationMs: number;
  viseme: AvatarViseme;
  /** Optional source phoneme for a renderer with a phoneme-level mouth model. */
  phoneme?: string;
}

/** A caller-owned speech clock and its aligned phoneme/viseme cues. */
export interface AvatarSpeechTiming {
  currentTimeMs: number;
  cues: readonly AvatarVisemeCue[];
}

export type AvatarEmotion =
  | 'neutral'
  | 'attentive'
  | 'thoughtful'
  | 'curious'
  | 'reassuring'
  | 'focused'
  | 'confident'
  | 'uncertain'
  | 'concerned'
  | 'compassionate'
  | 'engaged';

export type GuideExpression =
  | 'calm'
  | 'attentive'
  | 'thoughtful'
  | 'curious'
  | 'warm'
  | 'grounded'
  | 'uncertain'
  | 'concerned'
  | 'compassionate'
  | 'steady'
  | 'apologetic';

export type AvatarContextKind =
  | 'general'
  | 'conversation'
  | 'case-review'
  | 'explanation'
  | 'evidence-review'
  | 'source-review'
  | 'safety-sensitive'
  | 'error';

/** Descriptive presentation context only; it carries no legal or case logic. */
export interface AvatarContext {
  kind: AvatarContextKind;
  sensitivity?: 'standard' | 'sensitive';
  focusLabel?: string;
}

export type AvatarGazeTarget =
  | 'camera'
  | 'user'
  | 'evidence'
  | 'case-record'
  | 'side-panel'
  | 'below'
  | { x: number; y: number };

export type AvatarGestureHint = 'none' | 'gentle-nod' | 'open-palm' | 'review-document' | 'settle';

/** Inputs to any renderer. Timing and interruption remain caller-controlled. */
export interface AvatarSurfaceProps {
  visualState: CanonicalGuidePresenceState;
  size?: 'compact' | 'regular' | 'hero';
  speechState: AvatarSpeechState;
  speechTiming?: AvatarSpeechTiming;
  expression: GuideExpression;
  emotion: AvatarEmotion;
  context: AvatarContext;
  gazeTarget: AvatarGazeTarget;
  gestureHint: AvatarGestureHint;
  reducedMotion?: boolean;
}

/**
 * Renderer capabilities are declared up front so a future local avatar engine
 * can be substituted without changing Guide Runtime or this presentation API.
 */
export interface AvatarAdapterCapabilities {
  visemeTiming: boolean;
  speechInterruption: boolean;
  emotion: boolean;
  gaze: boolean;
  gestures: boolean;
  liveAudioOutput: boolean;
}

export interface AvatarAdapter {
  readonly id: string;
  readonly kind: 'illustrated' | 'human-avatar-engine';
  readonly capabilities: Readonly<AvatarAdapterCapabilities>;
  readonly Surface: ComponentType<AvatarSurfaceProps>;
}
