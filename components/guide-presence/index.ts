export { GuidePresence, default } from './GuidePresence';
export { GuideControlSurface } from './GuideControlSurface';
export { GUIDE_PRESENCE_LABELS, GUIDE_PRESENCE_STATES } from './types';
export { AvatarSurface, illustratedAvatarAdapter } from './avatar/AvatarSurface';
export { GUIDE_PRESENTATION_CONTRACT, canonicalGuidePresenceState, getGuideStatePresentation } from './presentation-contract';
export type {
  CanonicalGuidePresenceState,
  GuidePresenceProps,
  GuidePresenceSize,
  GuidePresenceState,
} from './types';
export type { GuideStatePresentation } from './presentation-contract';
export type { GuideExpression } from './avatar/types';
export type {
  AvatarAdapter,
  AvatarAdapterCapabilities,
  AvatarContext,
  AvatarContextKind,
  AvatarEmotion,
  AvatarGazeTarget,
  AvatarGestureHint,
  AvatarSpeechState,
  AvatarSpeechTiming,
  AvatarSurfaceProps,
  AvatarViseme,
  AvatarVisemeCue,
} from './avatar/types';
