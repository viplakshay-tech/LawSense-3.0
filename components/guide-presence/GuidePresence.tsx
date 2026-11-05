'use client';

import { useReducedMotion } from 'framer-motion';
import { Activity, ShieldCheck, MessageCircle, Mic } from 'lucide-react';
import './GuidePresence.css';
import { GUIDE_PRESENCE_LABELS } from './types';
import type { GuidePresenceProps } from './types';
import { canonicalGuidePresenceState } from './presentation-contract';

function stateIcon(state: string) {
  if (state === 'IMMEDIATE_DANGER' || state === 'SAFETY') return ShieldCheck;
  if (state === 'LISTENING') return Mic;
  if (state === 'CLARIFYING' || state === 'UNCERTAIN' || state === 'CONFLICT') return MessageCircle;
  return Activity;
}

export function GuidePresence({
  state,
  detail,
  accessibleLabel,
  speechState,
  size = 'regular',
  reducedMotion = false,
  className,
}: GuidePresenceProps) {
  const systemReducedMotion = useReducedMotion() ?? false;
  const shouldReduceMotion = reducedMotion || systemReducedMotion;
  const label = accessibleLabel ?? GUIDE_PRESENCE_LABELS[state];
  const canonicalState = canonicalGuidePresenceState(state);
  const StateIcon = stateIcon(canonicalState);
  const rootClassName = ['ls-guide-presence__presence', className].filter(Boolean).join(' ');

  return (
    <section
      className={rootClassName}
      data-state={canonicalState}
      data-size={size}
      data-speech-state={speechState ?? 'idle'}
      data-reduced-motion={shouldReduceMotion ? 'true' : undefined}
      role={canonicalState === 'IMMEDIATE_DANGER' ? 'alert' : 'status'}
      aria-live={canonicalState === 'IMMEDIATE_DANGER' ? 'assertive' : 'polite'}
      aria-atomic="true"
      aria-label={`${label}${detail ? `. ${detail}` : ''}`}
    >
      <div className="ls-guide-presence__stage" aria-hidden="true">
        <div className="ls-guide-presence__mark">
          <div className="ls-guide-presence__markCore">
            <StateIcon className="ls-guide-presence__markIcon" strokeWidth={1.55} />
          </div>
          <span className="ls-guide-presence__signal ls-guide-presence__signal--one" />
          <span className="ls-guide-presence__signal ls-guide-presence__signal--two" />
        </div>
        <span className="ls-guide-presence__stageCaption">LAWSENSE GUIDE SYSTEM</span>
      </div>
      <div className="ls-guide-presence__caption">
        <span className="ls-guide-presence__eyebrow">LAWSENSE · GUIDE</span>
        <span className="ls-guide-presence__stateLabel">{label}</span>
        {detail && <span className="ls-guide-presence__detail">{detail}</span>}
      </div>
    </section>
  );
}

export default GuidePresence;
