import type { CanonicalGuidePresenceState } from './types';
import type {
  AvatarContext,
  AvatarEmotion,
  AvatarGazeTarget,
  AvatarGestureHint,
  GuideExpression,
} from './avatar/types';

export interface GuideStatePresentation {
  state: CanonicalGuidePresenceState;
  /** Higher values win when runtime and case context compete for the status line. */
  contextualMessagePriority: number;
  expression: GuideExpression;
  expressionIntent: string;
  emotion: AvatarEmotion;
  attention: {
    gaze: AvatarGazeTarget;
    intent: string;
  };
  headMovement: {
    behavior: string;
    gestureHint: AvatarGestureHint;
  };
  listeningBehavior: string;
  speakingBehavior: string;
  idleBehavior: string;
  interruptionBehavior: string;
  reducedMotionFallback: string;
  context: AvatarContext;
}

/**
 * Presentation-only contract for the human-facing Guide. Every value is
 * selected from a Guide Runtime state; renderers do not make case decisions.
 */
export const GUIDE_PRESENTATION_CONTRACT = {
  IDLE: {
    state: 'IDLE',
    contextualMessagePriority: 10,
    expression: 'calm',
    expressionIntent: 'Look composed and available without asking for attention.',
    emotion: 'neutral',
    attention: { gaze: 'camera', intent: 'Offer a calm, general point of attention.' },
    headMovement: { behavior: 'Settled, upright posture with no repeating idle gesture.', gestureHint: 'none' },
    listeningBehavior: 'Listening is inactive; wait for a Runtime input event.',
    speakingBehavior: 'Remain silent until Runtime speech state becomes active.',
    idleBehavior: 'Hold a relaxed, open expression without a repeating idle gesture.',
    interruptionBehavior: 'Close the mouth and return to this resting pose immediately.',
    reducedMotionFallback: 'Use a still portrait and the Ready state label.',
    context: { kind: 'general' },
  },
  LISTENING: {
    state: 'LISTENING',
    contextualMessagePriority: 75,
    expression: 'attentive',
    expressionIntent: 'Show attention without suggesting agreement or judgment.',
    emotion: 'attentive',
    attention: { gaze: 'user', intent: 'Keep gentle, direct attention on the person speaking.' },
    headMovement: { behavior: 'Use one subtle lean on state entry, then remain still.', gestureHint: 'none' },
    listeningBehavior: 'Stay quiet while Runtime input capture is active.',
    speakingBehavior: 'Do not animate speech while input is being captured.',
    idleBehavior: 'Maintain an attentive, still listening pose without scanning or looping nods.',
    interruptionBehavior: 'Stop outgoing speech immediately and hold attention on the user.',
    reducedMotionFallback: 'Use a still portrait with the listening label and direct gaze.',
    context: { kind: 'conversation' },
  },
  THINKING: {
    state: 'THINKING',
    contextualMessagePriority: 45,
    expression: 'thoughtful',
    expressionIntent: 'Signal quiet processing without implying a conclusion.',
    emotion: 'thoughtful',
    attention: { gaze: 'case-record', intent: 'Turn attention toward the supplied case record while Runtime work is in progress.' },
    headMovement: { behavior: 'Use a small downward thought tilt, then remain still.', gestureHint: 'review-document' },
    listeningBehavior: 'Input capture is inactive unless Runtime also reports LISTENING.',
    speakingBehavior: 'Remain silent until a response is ready and speech is explicitly active.',
    idleBehavior: 'Hold a quiet, focused pose; show progress in the status UI rather than a searching loop.',
    interruptionBehavior: 'A newer Runtime state replaces this pose; active speech closes cleanly.',
    reducedMotionFallback: 'Use a still, thoughtful portrait with the Thinking label.',
    context: { kind: 'case-review' },
  },
  SPEAKING: {
    state: 'SPEAKING',
    contextualMessagePriority: 40,
    expression: 'warm',
    expressionIntent: 'Look engaged while keeping the spoken content available as text.',
    emotion: 'engaged',
    attention: { gaze: 'user', intent: 'Orient toward the person while following the Runtime speech lifecycle.' },
    headMovement: { behavior: 'Remain settled unless an explicit renderer hint is supplied.', gestureHint: 'none' },
    listeningBehavior: 'Listening is inactive during outgoing speech.',
    speakingBehavior: 'Map mouth shapes only from externally supplied speech timing; never invent visemes.',
    idleBehavior: 'When speech pauses or ends, close the mouth and wait for the next Runtime event.',
    interruptionBehavior: 'Close the mouth and clear active visemes immediately when Runtime reports interruption.',
    reducedMotionFallback: 'Disable head movement; only apply externally supplied viseme changes.',
    context: { kind: 'conversation' },
  },
  CLARIFYING: {
    state: 'CLARIFYING',
    contextualMessagePriority: 70,
    expression: 'curious',
    expressionIntent: 'Invite a correction or answer without pressure.',
    emotion: 'curious',
    attention: { gaze: 'camera', intent: 'Address the person directly while leaving room for a reply.' },
    headMovement: { behavior: 'Use a slight inquiry tilt without repeated beckoning.', gestureHint: 'none' },
    listeningBehavior: 'Hold space for a reply; listening begins only when Runtime starts input capture.',
    speakingBehavior: 'Use a measured question only when Runtime speech is active, then allow a pause.',
    idleBehavior: 'Hold an open, curious expression while the clarification state remains active.',
    interruptionBehavior: 'End speech immediately and leave the clarification state under Runtime control.',
    reducedMotionFallback: 'Use a still, curious portrait with the Clarifying label.',
    context: { kind: 'conversation' },
  },
  UNCERTAIN: {
    state: 'UNCERTAIN',
    contextualMessagePriority: 60,
    expression: 'uncertain',
    expressionIntent: 'Make uncertainty visible without dramatizing it.',
    emotion: 'uncertain',
    attention: { gaze: 'user', intent: 'Stay open and direct while uncertainty is presented clearly.' },
    headMovement: { behavior: 'Use a small reflective tilt and hold it without repeated motion.', gestureHint: 'none' },
    listeningBehavior: 'Remain attentive while details are clarified.',
    speakingBehavior: 'Present caveats at an even pace using only supplied speech timing.',
    idleBehavior: 'Remain steady while uncertain details stay in the case record.',
    interruptionBehavior: 'Stop speech immediately without changing the Runtime uncertainty state.',
    reducedMotionFallback: 'Use a still, reflective portrait and the Uncertain label.',
    context: { kind: 'source-review' },
  },
  CONFLICT: {
    state: 'CONFLICT',
    contextualMessagePriority: 80,
    expression: 'concerned',
    expressionIntent: 'Signal care around disagreement without implying which source is right.',
    emotion: 'concerned',
    attention: { gaze: 'evidence', intent: 'Keep attention on the conflicting material without choosing a side.' },
    headMovement: { behavior: 'Use a centered, careful posture with no alternating gaze loop.', gestureHint: 'review-document' },
    listeningBehavior: 'Remain available for corrections while the conflict record stays visible.',
    speakingBehavior: 'Describe a conflict only from supplied response text and timing.',
    idleBehavior: 'Hold composed concern while the conflict state remains active.',
    interruptionBehavior: 'End speech cleanly and leave conflict handling with Guide Runtime.',
    reducedMotionFallback: 'Use a still portrait and an explicit Conflict label.',
    context: { kind: 'source-review' },
  },
  ACTION_REQUIRED: {
    state: 'ACTION_REQUIRED',
    contextualMessagePriority: 65,
    expression: 'steady',
    expressionIntent: 'Show a clear, composed prompt without manufacturing urgency.',
    emotion: 'focused',
    attention: { gaze: 'camera', intent: 'Point attention to the recorded next step or action error.' },
    headMovement: { behavior: 'Remain upright and still.', gestureHint: 'none' },
    listeningBehavior: 'Wait for the user to choose or dismiss the recorded action.',
    speakingBehavior: 'Explain only the supplied action or error text.',
    idleBehavior: 'Keep the required action visible without prompting repeatedly.',
    interruptionBehavior: 'Stop speech immediately; action state remains controlled by Runtime.',
    reducedMotionFallback: 'Use a still portrait and a visible action label.',
    context: { kind: 'explanation' },
  },
  SAFETY: {
    state: 'SAFETY',
    contextualMessagePriority: 90,
    expression: 'compassionate',
    expressionIntent: 'Offer gentle attention without pressure or alarm.',
    emotion: 'compassionate',
    attention: { gaze: 'user', intent: 'Offer gentle attention without pressure or alarm.' },
    headMovement: { behavior: 'Keep a still, grounded posture with no urgent or startling gestures.', gestureHint: 'none' },
    listeningBehavior: 'Remain available; do not imply that the Guide is monitoring the person.',
    speakingBehavior: 'Keep any active speech calm and concise; safety content stays Runtime-owned.',
    idleBehavior: 'Remain present without pulsing, scanning, or suggesting urgency through movement.',
    interruptionBehavior: 'Stop speech immediately and keep safety-state changes under Runtime control.',
    reducedMotionFallback: 'Use a still compassionate portrait and the visible Safety label.',
    context: { kind: 'safety-sensitive', sensitivity: 'sensitive' },
  },
  IMMEDIATE_DANGER: {
    state: 'IMMEDIATE_DANGER',
    contextualMessagePriority: 100,
    expression: 'compassionate',
    expressionIntent: 'Stay calm and attentive when the supplied case state marks urgent safety context.',
    emotion: 'compassionate',
    attention: { gaze: 'user', intent: 'Offer calm, direct attention without startling movement.' },
    headMovement: { behavior: 'Keep a still, grounded posture; use no pulse, flash, or urgent gesture.', gestureHint: 'none' },
    listeningBehavior: 'Remain available without claiming to monitor the person or contact anyone.',
    speakingBehavior: 'Use only the supplied safety response and externally supplied speech timing.',
    idleBehavior: 'Keep the urgent safety label visible without alarm animation.',
    interruptionBehavior: 'Stop speech immediately; only Runtime may change the safety state.',
    reducedMotionFallback: 'Use a still portrait with an explicit urgent safety label.',
    context: { kind: 'safety-sensitive', sensitivity: 'sensitive' },
  },
} as const satisfies Record<CanonicalGuidePresenceState, GuideStatePresentation>;

export function canonicalGuidePresenceState(state: CanonicalGuidePresenceState): CanonicalGuidePresenceState {
  return state;
}

export function getGuideStatePresentation(state: CanonicalGuidePresenceState): GuideStatePresentation {
  return GUIDE_PRESENTATION_CONTRACT[state];
}
