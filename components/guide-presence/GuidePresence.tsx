'use client';

import { useReducedMotion } from 'framer-motion';
import './GuidePresence.css';
import { AvatarSurface } from './avatar/AvatarSurface';
import { GUIDE_PRESENCE_LABELS } from './types';
import type { GuidePresenceProps } from './types';
import { canonicalGuidePresenceState, getGuideStatePresentation } from './presentation-contract';

export function GuidePresence({
  state,
  detail,
  accessibleLabel,
  visual,
  avatarAdapter,
  speechState,
  speechTiming,
  emotion,
  context,
  gazeTarget,
  gestureHint,
  size = 'regular',
  reducedMotion = false,
  className,
}: GuidePresenceProps) {
  const systemReducedMotion = useReducedMotion() ?? false;
  const shouldReduceMotion = reducedMotion || systemReducedMotion;
  const label = accessibleLabel ?? GUIDE_PRESENCE_LABELS[state];
  const canonicalState = canonicalGuidePresenceState(state);
  const presentation = getGuideStatePresentation(canonicalState);
  const isUrgent = canonicalState === 'IMMEDIATE_DANGER';
  const rootClassName = ["ls-guide-presence__presence", className].filter(Boolean).join(' ');
  const rendererIsIllustrated = (avatarAdapter?.kind ?? 'illustrated') === 'illustrated';

  return (
    <section
      className={rootClassName}
      data-state={canonicalState}
      data-size={size}
      data-reduced-motion={shouldReduceMotion ? 'true' : undefined}
      role={isUrgent ? 'alert' : 'status'}
      aria-live={isUrgent ? 'assertive' : 'polite'}
      aria-atomic="true"
      aria-label={`${label}${detail ? `. ${detail}` : ''}`}
    >
      <div className={"ls-guide-presence__stage"} aria-hidden="true">
        {visual ?? (
          <>
            <AvatarSurface
              adapter={avatarAdapter}
              visualState={canonicalState}
              size={size}
              speechState={speechState ?? (canonicalState === 'SPEAKING' ? 'speaking' : 'idle')}
              speechTiming={speechTiming}
              expression={presentation.expression}
              expressionIntent={presentation.expressionIntent}
              emotion={emotion ?? presentation.emotion}
              context={context ?? presentation.context}
              gazeTarget={gazeTarget ?? presentation.attention.gaze}
              gazeIntent={presentation.attention.intent}
              gestureHint={gestureHint ?? presentation.headMovement.gestureHint}
              listeningBehavior={presentation.listeningBehavior}
              speakingBehavior={presentation.speakingBehavior}
              interruptionBehavior={presentation.interruptionBehavior}
              reducedMotionFallback={presentation.reducedMotionFallback}
              contextualMessagePriority={presentation.contextualMessagePriority}
              reducedMotion={shouldReduceMotion}
            />
            {rendererIsIllustrated && (
              <span className={"ls-guide-presence__illustrationLabel"}>
                {size === 'compact' ? 'ILLUSTRATED' : 'ILLUSTRATED GUIDE'}
              </span>
            )}
          </>
        )}
      </div>
      <div className={"ls-guide-presence__caption"}>
        <span className={"ls-guide-presence__eyebrow"}>LAWSENSE · GUIDE</span>
        <span className={"ls-guide-presence__stateLabel"}>{label}</span>
        {detail && <span className={"ls-guide-presence__detail"}>{detail}</span>}
      </div>
    </section>
  );
}

export default GuidePresence;
