import type { CanonicalGuidePresenceState, GuidePresenceState } from './types';
import type {
  AvatarContext,
  AvatarEmotion,
  AvatarGazeTarget,
  AvatarGestureHint,
  GuideExpression,
} from './avatar/types';

export interface GuideStatePresentation {
  expression: GuideExpression;
  emotion: AvatarEmotion;
  attention: {
    gaze: AvatarGazeTarget;
    intent: string;
  };
  headMovement: {
    behavior: string;
    gestureHint: AvatarGestureHint;
  };
  speakingBehavior: string;
  idleBehavior: string;
  interruptionBehavior: string;
  reducedMotionFallback: string;
  context: AvatarContext;
}

/**
 * Presentation-only contract for the human-facing Guide. Runtime decisions,
 * evidence, and legal reasoning stay outside this layer.
 */
export const GUIDE_PRESENTATION_CONTRACT = {
  IDLE: {
    expression: 'calm',
    emotion: 'neutral',
    attention: { gaze: 'camera', intent: 'Available without asking for attention.' },
    headMovement: { behavior: 'Settled, upright posture.', gestureHint: 'none' },
    speakingBehavior: 'Remain silent until Guide Runtime supplies a speaking state.',
    idleBehavior: 'Hold a relaxed, open expression with no repeating idle gesture.',
    interruptionBehavior: 'If speech is interrupted, close the mouth and return to this resting pose immediately.',
    reducedMotionFallback: 'Use a still portrait and the Ready state label.',
    context: { kind: 'general' },
  },
  LISTENING: {
    expression: 'attentive',
    emotion: 'attentive',
    attention: { gaze: 'user', intent: 'Keep gentle, direct attention on the person speaking.' },
    headMovement: { behavior: 'Lean in slightly once on state entry, then remain still.', gestureHint: 'none' },
    speakingBehavior: 'Stay quiet while input is being captured; do not animate speech.',
    idleBehavior: 'Maintain an attentive, still listening pose without scanning or nodding on a loop.',
    interruptionBehavior: 'Stop any outgoing speech immediately and hold attention on the user.',
    reducedMotionFallback: 'Use a still portrait with the listening label and direct gaze.',
    context: { kind: 'conversation' },
  },
  PROCESSING: {
    expression: 'thoughtful',
    emotion: 'thoughtful',
    attention: { gaze: 'case-record', intent: 'Turn attention toward the case record while work is in progress.' },
    headMovement: { behavior: 'A small downward thought tilt, then stillness.', gestureHint: 'review-document' },
    speakingBehavior: 'Remain silent until a response is ready and speech is explicitly active.',
    idleBehavior: 'Hold a quiet, focused pose; progress belongs in the status UI rather than a searching loop.',
    interruptionBehavior: 'A newer Guide state replaces this pose immediately; any active speech closes cleanly.',
    reducedMotionFallback: 'Use a still, thoughtful portrait with the processing label.',
    context: { kind: 'case-review' },
  },
  ASKING: {
    expression: 'curious',
    emotion: 'curious',
    attention: { gaze: 'camera', intent: 'Address the person directly while leaving room for an answer.' },
    headMovement: { behavior: 'A slight inquiry tilt; no repeated beckoning.', gestureHint: 'none' },
    speakingBehavior: 'Use a measured question only when speech is active; allow a clear pause afterward.',
    idleBehavior: 'Hold an open, curious expression while waiting for the user.',
    interruptionBehavior: 'End speech immediately and keep the question state controlled by Guide Runtime.',
    reducedMotionFallback: 'Use a still, curious portrait with the clarification label.',
    context: { kind: 'conversation' },
  },
  EXPLAINING: {
    expression: 'warm',
    emotion: 'reassuring',
    attention: { gaze: 'user', intent: 'Keep the explanation oriented toward the person.' },
    headMovement: { behavior: 'Remain settled; add phrase-boundary emphasis only from an explicit renderer hint.', gestureHint: 'none' },
    speakingBehavior: 'Follow supplied speech and viseme timing; never invent words or mouth timing.',
    idleBehavior: 'When audio ends, close the mouth and keep a composed, available expression.',
    interruptionBehavior: 'Close the mouth on the interruption input and stop phrase gestures immediately.',
    reducedMotionFallback: 'Keep the portrait still; retain the spoken text and state label outside the avatar.',
    context: { kind: 'explanation' },
  },
  EVIDENCE: {
    expression: 'attentive',
    emotion: 'focused',
    attention: { gaze: 'evidence', intent: 'Orient toward the evidence being reviewed without implying a conclusion.' },
    headMovement: { behavior: 'A small, settled evidence-review tilt; no animated eye scanning.', gestureHint: 'review-document' },
    speakingBehavior: 'Speak only when Guide Runtime is speaking, using externally supplied visemes.',
    idleBehavior: 'Remain quietly focused on the evidence view.',
    interruptionBehavior: 'Stop speech immediately; retain the evidence focus until the next runtime state arrives.',
    reducedMotionFallback: 'Use a still portrait with a gentle evidence-facing gaze.',
    context: { kind: 'evidence-review' },
  },
  GROUNDED: {
    expression: 'grounded',
    emotion: 'confident',
    attention: { gaze: 'camera', intent: 'Share a calm, direct summary without signaling certainty beyond the record.' },
    headMovement: { behavior: 'Upright and composed; no celebratory motion.', gestureHint: 'none' },
    speakingBehavior: 'Use supplied speech timing if a response is being voiced.',
    idleBehavior: 'Hold a quiet, settled expression.',
    interruptionBehavior: 'Stop active speech and return to the composed resting expression.',
    reducedMotionFallback: 'Use a still portrait and grounded status label.',
    context: { kind: 'source-review' },
  },
  UNCERTAIN: {
    expression: 'uncertain',
    emotion: 'uncertain',
    attention: { gaze: 'user', intent: 'Stay open and direct while uncertainty is presented clearly.' },
    headMovement: { behavior: 'A small reflective tilt, held without repeated motion.', gestureHint: 'none' },
    speakingBehavior: 'Present caveats at an even pace; do not dramatize uncertainty.',
    idleBehavior: 'Remain steady and attentive while details are clarified.',
    interruptionBehavior: 'Stop speech immediately without changing the runtime uncertainty state.',
    reducedMotionFallback: 'Use a still, reflective portrait and the uncertainty label.',
    context: { kind: 'source-review' },
  },
  CONFLICT: {
    expression: 'concerned',
    emotion: 'concerned',
    attention: { gaze: 'evidence', intent: 'Keep attention on the conflicting material; do not imply which source is right.' },
    headMovement: { behavior: 'A centered, careful posture with no alternating gaze loop.', gestureHint: 'review-document' },
    speakingBehavior: 'Explain the conflict only from the supplied response and timing.',
    idleBehavior: 'Hold a composed, neutral concern while the conflict is visible.',
    interruptionBehavior: 'End speech cleanly and keep conflict handling with Guide Runtime.',
    reducedMotionFallback: 'Use a still portrait and an explicit conflict label.',
    context: { kind: 'source-review' },
  },
  SAFETY: {
    expression: 'compassionate',
    emotion: 'compassionate',
    attention: { gaze: 'user', intent: 'Offer gentle attention without pressure or alarm.' },
    headMovement: { behavior: 'Still, grounded posture; no urgent or startling gestures.', gestureHint: 'none' },
    speakingBehavior: 'Keep any active speech calm and concise; the safety content remains owned by Guide Runtime.',
    idleBehavior: 'Remain present without pulsing, scanning, or suggesting urgency through movement.',
    interruptionBehavior: 'Stop speech immediately and keep all safety-state changes under runtime control.',
    reducedMotionFallback: 'Use a still compassionate portrait and the visible safety label.',
    context: { kind: 'safety-sensitive' },
  },
  SPEAKING: {
    expression: 'warm',
    emotion: 'engaged',
    attention: { gaze: 'user', intent: 'Speak to the person, following the external speech timeline.' },
    headMovement: { behavior: 'Remain settled unless the caller supplies a phrase or gesture hint.', gestureHint: 'none' },
    speakingBehavior: 'Map supplied phoneme/viseme cues to the mouth; never synthesize timing from state alone.',
    idleBehavior: 'When paused or complete, close the mouth and wait for the next speech state.',
    interruptionBehavior: 'Treat interrupted speech as immediate: close the mouth, clear active visemes, and stop gestures.',
    reducedMotionFallback: 'Disable head motion; allow direct viseme changes only when supplied by the speech adapter.',
    context: { kind: 'conversation' },
  },
  ERROR: {
    expression: 'apologetic',
    emotion: 'concerned',
    attention: { gaze: 'camera', intent: 'Acknowledge the problem plainly and calmly.' },
    headMovement: { behavior: 'Still, neutral posture without an alarmed reaction.', gestureHint: 'none' },
    speakingBehavior: 'Speak only when an explicit error explanation is active; keep the mouth synchronized to supplied cues.',
    idleBehavior: 'Hold a calm expression so the visible error copy carries the explanation.',
    interruptionBehavior: 'Stop any outgoing speech immediately; error dismissal remains controlled by Guide Runtime.',
    reducedMotionFallback: 'Use a still portrait with the accessible error label.',
    context: { kind: 'error' },
  },
} as const satisfies Record<CanonicalGuidePresenceState, GuideStatePresentation>;

/** Map the previously supported ACTION label to its closest calm presentation. */
export function canonicalGuidePresenceState(state: GuidePresenceState): CanonicalGuidePresenceState {
  return state === 'ACTION' ? 'GROUNDED' : state;
}

export function getGuideStatePresentation(state: GuidePresenceState): GuideStatePresentation {
  return GUIDE_PRESENTATION_CONTRACT[canonicalGuidePresenceState(state)];
}
